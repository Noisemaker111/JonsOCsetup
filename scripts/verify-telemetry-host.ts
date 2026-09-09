import { resolveHostExecutable } from '../project-router/executable.mjs'
import {readHostCounters} from "../usage/host-counters"
import {readLedger,summarizeLedger} from "../usage/passive-ledger"
import {sessionTokenLine} from "../usage/session-count"
/** Actual isolated host + deterministic HTTP provider. No model quota is consumed. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
const root = resolve(import.meta.dir,".."), dir = join(root,".visual-e2e","telemetry-host-"+Date.now())
mkdirSync(dir,{recursive:true})
let calls = 0
const server = Bun.serve({port:0, async fetch(request) {
  const payload = await request.json() as any
  if (payload.model !== "model") return new Response("Unexpected fixture model",{status:400})
  calls++
  const chunks = [
    {id:"fixture",object:"chat.completion.chunk",model:"model",choices:[{index:0,delta:{role:"assistant",content:"TELEMETRY_HOST_OK"},finish_reason:null}]},
    {id:"fixture",object:"chat.completion.chunk",model:"model",choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:120,completion_tokens:12,prompt_tokens_details:{cached_tokens:40},completion_tokens_details:{reasoning_tokens:2}}},
  ]
  return new Response(chunks.map(c=>"data: "+JSON.stringify(c)+"\n\n").join("")+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}})
}})
writeFileSync(join(dir,"opencode.jsonc"),JSON.stringify({plugin:[pathToFileURL(join(root,"usage/server.ts")).href],providers:{"telemetry-fixture":{name:"Telemetry fixture",package:"@opencode-ai/ai/providers/openai-compatible",env:[],settings:{baseURL:"http://127.0.0.1:"+server.port+"/v1",apiKey:"fixture-only"},models:{model:{name:"Fixture",limit:{context:128000,output:1000}}}}}}))
const pluginDir = join(dir,"plugin"); mkdirSync(pluginDir)
writeFileSync(join(pluginDir,"index.ts"), "export { default } from " + JSON.stringify(pathToFileURL(join(root,"usage/server.ts")).href) + "\n")
writeFileSync(join(pluginDir,"package.json"),JSON.stringify({name:"telemetry-fixture-plugin",version:"1.0.0",main:"index.ts",type:"module"}))
const config = JSON.parse(readFileSync(join(dir,"opencode.jsonc"),"utf8")); config.plugin=["./plugin"]; writeFileSync(join(dir,"opencode.jsonc"),JSON.stringify(config))
const telemetry = join(dir,"requests.jsonl")
const proc = Bun.spawn([resolveHostExecutable(),"run","--standalone","--print-logs","--agent","general","-m","telemetry-fixture/model","Reply with the requested marker."],{cwd:dir,env:{...process.env,OPENCODE_CONFIG_DIR:dir,OPENCODE_CONFIG_PROJECT_DISABLE:"1",CODEX_HOME:join(dir,"empty-codex"),XDG_DATA_HOME:join(dir,"data"),XDG_STATE_HOME:join(dir,"state"),XDG_CACHE_HOME:join(dir,"cache"),OPENCODE_PASSIVE_LEDGER_FILE:telemetry+".ledger.sqlite",OPENCODE_ACCOUNT_DISCOVERY_ROOT:join(dir,"empty-auth"),OPENCODE_ACCOUNT_USAGE_FILE:join(dir,"accounts.json"),OPENCODE_TELEMETRY_FILE:telemetry,OPENCODE_DB:join(dir,"host.db"),OPENCODE_DISABLE_AUTOUPDATE:"1"},stdin:"ignore",stdout:"pipe",stderr:"pipe",windowsHide:true})
const timer = setTimeout(()=>proc.kill(),60000)
try {
  const [code,out,err] = await Promise.all([proc.exited,new Response(proc.stdout).text(),new Response(proc.stderr).text()])
  let records:any[]=[]
  try { records=readFileSync(telemetry,"utf8").trim().split("\n").map(line=>JSON.parse(line).request) } catch {}
  const completed=records.filter(r=>r.state==="completed")
  const ledger=readLedger({},telemetry+".ledger.sqlite"),counts=summarizeLedger(ledger.rows)
  const hostRows=readHostCounters({file:join(dir,"host.db")}).rows,hostCounters=summarizeLedger(hostRows)
  const checks={nativeHostCounters:hostRows.length>0&&hostRows.length<=calls&&hostRows.every(r=>r.tokens.input===80&&r.tokens.cacheRead===40&&r.tokens.output===10&&r.tokens.reasoning===2),durableCounters:counts.totals.input===80*calls&&counts.outputIncludingReasoning===12*calls,sessionDisplay:completed.some(r=>sessionTokenLine([r],r.sessionID).includes("80 uncached")),host:code===0,provider:calls>0,marker:(out+err).includes("TELEMETRY_HOST_OK"),tokens:completed.some(r=>r.tokens.input===80&&r.tokens.cacheRead===40&&r.tokens.output===10&&r.tokens.reasoning===2),identity:completed.length>0&&completed.every(r=>r.sessionID&&r.route.providerID==="telemetry-fixture")}
  const ok=Object.values(checks).every(Boolean)
  const report={ok,checks,calls,hostCounterMessages:hostRows.length,hostNote:"Message counters may omit auxiliary model calls; HTTP counters cover every fixture request.",code,out,err,records,fixture:"deterministic HTTP counters, not a real-model benchmark"}
  writeFileSync(join(dir,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({ok,checks,report:join(dir,"report.json")}));process.exitCode=ok?0:1
} finally { clearTimeout(timer);server.stop(true) }
