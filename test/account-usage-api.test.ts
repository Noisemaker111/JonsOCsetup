import { afterEach, expect, test } from "bun:test"
import { hiddenExecFile } from "../scripts/windows-process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, resolve, sep } from "node:path"
import { getAccountUsage, readAccountUsage, routeAccountCapacity, accountsForRoute } from "../usage/account-api"
import { discoverConnections, opaqueAccountID, type Connection } from "../usage/account-connections"
import { parseOpenAIAccountUsage, parseClaudeAccountUsage, parseClaudePlan, probeConnection } from "../usage/account-adapters"
import { projectAccountUsage } from "../usage/account-projection"
import { capacitySnapshot } from "../usage/usage-lib"
import { telemetryFromCapacity } from "../models/model-router"
import type { Observation } from "../usage/account-adapters"
import type { AccountSnapshot } from "../usage/account-types"

const roots: string[] = []
const scratch = () => { const root = mkdtempSync(join(tmpdir(), "usage-account-api-")); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe scratch cleanup"); rmSync(root, { recursive: true, force: true }) } })
const write = (path: string, value: any) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)) }
const clock = Date.parse("2026-09-05T00:00:00Z")
const plan = { name: null, rateLimitTier: null, multiplier: null, provenance: "unknown" as const, observedAt: null }
const connection = (id = "first", owner: Connection["owner"] = "broker", accountID = "account-one"): Connection => ({
  id, owner, accountID, identity: "account", provider: "openai", plan, routeProviders: owner === "broker" ? ["cliproxyapi"] : ["openai"],
  modelPrefix: null, upstreamAccountID: "private-account-id", token: () => "SECRET_ACCESS_TOKEN",
})
const observed = (now = clock, used = 20): Observation => parseOpenAIAccountUsage({
  plan_type: "pro", rate_limit: { primary_window: { used_percent: used, limit_window_seconds: 18000, reset_after_seconds: 1000 } },
}, now)
const options = (root: string, connections = [connection()]) => ({
  file: join(root, "usage.json"), now: () => clock,
  discover: () => ({ connections, diagnostics: [] }),
})

test("discovery deduplicates account identity across existing stores without exposing or copying tokens", () => {
  const root = scratch(), paths = { home: root, config: join(root,"config"), data: join(root,"data"), codex: join(root,"codex"), claude: join(root,"claude") }
  const authDir = join(root,"broker")
  write(join(paths.config,"cliproxyapi/config.localhost.yaml"), "auth-dir: " + JSON.stringify(authDir))
  write(join(authDir,"one.json"), {type:"codex",access_token:"broker-secret",account_id:"same",refresh_token:"refresh-secret"})
  write(join(authDir,"two.json"), {type:"codex",access_token:"other-secret",account_id:"second",prefix:"work"})
  write(join(authDir,"disabled.json"), {type:"codex",access_token:"disabled-secret",account_id:"third",disabled:true})
  write(join(paths.data,"auth.json"), {openai:{type:"oauth",access:"host-secret",accountId:"same"},openrouter:{type:"api",key:"paid-secret"}})
  write(join(paths.codex,"auth.json"), {tokens:{access_token:"native-secret",account_id:"same"}})
  write(join(paths.claude,".credentials.json"), {claudeAiOauth:{accessToken:"claude-secret",subscriptionType:"pro"}})
  write(paths.claude+".json", {oauthAccount:{accountUuid:"person",organizationUuid:"org"}})
  const before = readFileSync(join(paths.data,"auth.json"),"utf8")
  const discovery = discoverConnections(paths)
  const one = discovery.connections.filter(c=>c.accountID===opaqueAccountID("openai","same"))
  expect(one.map(c=>c.owner)).toEqual(["broker","opencode","codex"])
  expect(new Set(discovery.connections.map(c=>c.accountID)).size).toBe(3)
  expect(JSON.stringify(discovery)).not.toContain("secret")
  expect(readFileSync(join(paths.data,"auth.json"),"utf8")).toBe(before)
})

