import { resolveHostExecutable } from '../project-router/executable.mjs'
/** Actual isolated host + deterministic HTTP provider. No model quota is consumed. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
const root = resolve(import.meta.dir,".."), dir = join(root,".visual-e2e","quest-host-"+Date.now())
mkdirSync(dir,{recursive:true})
mkdirSync(join(dir,"empty-auth")) // discoveryPaths() routes ALL credential stores here; no live account discovery.
const git=Bun.spawnSync(["git","init",dir],{windowsHide:true});if(git.exitCode!==0)throw new Error("Fixture git init failed")
const committed=Bun.spawnSync(["git","-C",dir,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","--allow-empty","-m","Fixture base"],{windowsHide:true});if(committed.exitCode!==0)throw new Error("Fixture commit failed")
const { projectIdentity }=await import("../quest/project")
const policyFile=join(dir,"dispatch-policy.json")
writeFileSync(policyFile,JSON.stringify({version:1,commandsByProject:{[projectIdentity(dir).id]:{check:{description:"Fixture verification",argv:[process.execPath,"-e","require('fs').writeFileSync('verified.txt','verified');console.log('verified')"],timeoutMilliseconds:5000}}}}))
let calls = 0
let toolResultPassed = false,checkpointVisible=false
const { readAllQuests } = await import("../quest/index")
const server = Bun.serve({port:0, async fetch(request) {
  const payload = await request.json() as any
  if (payload.model !== "model") return new Response("Unexpected fixture model",{status:400})
  calls++
  checkpointVisible ||= payload.messages?.some((m:any)=>["system","developer"].includes(m.role)&&JSON.stringify(m.content).includes("CHECKPOINT_PERMISSION"))===true
  toolResultPassed ||= payload.messages?.some((m:any)=>m.role==="tool"&&String(m.content).includes("QUEST_OPERATIONS_OK"))===true
  writeFileSync(join(dir,"provider-"+calls+".json"),JSON.stringify(payload,null,2))
  const needsQuest = Array.isArray(payload.tools) && payload.tools.some((t:any)=>t.function?.name==="execute") && !payload.messages?.some((m:any)=>m.role==="tool")
  const chunks = needsQuest ? [{id:"fixture",object:"chat.completion.chunk",model:"model",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"create-quest",type:"function",function:{name:"execute",arguments:JSON.stringify({code:"await tools.context_checkpoint({\"action\":\"prepare\",\"reason\":\"Fixture checkpoint\",\"context\":{\"intent\":\"Verify the host\",\"corrections\":[],\"permissions\":[\"CHECKPOINT_PERMISSION: local fixture only\"],\"decisions\":[],\"unresolved\":[\"Finish the fixture\"],\"questIDs\":[],\"pendingResults\":[],\"historyReferences\":[\"fixture history\"],\"nextVerification\":[\"Verify tool result\"]},\"forecast\":{\"currentTokens\":100,\"retainedTokens\":20,\"remainingInputs\":2,\"cacheHitFraction\":0,\"retainedCacheHitFraction\":0,\"uncachedUnitCost\":1,\"cachedUnitCost\":0.1,\"checkpointCost\":1,\"retrievalCost\":1,\"qualityRisk\":0,\"costUnit\":\"fixture estimates\"}}); const q = await tools.quest({action:\"create\",create:{title:\"Host fixture Quest\",description:\"Verify actual tool contract\",steps:[{title:\"Check typed tool\",commandID:\"check\"}]}}); const listed = await tools.quest({action:\"list\"}); const run = await tools.quest({action:\"run\",id:q.id}); await tools.quest({action:\"update\",id:q.id,update:{reward:\"Run the configured check; local fixture only\"}}); const detail = await tools.quest({action:\"get\",id:q.id}); if (!listed.items.some(x=>x.id===q.id) || run.state!==\"completed\" || detail.steps[0].state!==\"done\" || !detail.changes.some(c=>c.files.some(f=>f.path===\"verified.txt\"))) throw new Error(\"Quest operation verification failed\"); const usage = await tools.usage_status({format:\"json\"}); if (usage.accounts.length !== 0) throw new Error(\"Fixture isolation failed\"); if (!usage.telemetry || usage.telemetry.requests < 1) throw new Error(\"Missing synthetic request telemetry\"); return {marker:\"QUEST_OPERATIONS_OK\",id:q.id,runState:run.state,steps:detail.steps.length,syntheticRequestCount:usage.telemetry.requests};"})}}]},finish_reason:null}]},{id:"fixture",object:"chat.completion.chunk",model:"model",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]}] : [
    {id:"fixture",object:"chat.completion.chunk",model:"model",choices:[{index:0,delta:{role:"assistant",content:"TELEMETRY_HOST_OK"},finish_reason:null}]},
    {id:"fixture",object:"chat.completion.chunk",model:"model",choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:120,completion_tokens:12,prompt_tokens_details:{cached_tokens:40},completion_tokens_details:{reasoning_tokens:2}}},
  ]
  return new Response(chunks.map(c=>"data: "+JSON.stringify(c)+"\n\n").join("")+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}})
}})
writeFileSync(join(dir,"opencode.jsonc"),JSON.stringify({plugin:[pathToFileURL(join(root,"quest/server.ts")).href],providers:{"telemetry-fixture":{name:"Telemetry fixture",package:"@opencode-ai/ai/providers/openai-compatible",env:[],settings:{baseURL:"http://127.0.0.1:"+server.port+"/v1",apiKey:"fixture-only"},models:{model:{name:"Fixture",limit:{context:128000,output:1000}}}}}}))
const pluginDir = join(dir,"plugin"); mkdirSync(pluginDir)
writeFileSync(join(pluginDir,"index.ts"), "import quests from " + JSON.stringify(pathToFileURL(join(root,"quest/server.ts")).href) + "; import usage from " + JSON.stringify(pathToFileURL(join(root,"usage/server.ts")).href) + "; import {installAdaptiveContext} from " + JSON.stringify(pathToFileURL(join(root,"models/context-plugin.ts")).href) + "; export default {id: \"quest-usage-fixture\", async setup(ctx) {await quests.setup(ctx);await usage.setup(ctx);await installAdaptiveContext(ctx)}}\n")
writeFileSync(join(pluginDir,"package.json"),JSON.stringify({name:"telemetry-fixture-plugin",version:"1.0.0",main:"index.ts",type:"module"}))
const config = JSON.parse(readFileSync(join(dir,"opencode.jsonc"),"utf8")); config.plugin=["./plugin"]; writeFileSync(join(dir,"opencode.jsonc"),JSON.stringify(config))
const telemetry = join(dir,"requests.jsonl")
const proc = Bun.spawn([resolveHostExecutable(),"run","--standalone","--print-logs","--agent","general","-m","telemetry-fixture/model","Reply with the requested marker."],{cwd:dir,env:{...process.env,OPENCODE_CONFIG_DIR:dir,OPENCODE_CONFIG_PROJECT_DISABLE:"1",OPENCODE_DISPATCH_POLICY:policyFile,OPENCODE_QUEST_ROOT:join(dir,"ledger"),OPENCODE_ACCOUNT_DISCOVERY_ROOT:join(dir,"empty-auth"),OPENCODE_ACCOUNT_USAGE_FILE:join(dir,"accounts.json"),OPENCODE_TELEMETRY_FILE:telemetry,OPENCODE_DB:join(dir,"host.db"),XDG_DATA_HOME:join(dir,"data"),XDG_STATE_HOME:join(dir,"state"),XDG_CACHE_HOME:join(dir,"cache"),OPENCODE_DISABLE_AUTOUPDATE:"1"},stdin:"ignore",stdout:"pipe",stderr:"pipe",windowsHide:true})
const timer = setTimeout(()=>proc.kill(),60000)
try {
  const [code,out,err] = await Promise.all([proc.exited,new Response(proc.stdout).text(),new Response(proc.stderr).text()])
  let records:any[]=[]
  try { records=readFileSync(telemetry,"utf8").trim().split("\n").map(line=>JSON.parse(line).request) } catch {}
  const completed=records.filter(r=>r.state==="completed")
  const quests=readAllQuests(join(dir,"ledger"),{includeArchived:true}).flatMap(q=>q.quest?[q.quest]:[])
  const checks={checkpoint:checkpointVisible,toolResult:toolResultPassed,host:code===0,provider:calls>0,marker:(out+err).includes("TELEMETRY_HOST_OK"),quest:quests.some(q=>q.title==="Host fixture Quest"&&q.contractVersion===2&&q.project?.root===dir)}
  const ok=Object.values(checks).every(Boolean)
  const report={ok,checks,calls,code,out,err,records,quests,fixture:"deterministic HTTP counters, not a real-model benchmark"}
  writeFileSync(join(dir,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({ok,checks,report:join(dir,"report.json")}));process.exitCode=ok?0:1
} finally { clearTimeout(timer);server.stop(true) }
