import {test,expect} from "bun:test"
import {mkdtempSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {AdaptiveContextRuntime} from "../models/context-runtime"
const context={intent:"Finish",corrections:[],permissions:["Local commits only"],decisions:[],unresolved:["Verify"],questIDs:[],pendingResults:[],historyReferences:["session:s"],nextVerification:["bun test"]}
const forecast={currentTokens:1000,retainedTokens:100,remainingInputs:10,cacheHitFraction:0,retainedCacheHitFraction:0,uncachedUnitCost:1,cachedUnitCost:0.1,checkpointCost:10,retrievalCost:1,qualityRisk:0.1,costUnit:"estimated units"}
const policy={automatic:true,minSavings:0,maxQualityRisk:0.2,minNewTokensSinceCompaction:100}
const record:any={id:"r",sessionID:"s",kind:"primary",startedAt:10,state:"completed",completedAt:11,route:{providerID:"p",modelID:"m"},tokens:{input:1000,cacheRead:0,cacheWrite:0,output:10,reasoning:0},context:{tokens:1000,source:"provider",at:10}}
const event=(id:string,type:string,data:any={},at=20)=>({id,type,created:at,data:{sessionID:"s",...data}})
test("pending tools and newer user corrections prevent automatic compaction",async()=>{const dir=mkdtempSync(join(tmpdir(),"context-runtime-"));let calls=0;try{const runtime=new AdaptiveContextRuntime(dir,{policy:()=>policy,headroom:()=>({output:100,tools:100}),records:()=>[record],compact:async()=>{calls++;return {receipt:"receipt"}}});runtime.prepare("s",context,forecast,"Step boundary");runtime.tool("s","tool",true);expect((await runtime.boundary("s"))?.action).toBe("wait");runtime.tool("s","tool",false);const correction=event("input","session.inbox.enqueued",{inboxID:"user",item:{type:"user",payload:{text:"Preserve the original API"}}});await runtime.event(correction);await runtime.event(correction);expect(runtime.inspect("s").revision).toBe(1);expect((await runtime.boundary("s"))?.action).toBe("checkpoint");expect(calls).toBe(0);const saved=runtime.prepare("s",context,forecast,"Updated plan");expect(saved.context.corrections).toContain("Preserve the original API");await runtime.boundary("s");expect(calls).toBe(1)}finally{rmSync(dir,{recursive:true,force:true})}})
test("manual native compaction activates the matching checkpoint and later measures actual context",async()=>{const dir=mkdtempSync(join(tmpdir(),"context-runtime-"));let records=[record];try{const runtime=new AdaptiveContextRuntime(dir,{policy:()=>policy,records:()=>records});runtime.prepare("s",context,forecast,"Checkpoint");await expect(runtime.choose("s","compact")).rejects.toThrow("does not expose");await runtime.event(event("start","session.compaction.started",{inputID:"native"},20));expect(runtime.inspect("s").checkpoint?.state).toBe("requested");await runtime.event(event("end","session.compaction.ended",{},30));expect(runtime.inspect("s").checkpoint?.state).toBe("active");expect(runtime.inspect("s").checkpoint?.afterTokens).toBeUndefined();records=[record,{...record,id:"after",startedAt:40,context:{tokens:200,source:"provider",at:40}}];expect(runtime.inspect("s").checkpoint?.afterTokens).toBe(200);expect(runtime.checkpointText("s")).toContain("Local commits only")}finally{rmSync(dir,{recursive:true,force:true})}})
test("unknown admission remains recoverable across runtime restarts",async()=>{const dir=mkdtempSync(join(tmpdir(),"context-runtime-"));const options={policy:()=>policy,headroom:()=>({output:100,tools:100}),records:()=>[record],compact:async()=>{throw Error("transport unknown")}};try{const runtime=new AdaptiveContextRuntime(dir,options);runtime.prepare("s",context,forecast,"Boundary");await runtime.boundary("s");const resumed=new AdaptiveContextRuntime(dir,options);expect(resumed.inspect("s").checkpoint?.state).toBe("requested");expect(resumed.inspect("s").error).toContain("transport unknown");expect(await resumed.boundary("s")).toBeUndefined()}finally{rmSync(dir,{recursive:true,force:true})}})

test("successive checkpoints retain corrections, permissions and history while allowing work to resolve",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"context-retained-"));try{
 const runtime=new AdaptiveContextRuntime(dir,{policy:()=>policy,records:()=>[record]})
 await runtime.event(event("first-input","session.inbox.enqueued",{inboxID:"first",item:{type:"user",payload:{text:"Keep the public API"}}}))
 runtime.prepare("s",context,forecast,"First step")
 await runtime.event(event("second-input","session.inbox.enqueued",{inboxID:"second",item:{type:"user",payload:{text:"The old API can be replaced"}}}))
 await runtime.event(event("third-input","session.inbox.enqueued",{inboxID:"third",item:{type:"user",payload:{text:"Keep the public API"}}}))
 const resumed=new AdaptiveContextRuntime(dir,{policy:()=>policy,records:()=>[record]})
 const checkpoint=resumed.prepare("s",{...context,permissions:[],corrections:[],historyReferences:["session:next"],unresolved:[]},forecast,"Next step")
 expect(checkpoint.context.permissions).toContain("Local commits only")
 expect(checkpoint.context.corrections).toEqual(["The old API can be replaced","Keep the public API"])
 expect(checkpoint.context.historyReferences).toContain("session:s/inbox:first")
 expect(checkpoint.context.unresolved).toEqual([])
 expect(resumed.checkpointText("s")).toContain("Local commits only")
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test("pending admission cannot be replaced and unrelated failures cannot corrupt its receipt",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"context-receipt-"));try{
 const runtime=new AdaptiveContextRuntime(dir,{policy:()=>policy,records:()=>[record]})
 runtime.prepare("s",context,forecast,"Boundary")
 await runtime.event(event("start-current","session.compaction.started",{inputID:"current"}))
 expect(()=>runtime.prepare("s",context,forecast,"Replacement")).toThrow("still pending")
 await runtime.event(event("failure-old","session.compaction.failed",{inputID:"old"}))
 expect(runtime.inspect("s").checkpoint?.state).toBe("requested")
 await runtime.event(event("end-current","session.compaction.ended",{},30))
 expect(runtime.inspect("s").checkpoint?.state).toBe("active")
 await runtime.event(event("late-failure","session.compaction.failed",{inputID:"current"},40))
 expect(runtime.state("s").compaction?.outcome).toBe("active")
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test("boundary rechecks instructions, tools, execution and choices after route lookup",async()=>{
 for(const change of ["correction","tool","execution","retain","replacement"]){
  const dir=mkdtempSync(join(tmpdir(),"context-boundary-race-"));let release!:(limit:number)=>void,calls=0
  try{
   const runtime=new AdaptiveContextRuntime(dir,{policy:()=>policy,headroom:()=>({output:100,tools:100}),records:()=>[record],routeLimit:()=>new Promise(resolve=>{release=resolve}),compact:async()=>{calls++;return {receipt:"native"}}})
   runtime.prepare("s",context,forecast,"Before lookup")
   const pending=runtime.boundary("s")
   if(change==="correction")await runtime.event(event("new-correction","session.inbox.enqueued",{inboxID:"new",item:{type:"user",payload:{text:"Keep the current design"}}}))
   if(change==="tool")runtime.tool("s","new-tool",true)
   if(change==="execution")await runtime.event(event("new-execution","session.execution.started"))
   if(change==="retain")await runtime.choose("s","retain")
   if(change==="replacement")runtime.prepare("s",context,{...forecast,qualityRisk:1},"Revised quality risk")
   release(10000)
   const decision=await pending
   expect(decision?.action).toBe(change==="correction"?"checkpoint":change==="tool"||change==="execution"?"wait":"retain")
   expect(calls).toBe(0)
   expect(runtime.inspect("s").checkpoint?.state).toBe("prepared")
  }finally{rmSync(dir,{recursive:true,force:true})}
 }
})