test("Claude Max plan and arbitrary feature pools survive normalization without becoming shared quota", () => {
  const data = parseClaudeAccountUsage({
    five_hour:{utilization:87,resets_at:"2026-09-05T03:00:00Z"},
    seven_day:{utilization:17,resets_at:"2026-09-05T19:00:00Z"},
    seven_day_sonnet:{utilization:100,resets_at:"2026-09-06T00:00:00Z"},
    future_pool:{utilization:33,resets_at:null}, seven_day_opus:null, extra_usage:{is_enabled:false},
  },clock)
  expect(data.windows).toHaveLength(4)
  expect(data.windows.find(w=>w.id==="future_pool")).toMatchObject({scope:"unknown",durationSeconds:null,resetAt:null})
  expect(data.windows.find(w=>w.id==="seven_day_sonnet")?.scope).toBe("model")
  expect(parseClaudePlan({account:{has_claude_max:true},organization:{rate_limit_tier:"default_claude_max_20x"}},clock)).toMatchObject({name:"max",multiplier:20,provenance:"provider-observed"})
})

test("provider durations and model-specific limits are not collapsed into 5h/7d/30d", () => {
  const data=parseOpenAIAccountUsage({plan_type:"pro",rate_limit:{primary_window:{used_percent:10,limit_window_seconds:600,reset_after_seconds:90},secondary_window:{used_percent:20,limit_window_seconds:7200,reset_at:clock/1000+900}},
    additional_rate_limits:[{metered_feature:"spark",rate_limit:{primary_window:{used_percent:100,limit_window_seconds:600}}}],
    model_usage:{"gpt-special":{used_percent:100,reset_after_seconds:60,limit_window_seconds:600}},
  },clock)
  expect(data.windows.map(w=>w.label)).toEqual(["10m","2h","10m","10m"])
  expect(data.windows[2].scope).toBe("feature")
  expect(data.windows[3]).toMatchObject({scope:"model",model:"gpt-special"})
  expect(data.windows[2].resetAt).toBeNull()
})

test("null, malformed, and unknown quota values never become zero-percent availability", () => {
  const data=parseOpenAIAccountUsage({rate_limit:{primary_window:{used_percent:null,limit_window_seconds:18000},secondary_window:{used_percent:-1,reset_at:"bad"}}},clock)
  expect(data.windows.every(w=>w.usedPercent===null&&w.state==="unknown"&&w.resetAt===null)).toBe(true)
  const capped=parseOpenAIAccountUsage({rate_limit:{allowed:false}},clock)
  expect(capped.windows[0].state).toBe("exhausted")
})

test("concurrent requests share one refresh; new callers reuse the same account observation", async () => {
  const root=scratch(); let calls=0
  const opts={...options(root),probe:async()=>{calls++;await new Promise(r=>setTimeout(r,25));return observed()}}
  const snapshots=await Promise.all(Array.from({length:12},()=>getAccountUsage(opts)))
  expect(calls).toBe(1)
  await getAccountUsage(opts)
  expect(calls).toBe(1)
  expect(snapshots.every(s=>s.accounts[0].observedAt===snapshots[0].accounts[0].observedAt)).toBe(true)
})

test("authentication failure tries another existing connection for the same account", async () => {
  const root=scratch(), seen:string[]=[]
  const result=await getAccountUsage({...options(root,[connection(),connection("native","opencode")]),probe:async c=>{
    seen.push(c.id);return c.id==="first"?{state:"auth-required",error:"expired"}:observed()
  }})
  expect(seen).toEqual(["first","native"])
  expect(result.accounts).toHaveLength(1)
  expect(result.accounts[0]).toMatchObject({state:"available",activeConnectionID:"native",failures:0,error:null})
  expect(JSON.stringify(result)).not.toContain("SECRET")
  expect(readFileSync(join(root,"usage.json"),"utf8")).not.toContain("private-account-id")
})

