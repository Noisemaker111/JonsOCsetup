import {test,expect} from "bun:test"
import {measuredOutcomeRoutes} from "../models/measured-outcomes"
import {planRoutes,type PlannerInput} from "../models/route-planner"
import type {Trial} from "../usage/benchmark-evaluation"
import type {RequestRecord} from "../usage/telemetry"
import fixture from "./fixtures/routing-19h.json"
function observations(){const input=structuredClone(fixture) as PlannerInput,route=input.routes[0],end=Date.parse(input.request.now)-1000;input.routes=[route];input.request.allowedRouteIDs=[route.id];input.request.minTrials=2;input.request.minSuccessRate=0.5;input.request.maxCashPerSuccess=100;const trials:Trial[]=[true,false].map((accepted,i)=>({id:"t"+i,taskID:"task"+i,routeID:route.id,startedAt:end-(2-i)*10000,completedAt:end-(1-i)*10000,sessionIDs:["s"+i],accepted,verification:accepted?[{command:"verify",exitCode:0,artifact:"proof.txt"}]:[],phases:[{kind:"review",milliseconds:1000}]}));const requests:RequestRecord[]=trials.map((t,i)=>({id:"r"+i,sessionID:t.sessionIDs[0],accountID:route.accountID,kind:"primary",route:{providerID:route.providerID,modelID:route.modelID,reasoning:route.reasoning,variant:route.reasoning,harness:route.harness,serviceTier:route.serviceTier},startedAt:t.startedAt+100,completedAt:t.completedAt-100,state:i===0?"completed":"failed",tokens:{input:100,cacheRead:0,cacheWrite:0,output:10,reasoning:10},actualCharge:{currency:"USD",value:2}}));return {input,data:{trials,requests,task:"coding" as const,currency:"USD",source:"recorded fixture"}}}
test("accepted and rejected trials produce exact-route evidence consumed by the existing planner",()=>{
 const {input,data}=observations(),result=measuredOutcomeRoutes(input.routes,data),e=result.routes[0].evidence.at(-1)!
 expect(result.diagnostics).toEqual([]);expect(e).toMatchObject({trials:2,passed:1,totalMilliseconds:20000,totalCash:4,currency:"USD",p95Milliseconds:10000});expect(planRoutes({...input,routes:result.routes}).selected?.successRate).toBe(0.5)
 expect(input.routes[0].evidence.some(e=>e.source===data.source)).toBe(false)
})
test("missing charges, unjudged work and route mismatch cannot inherit older favorable evidence",()=>{
 for(const mutate of [(d:any)=>delete d.requests[1].actualCharge,(d:any)=>d.trials[1].accepted=null,(d:any)=>d.requests[1].route.reasoning="different",(d:any)=>d.requests[1].accountID="other",(d:any)=>d.requests[1].tokens.input=null]){const {input,data}=observations();mutate(data);const result=measuredOutcomeRoutes(input.routes,data);expect(result.diagnostics.length).toBe(1);expect(planRoutes({...input,routes:result.routes}).selected).toBeNull()}
})
test("measured currency is preserved and cannot be compared with a different budget unit",()=>{
 const {input,data}=observations();data.currency="EUR";data.requests.forEach(r=>r.actualCharge!.currency="EUR");const result=measuredOutcomeRoutes(input.routes,data);expect(result.routes[0].evidence.at(-1)?.currency).toBe("EUR");expect(planRoutes({...input,routes:result.routes}).selected).toBeNull();input.request.cashCurrency="EUR";expect(planRoutes({...input,routes:result.routes}).selected).not.toBeNull()
})

test("unknown charges retain measured quality for capacity routing without pretending to be free",()=>{
 const {input,data}=observations();data.requests.forEach(r=>delete r.actualCharge);delete input.request.maxCashPerSuccess
 const result=measuredOutcomeRoutes(input.routes,data),decision=planRoutes({...input,routes:result.routes})
 expect(result.routes[0].evidence.at(-1)?.totalCash).toBeNull();expect(decision.selected?.successRate).toBe(0.5);expect(decision.selected?.cashPerSuccess).toBeNull();expect(decision.summary).toContain("actual cash unavailable")
 input.request.preference="cash";expect(planRoutes({...input,routes:result.routes}).selected).toBeNull()
})

test("measured quality does not turn unknown quota consumption into a zero expiry estimate",()=>{
 const {input,data}=observations();input.routes[0].admission="configured-choice";input.routes[0].quotaPerTask={};input.request.primaryRouteID=input.routes[0].id
 const result=measuredOutcomeRoutes(input.routes,data),decision=planRoutes({...input,routes:result.routes});expect(decision.selected?.successRate).toBe(0.5);expect(decision.selected?.expiryOpportunity).toBeNull();expect(decision.summary).toContain("expiry pressure unavailable")
})

test("real dispatch admission reads recorded outcomes before making its atomic reservation",async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path"),{reserveDispatch}=await import("../models/dispatch-planner")
 const dir=mkdtempSync(join(tmpdir(),"outcome-admission-"));try{
 const {input,data}=observations(),policyFile=join(dir,"policy.json"),outcomesFile=join(dir,"outcomes.json")
 writeFileSync(policyFile,JSON.stringify({version:1,request:input.request,routes:input.routes,billing:Object.fromEntries(input.accounts.map(a=>[a.id,a.billing])),bootstrapByProject:{},outcomesFile:"outcomes.json"}));writeFileSync(outcomesFile,JSON.stringify(data))
 const snapshot:any={schema:1,updatedAt:input.request.now,diagnostics:[],accounts:input.accounts.map(a=>({id:a.id,state:a.capacity,observedAt:a.observedAt,connections:[{routeProviders:[...new Set(input.routes.filter(r=>r.accountID===a.id).map(r=>r.providerID))],modelPrefix:null}],plan:{name:"fixture",rateLimitTier:null,multiplier:null},windows:a.windows.map(w=>({id:w.id,scope:"shared",remainingPercent:w.remaining,resetAt:w.resetAt}))}))}
 const selected=await reserveDispatch({runID:"observed",policyFile,reservationFile:join(dir,"reservations.json"),now:Date.parse(input.request.now)},async()=>snapshot)
 expect(selected.decision?.selected?.successRate).toBe(0.5);expect(selected.ledger.get("observed")?.routeID).toBe(input.routes[0].id);selected.ledger.settle("observed",{state:"cancelled"})
 delete data.requests[1].actualCharge;writeFileSync(outcomesFile,JSON.stringify(data));await expect(reserveDispatch({runID:"incomplete",policyFile,reservationFile:join(dir,"reservations.json"),now:Date.parse(input.request.now)},async()=>snapshot)).rejects.toThrow("actual cash per success is unavailable")
 }finally{rmSync(dir,{recursive:true,force:true})}
})
