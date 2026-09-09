/** @jsxImportSource @opentui/solid */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { Resvg } from "@resvg/resvg-js"
import { frameToSvg } from "./opencode-visual-e2e"
const label = process.argv[2] ?? "usage"
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid capture label")
const out = join(import.meta.dir, "..", ".visual-e2e", "usage-redesign"), fixture = join(out, "fixture")
mkdirSync(fixture, { recursive: true })
process.env.OPENCODE_ACCOUNT_DISCOVERY_ROOT = fixture
process.env.OPENCODE_ACCOUNT_USAGE_FILE = join(fixture, "accounts.json")
process.env.OPENCODE_USAGE_CACHE_FILE = join(fixture, "cache.json")
process.env.OPENCODE_TELEMETRY_FILE = join(fixture, "requests.jsonl")
writeFileSync(process.env.OPENCODE_USAGE_CACHE_FILE, JSON.stringify({ updated:new Date().toISOString(), sources:[] }))
const now = Date.now()
writeFileSync(process.env.OPENCODE_TELEMETRY_FILE, JSON.stringify({ version:1, request:{ id:"fixture-request", sessionID:"fixture-session", route:{providerID:"fixture",modelID:"fixture"}, kind:"chat", startedAt:now-4000, completedAt:now-1000, firstVisibleAt:now-3000,lastOutputAt:now-1000,state:"completed",tokens:{input:1000,cacheRead:2000,cacheWrite:0,output:100,reasoning:50},context:{tokens:3000,source:"provider",at:now-4000} } }) + "\n")
const { UsageDialog } = await import("../usage/tui-active/usage")
const context = { renderer:{height:40,width:100}, ui:{router:{current:()=>({type:"session",sessionID:"fixture-session"})},dialog:{clear:()=>{}}}, client:{session:{context:async()=>({data:[]})}} }
const setup = await testRender(()=><UsageDialog context={context}/>, {width:100,height:40})
try {
  await setup.renderOnce(); await Bun.sleep(250); await setup.renderOnce()
  const spans = setup.captureSpans(), text = setup.captureCharFrame(), svg = frameToSvg(spans, "Usage " + label)
  writeFileSync(join(out,label+".txt"),text);writeFileSync(join(out,label+".svg"),svg)
  writeFileSync(join(out,label+".png"),new Resvg(svg,{font:{loadSystemFonts:true}}).render().asPng())
  console.log(JSON.stringify({capture:join(out,label+".png"),source:"Actual UsageDialog with isolated deterministic telemetry fixture"}))
} finally { setup.renderer.destroy() }