test("provider failures preserve last observation time and back off, including forced callers", async () => {
  const root=scratch();let now=clock,calls=0,fail=false
  const opts={...options(root),now:()=>now,probe:async()=>{calls++;return fail?{state:"unknown" as const,error:"unreachable",retryAfterSeconds:120}:observed(now)}}
  await getAccountUsage(opts);now+=31000;fail=true
  const failed=await getAccountUsage(opts)
  expect(failed.accounts[0].observedAt).toBe(new Date(clock).toISOString())
  expect(failed.accounts[0].freshness?.stale).toBe(true)
  now+=10000;await getAccountUsage({...opts,refresh:true})
  expect(calls).toBe(2)
  expect(readAccountUsage(opts.file,now).accounts[0].state).toBe("unknown")
})

test("a reset boundary triggers a fresh probe even before the normal TTL", async () => {
  const root=scratch();let now=clock,calls=0
  const opts={...options(root),now:()=>now,probe:async()=>{calls++;return parseOpenAIAccountUsage({rate_limit:{primary_window:{used_percent:100,limit_window_seconds:600,reset_after_seconds:10}}},now)}}
  await getAccountUsage(opts)
  now+=11000
  expect(readAccountUsage(opts.file,now).accounts[0].state).toBe("unknown")
  await getAccountUsage(opts)
  expect(calls).toBe(2)
})

test("one failed provider cannot discard other accounts; removing credentials removes cached capacity", async () => {
  const root=scratch();let list=[connection(),connection("two","broker","account-two")]
  const opts={...options(root),discover:()=>({connections:list,diagnostics:[]}),probe:async(c:Connection)=>c.accountID==="account-one"?observed():{state:"auth-required" as const,error:"owner refresh required"}}
  const result=await getAccountUsage(opts)
  expect(result.accounts.map(a=>a.state)).toEqual(["available","auth-required"])
  list=[];expect((await getAccountUsage(opts)).accounts).toEqual([])
})

test("multiple accounts behind one broker remain ambiguous unless the route is account-prefixed", async () => {
  const root=scratch(), first=connection(),second=connection("two","broker","account-two")
  let snapshot=await getAccountUsage({...options(root,[first,second]),probe:async()=>observed()})
  expect(routeAccountCapacity(snapshot,"cliproxyapi","gpt-test",clock)).toMatchObject({state:"unknown",accountIDs:["account-one","account-two"]})
  first.modelPrefix="personal";second.modelPrefix="work"
  snapshot=await getAccountUsage({...options(root,[first,second]),probe:async()=>observed()})
  expect(accountsForRoute(snapshot,"cliproxyapi","work/gpt-test").map(a=>a.id)).toEqual(["account-two"])
  expect(accountsForRoute(snapshot,"cliproxyapi","gpt-test")).toEqual([])
})

test("model-specific exhaustion blocks its model, not every model on the account", async () => {
  const root=scratch()
  const snapshot=await getAccountUsage({...options(root),probe:async()=>parseOpenAIAccountUsage({rate_limit:{primary_window:{used_percent:20,limit_window_seconds:18000,reset_after_seconds:3600}},model_usage:{"gpt-special":{used_percent:100,reset_after_seconds:60}}},clock)})
  expect(routeAccountCapacity(snapshot,"cliproxyapi","gpt-special",clock).state).toBe("exhausted")
  expect(routeAccountCapacity(snapshot,"cliproxyapi","gpt-normal",clock).state).toBe("available")
  const cache=projectAccountUsage(undefined,snapshot,clock)!
  expect(capacitySnapshot(cache,clock).providers.openai.state).toBe("available")
})

test("projection recomputes countdowns, preserves observation ages, and labels each account", async () => {
  const root=scratch(), snapshot=await getAccountUsage({...options(root),probe:async()=>observed()})
  const fresh=projectAccountUsage(undefined,snapshot,clock)!
  const aged=projectAccountUsage(undefined,snapshot,clock+5000)!
  expect(fresh.sources[0].windows![0].resetsInSeconds!-aged.sources[0].windows![0].resetsInSeconds!).toBe(5)
  expect(aged.sources[0].observedAt).toBe(snapshot.accounts[0].observedAt)
  expect(aged.sources[0].displayName).toContain("pro")
})

