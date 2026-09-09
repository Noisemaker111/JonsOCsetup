import {expect,test} from "bun:test"
import {mkdtempSync,writeFileSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {reserveDispatch} from "../models/dispatch-planner"
import {relevantAccountWindows} from "../usage/account-api"
import type {PlannerInput} from "../models/route-planner"
import fixture from "./fixtures/routing-19h.json"
function setup(){
 const input=structuredClone(fixture) as PlannerInput,route=input.routes[0],account=input.accounts.find(a=>a.id===route.accountID)!
 route.modelID="claude-opus-4";route.quotaPerTask.special=10
 const other={...structuredClone(route),id:"other-model",modelID:"claude-sonnet-4"};delete other.quotaPerTask.special
 input.routes=[route,other];input.accounts=[account];input.request.allowedRouteIDs=input.routes.map(r=>r.id);input.request.reserveFraction=0
 const snapshot:any={schema:1,updatedAt:input.request.now,diagnostics:[],accounts:[{id:account.id,state:"available",observedAt:account.observedAt,connections:[{routeProviders:[route.providerID],modelPrefix:null}],plan:{name:"fixture"},windows:[...account.windows.map(w=>({id:w.id,scope:"shared",state:"available",remainingPercent:w.remaining,resetAt:w.resetAt})),{id:"special",scope:"model",model:"claude-opus",state:"available",remainingPercent:10,resetAt:account.windows[0].resetAt}]}]}
 return {input,snapshot,route,other}
}
async function exercise(body:(ctx:any)=>Promise<void>){const dir=mkdtempSync(join(tmpdir(),"model-window-"));try{const ctx=setup(),policyFile=join(dir,"policy.json"),reservationFile=join(dir,"holds.json");writeFileSync(policyFile,JSON.stringify({version:1,request:ctx.input.request,routes:ctx.input.routes,billing:{[ctx.route.accountID]:"subscription"}}));const run=(id:string,route=ctx.route)=>reserveDispatch({runID:id,model:route.providerID+"/"+route.modelID+"#"+route.reasoning,policyFile,reservationFile,now:Date.parse(ctx.input.request.now)},async()=>ctx.snapshot);await body({...ctx,run})}finally{rmSync(dir,{recursive:true,force:true})}}
test("dispatch rejects exhausted, unknown and reset model windows without blocking unrelated models",async()=>{
 for(const state of ["exhausted","unknown","reset"]){await exercise(async({snapshot,run,other}:any)=>{const w=snapshot.accounts[0].windows.at(-1);if(state==="reset")w.resetAt="2026-09-04T11:00:00Z";else w.state=state;await expect(run("blocked")).rejects.toThrow("special");expect((await run("other",other)).route.id).toBe(other.id)})}
})
test("model holds share the account ledger and shared quota still gates every route",async()=>{await exercise(async({snapshot,run,other}:any)=>{
 const first=await run("first");expect(first.ledger.get("first").windows.special).toBe(10);await expect(run("second")).rejects.toThrow("special")
 const unrelated=await run("other",other);expect(unrelated.ledger.get("other").windows.special).toBeUndefined();expect(unrelated.ledger.get("other").exclusive).toBe(false)
 snapshot.accounts[0].windows[0].remainingPercent=0;await expect(run("shared-block",other)).rejects.toThrow("session")
})})
test("account views and dispatch use the same model-family and prefix selection",()=>{
 const {snapshot}=setup(),account=snapshot.accounts[0]
 expect(relevantAccountWindows(account,"vendor/claude-opus-4").map(w=>w.id)).toContain("special")
 expect(relevantAccountWindows(account,"claude-sonnet-4").map(w=>w.id)).not.toContain("special")
 account.windows.at(-1).model="gpt-example";expect(relevantAccountWindows(account,"gpt-example-fast").map(w=>w.id)).toContain("special")
})

test("dispatch never reserves an account when the transport can select a second subscription",async()=>{await exercise(async({snapshot,run}:any)=>{
 snapshot.accounts.push({...structuredClone(snapshot.accounts[0]),id:"second-subscription"})
 await expect(run("ambiguous")).rejects.toThrow("unverified")
})})
