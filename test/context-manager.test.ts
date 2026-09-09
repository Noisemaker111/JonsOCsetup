import {expect,test} from "bun:test"
import {decideContext,ContextCheckpoints,hostCompactionAdapter,type RecoverableContext} from "../models/context-manager"
import {mkdtempSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
const forecast={currentTokens:50000,retainedTokens:5000,remainingInputs:8,cacheHitFraction:0.5,retainedCacheHitFraction:0,uncachedUnitCost:1,cachedUnitCost:0.1,checkpointCost:10000,retrievalCost:1000,qualityRisk:0.1,costUnit:"estimated units"}
const boundary={safe:true,pendingTools:0,pendingWorkerResults:0,revision:2,checkpointRevision:2,newlyAddedTokens:20000,requiredOutputTokens:1000,toolHeadroomTokens:1000}
const policy={automatic:true,minSavings:100,maxQualityRisk:0.2,minNewTokensSinceCompaction:5000}
test("context compaction compares repeated cost with cache loss and quality at safe boundaries",()=>{
 expect(decideContext(forecast,boundary,policy).action).toBe("compact")
 expect(decideContext({...forecast,remainingInputs:1,cacheHitFraction:1,cachedUnitCost:0.001},boundary,policy).action).toBe("retain")
 expect(decideContext({...forecast,qualityRisk:0.8},boundary,policy).action).toBe("retain")
 expect(decideContext(forecast,{...boundary,pendingTools:1},policy).action).toBe("wait")
 expect(decideContext(forecast,{...boundary,revision:3},policy).action).toBe("checkpoint")
 expect(decideContext(forecast,{...boundary,userChoice:"retain"},policy).action).toBe("retain")
 expect(decideContext(forecast,{...boundary,newlyAddedTokens:0},policy).action).toBe("retain")
})
test("overflow uses the actual route limit and headroom, independently of cumulative usage",()=>{
 const f={...forecast,currentTokens:10000,retainedTokens:5000}
 expect(decideContext(f,{...boundary,verifiedRouteLimit:12000},{...policy,automatic:false}).action).toBe("retain")
 expect(decideContext(f,{...boundary,verifiedRouteLimit:11000},{...policy,automatic:false}).overflow).toBe(true)
 expect(decideContext(f,boundary,{...policy,automatic:false}).overflow).toBe(false)
})
const context:RecoverableContext={revision:2,intent:"Complete the change",corrections:["Preserve API"],permissions:["Local commits only"],decisions:["Use existing API"],unresolved:["Verify host"],questIDs:["q"],pendingResults:[],historyReferences:["session:original"],nextVerification:["Run focused tests"]}
test("checkpoints retain permissions and history, activate only on host confirmation and reject newer corrections",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"usage-context-"));try{const store=new ContextCheckpoints(dir),c=store.prepare("session",context,"Completed step",50000);await expect(store.request(c,3,async()=>({receipt:"r"}))).rejects.toThrow("corrections");await expect(store.request(c,2)).rejects.toThrow("unavailable");const requested=await store.request(c,2,async()=>({receipt:"r"}));expect(requested.state).toBe("requested");expect(store.confirm("session",c.id,{currentRevision:3,hostReceipt:"r",afterTokens:5000,success:true}).state).toBe("superseded");expect(store.read("session")[0].context.permissions).toEqual(["Local commits only"]);expect(store.read("session")[0].context.historyReferences).toEqual(["session:original"])}finally{rmSync(dir,{recursive:true,force:true})}
})
test("unknown compaction transport outcomes retain the previous context and prohibit duplicate requests",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"usage-context-"));try{const store=new ContextCheckpoints(dir),c=store.prepare("session",context,"Boundary");await expect(store.request(c,2,async()=>{throw new Error("transport interrupted")})).rejects.toThrow("interrupted");expect(store.read("session")[0].state).toBe("requested");expect(store.read("session")[0].error).toContain("interrupted");await expect(store.request(c,2,async()=>({receipt:"second"}))).rejects.toThrow("reconcile")}finally{rmSync(dir,{recursive:true,force:true})}
})
test("adapter uses verified HTTP compaction admission and requires an actual host receipt",async()=>{
 let path="",body="";const adapter=hostCompactionAdapter("http://127.0.0.1:9999",(async(url:any,init:any)=>{path=String(url);body=init.body;return Response.json({data:{id:"msg_receipt",sessionID:"session",type:"compaction"}})}) as any)
 expect(await adapter({sessionID:"session",checkpointID:"local"})).toEqual({receipt:"msg_receipt"});expect(path).toEndWith("/api/session/session/compact");expect(body).toBe("{}");expect(()=>hostCompactionAdapter("https://unrelated.example")).toThrow("owning local")
})