test("adapter sends credentials only to fixed provider origins and never returns provider error bodies", async () => {
  const requests:any[]=[]
  const fake=async(url:any,init:any)=>{requests.push({url,init});return new Response(JSON.stringify({error:"SECRET_ACCESS_TOKEN"}),{status:401})}
  const result=await probeConnection(connection(),{now:()=>clock,fetch:fake as typeof fetch,refreshPlan:false})
  expect(requests[0].url).toBe("https://chatgpt.com/backend-api/wham/usage")
  expect(requests[0].init.redirect).toBe("error")
  expect(requests[0].init.headers["ChatGPT-Account-Id"]).toBe("private-account-id")
  expect(JSON.stringify(result)).not.toContain("SECRET")
})

test("usage response from the wrong account is rejected rather than merged", async () => {
  const fake=async()=>new Response(JSON.stringify({account_id:"different",rate_limit:{primary_window:{used_percent:0}}}),{status:200})
  const result=await probeConnection(connection(),{now:()=>clock,fetch:fake as typeof fetch,refreshPlan:false})
  expect(result).toMatchObject({state:"unknown",error:"Usage response account identity does not match the selected connection."})
})

test("profile failure preserves valid usage; plan polling is cached separately", async () => {
  const root=scratch();let now=clock;const planRequests:boolean[]=[]
  const c={...connection(),provider:"claude" as const}
  const opts={...options(root,[c]),now:()=>now,probe:async(_c:Connection,o:any)=>{
    planRequests.push(o.refreshPlan)
    return {...observed(now),plan:parseClaudePlan({account:{has_claude_max:true},organization:{rate_limit_tier:"default_claude_max_5x"}},now)}
  }}
  await getAccountUsage(opts);now+=31000;await getAccountUsage(opts)
  expect(planRequests).toEqual([true,false])
  const fake=async(url:any)=>url.endsWith("/profile")?new Response("",{status:503}):new Response(JSON.stringify({five_hour:{utilization:10,resets_at:"2026-09-06T00:00:00Z"}}),{status:200})
  const result=await probeConnection(c,{now:()=>clock,fetch:fake as typeof fetch,refreshPlan:true})
  expect("windows" in result && result.windows[0].usedPercent).toBe(10)
})

test("unsupported adapters are explicit and do not claim an account is unauthenticated", async () => {
  const root=scratch(), c={...connection(),provider:"grok" as const}
  const snapshot=await getAccountUsage({...options(root,[c])})
  expect(snapshot.accounts[0].state).toBe("unsupported")
  expect(snapshot.accounts[0].observedAt).toBeNull()
})

test("cache file contains only complete JSON and owned lock/temp files are released", async () => {
  const root=scratch()
  await getAccountUsage({...options(root),probe:async()=>observed()})
  expect(readdirSync(root).sort()).toEqual(["locks", "usage.json", "usage.json.observations"])
  expect(readdirSync(join(root, "locks"))).toEqual([])
  expect(JSON.parse(readFileSync(join(root,"usage.json"),"utf8")).schema).toBe(1)
})

