import {testRender} from "@opentui/solid"
import {mkdirSync,writeFileSync} from "node:fs"
import {resolve} from "node:path"
const out=resolve("run/passive-render");mkdirSync(out,{recursive:true})
process.env.OPENCODE_TELEMETRY_FILE=out+"/requests.jsonl"
const {recordRequest}=await import("../usage/telemetry-store")
recordRequest({id:"r",sessionID:"fixture",route:{providerID:"fixture",modelID:"model"},kind:"chat",startedAt:Date.now()-100,completedAt:Date.now(),state:"completed",tokens:{input:2050000,cacheRead:10000000,cacheWrite:0,output:4500000,reasoning:500000}})
const {ContextFooter}=await import("../usage/tui-active/usage")
const context={sessionID:"fixture"}
for(const width of [80,120]){
 const setup=await testRender(()=>ContextFooter({context}),{width,height:4})
 try{await setup.renderOnce();await new Promise(r=>setTimeout(r,100));await setup.renderOnce();const frame=setup.captureCharFrame();writeFileSync(out+"/footer-"+width+".txt",frame);if(!frame.includes("2,050,000 uncached")||!frame.includes("10,000,000 cached")||!frame.includes("5,000,000 out"))throw Error("Session footer missing counters at "+width);console.log(JSON.stringify({width,frame:frame.trim()}))}finally{setup.renderer.destroy()}
}