test("separate processes coalesce provider work through the same cache lock", async () => {
  const root=scratch(), file=join(root,"usage.json"), calls=join(root,"calls.txt")
  const api=resolve(import.meta.dir,"../usage/account-api.ts").replaceAll("\\","/")
  const script=join(root,"worker.ts")
  write(script, "import {getAccountUsage} from "+JSON.stringify(api)+"; import {appendFileSync} from 'node:fs';\n"+
    "const c={id:'one',owner:'broker',provider:'openai',accountID:'shared',identity:'account',plan:"+JSON.stringify(plan)+",routeProviders:['cliproxyapi'],modelPrefix:null,token:()=> 'SECRET'};\n"+
    "await getAccountUsage({file:"+JSON.stringify(file)+",refresh:true,discover:()=>({connections:[c],diagnostics:[]}),probe:async()=>{appendFileSync("+JSON.stringify(calls)+",'call\\n');await new Promise(r=>setTimeout(r,100));return "+JSON.stringify(observed(Date.now()))+"}});")
  const processes=Array.from({length:3},()=>new Promise<string>(resolve=>{
    hiddenExecFile(process.execPath,[script],{timeout:10000},error=>resolve(error?.message??""))
  }))
  expect(await Promise.all(processes)).toEqual(["","",""])
  expect(readFileSync(calls,"utf8").split("call").length-1).toBe(1)
})

test("model availability flags block only the named model without inventing a usage percentage", async () => {
  const root=scratch()
  const snapshot=await getAccountUsage({...options(root),probe:async()=>parseOpenAIAccountUsage({
    rate_limit:{primary_window:{used_percent:1,limit_window_seconds:604800,reset_after_seconds:3600}},
    model_usage:{"gpt-6-astra":{available:false,available_at:"2026-09-05T01:00:00Z",credits_would_enable:true}},
  },clock)})
  const window=snapshot.accounts[0].windows.find(w=>w.model==="gpt-6-astra")!
  expect(window).toMatchObject({state:"exhausted",usedPercent:null,resetAt:"2026-09-05T01:00:00.000Z"})
  expect(routeAccountCapacity(snapshot,"cliproxyapi","gpt-6-astra",clock).state).toBe("exhausted")
  expect(routeAccountCapacity(snapshot,"cliproxyapi","gpt-6-astra-fast",clock).state).toBe("exhausted")
  expect(routeAccountCapacity(snapshot,"cliproxyapi","gpt-6-astra-other",clock).state).toBe("available")
})

test("successful credential is tried first on later refreshes", async () => {
  const root=scratch();let now=clock;const seen:string[]=[]
  const opts={...options(root,[connection(),connection("native","opencode")]),now:()=>now,probe:async(c:Connection)=>{
    seen.push(c.id);return c.id==="first"?{state:"auth-required" as const,error:"expired"}:observed(now)
  }}
  await getAccountUsage(opts);now+=31000;await getAccountUsage(opts)
  expect(seen).toEqual(["first","native","native"])
})

test("invalid cached account documents are repaired by discovery and refresh", async () => {
  const root=scratch(), opts=options(root)
  write(opts.file,{schema:1,accounts:[{id:"account-one"}],diagnostics:[]})
  expect(readAccountUsage(opts.file,clock).accounts).toEqual([])
  expect((await getAccountUsage({...opts,probe:async()=>observed()})).accounts[0].state).toBe("available")
})


test("global usage tool works from two foreign projects without shell commands or project state", async () => {
  const root = scratch(), first = join(root, "project-one"), second = join(root, "project-two")
  mkdirSync(first); mkdirSync(second)
  const home = join(root, "home"), cache = join(root, "state", "account-usage.json")
  write(join(home, ".local/share/opencode/auth.json"), { openai: { type: "oauth", access: "FIXTURE_TOKEN", accountId: "fixture-account" } })
  const plugin = resolve(import.meta.dir, "../usage/server.ts")
  const script = join(root, "invoke-tool.ts")
  write(script, `import plugin from ${JSON.stringify(plugin)};
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url) !== "https://chatgpt.com/backend-api/wham/usage") throw new Error("Unexpected provider");
      calls++;
      return Response.json({account_id:"fixture-account",plan_type:"pro",rate_limit:{primary_window:{used_percent:25,limit_window_seconds:600,reset_after_seconds:300}}});
    };
    const tools = [];
    await plugin.setup({ tool: { transform: async fn => fn({ add: tool => tools.push(tool) }) } });
    const tool = tools.find(t => t.name === "usage_status");
    const result = JSON.parse((await tool.execute({format:"json"})).content);
    const {appendFileSync} = await import("node:fs");
    const {accountRegime} = await import(${JSON.stringify(resolve(import.meta.dir, "../usage/calibration-store.ts"))});
    const account = result.accounts[0], window = account.windows[0], at = Date.parse(window.observedAt);
    appendFileSync(process.env.OPENCODE_ACCOUNT_USAGE_FILE + ".observations", JSON.stringify({id:"previous",accountID:account.id,windowID:window.id,at:at-120000,usedPoints:20,resetAt:Date.parse(window.resetAt),regime:accountRegime(account),precisionPoints:null,reportingDelayMilliseconds:null})+"\\n");
    const again = JSON.parse((await tool.execute({format:"json",sessionID:"unrelated",harvest:true,reservePoints:5,workloads:[{label:"ten Luna requests",accountID:account.id,route:{providerID:"openai",modelID:"gpt-5.6-luna",serviceTier:"standard"},requests:10,tokens:{input:100000,cacheRead:200000,outputIncludingReasoning:10000}}]})).content);
    const targetTool=tools.find(t=>t.name==="usage_target");
    await targetTool.execute({accountID:account.id,deadlineAt:Date.now()+60000,reservePoints:7,questPacing:{windowID:window.id,maxConcurrent:4}});
    const targeted=JSON.parse((await tool.execute({format:"json"})).content);
    await targetTool.execute({accountID:account.id,deadlineAt:null});
    console.log(JSON.stringify({result,again,targeted,calls}));`)
  const run = (cwd: string) => new Promise<any>((done, reject) => {
    let stdout = ""
    const child = hiddenExecFile(process.execPath, [script], { cwd, timeout: 10000, env: {
      ...process.env, OPENCODE_ACCOUNT_DISCOVERY_ROOT: home, OPENCODE_ACCOUNT_USAGE_FILE: cache,
    } }, error => { if (error) reject(error); else { try { done(JSON.parse(stdout)) } catch (e) { reject(e) } } })
    child.stdout?.on("data", chunk => stdout += chunk)
  })
  const a = await run(first), b = await run(second)
  expect(a.calls).toBe(1); expect(b.calls).toBe(0)
  expect(a.targeted.planning[0].reservePoints).toBe(7);expect(a.targeted.planning[0].minutesToTarget).toBeLessThanOrEqual(1)
  expect(a.targeted.burnControl[0].desiredConcurrency).toBe(1);expect(a.targeted.burnControl[0].maxConcurrent).toBe(4);expect(b.targeted.burnControl[0].windowID).toBe(b.result.accounts[0].windows[0].id)
  expect(a.targeted.accounting.targets[0].state).toBe("active")
  expect(a.result.accounts[0].plan.name).toBe("pro")
  expect(a.result.accounts[0].windows[0].remainingPercent).toBe(75)
  expect(b.result.accounts[0].id).toBe(a.result.accounts[0].id)
  expect(b.result.accounts[0].observedAt).toBe(a.result.accounts[0].observedAt)
  expect(a.again.harvest.source).toBe("codex-rollout-counters")
  expect(a.again.harvest.sessions).toEqual([])
  expect(a.again.planning[0].observedPointsPerMinute).toBe(2.5)
  expect(a.again.planning[0].spendablePoints).toBe(70)
  expect(b.again.planning[0].observedPointsPerMinute).toBe(2.5)
  expect(a.again.workloads[0].creditEquivalent.credits).toBeCloseTo(9)
  expect(a.again.workloads[0].windows[0].estimate).toBeNull()
  expect(a.again.telemetry.planning).toEqual(a.again.planning)
  expect(a.again.accounts[0].observedAt).toBe(a.result.accounts[0].observedAt)
  expect(JSON.stringify(a.result)).not.toContain("FIXTURE_TOKEN")
  expect(readdirSync(first)).toEqual([]); expect(readdirSync(second)).toEqual([])
  expect(existsSync(cache)).toBe(true)
})
