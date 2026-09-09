import {test,expect} from "bun:test"
import {learnEmpiricalModel,empiricalRoute,empiricalWorkloadScenario,type MeasuredInterval} from "../usage/empirical-usage"
import {compareWorkloads} from "../usage/workload-planner"
import {resetPlan} from "../usage/reset-planner"
import {accountRegime} from "../usage/calibration-store"
import type {AccountUsage} from "../usage/account-types"
import type {UsageWorkload} from "../usage/credit-rates"
const now=2000000000000,resetAt=now+4*3600000
const account:AccountUsage={id:"a",provider:"openai",identity:"account",connections:[],plan:{name:"Pro",rateLimitTier:null,multiplier:null,provenance:"provider-observed",observedAt:null},windows:[{id:"weekly",label:"7d",scope:"shared",durationSeconds:604800,usedPercent:40,remainingPercent:60,resetAt:new Date(resetAt).toISOString(),observedAt:new Date(now).toISOString(),state:"available"}],extraUsage:{enabled:null},state:"available",observedAt:new Date(now).toISOString(),attemptedAt:null,nextAttemptAt:null,failures:0,error:null}
const workload=(modelID:string,requests=1):UsageWorkload=>({label:modelID,accountID:"a",route:{providerID:"openai",modelID,reasoning:"high",serviceTier:"standard",harness:"native"},requests,tokens:{input:100000,cacheRead:300000,outputIncludingReasoning:0}})
const astra=workload("gpt-6-astra"),luna=workload("gpt-5.6-luna",10),regime=accountRegime(account)
const samples:MeasuredInterval[]=Array.from({length:30},(_,i)=>{
 const av=[100000+(i%3)*40000,200000+(i%5)*90000,0,0],lv=[80000+(i%7)*10000,180000+(i%11)*30000,0,0]
 return {accountID:"a",regime,windowID:"weekly",resetAt,from:now-(30-i)*300000,to:now-(29-i)*300000,usedPoints:av[0]*.000002+av[1]*.0000002+lv[0]*.00000004+lv[1]*.000000004,precisionPoints:null,reportingDelayMilliseconds:null,requests:2,missingRequests:0,unboundRequests:0,features:{[empiricalRoute(astra)]:av,[empiricalRoute(luna)]:lv},tokens:av.map((n,j)=>n+lv[j]),basis:"coincident-observations",limitations:[]}
})
const scope={accountID:"a",regime,windowID:"weekly",resetAt}
test("learned mixed-model observations become distinct workload scenarios while admission stays unknown",()=>{
 const model=learnEmpiricalModel(samples);expect(model.state).toBe("provisional")
 const plans=resetPlan([account],[],now,0,now+3600000),results=compareWorkloads([account],plans,[],[astra,luna],now,[model])
 expect(results[0].windows[0].empiricalScenario.points).toBeCloseTo(.26,3)
 expect(results[1].windows[0].empiricalScenario.points).toBeCloseTo(.052,3)
 for(const result of results){const w=result.windows[0];expect(w.estimate).toBeNull();expect(w.fit).toBe("unknown");expect(w.requestsWithinUpperEstimate).toBeNull();expect(w.targetAt).toBe(now+3600000);expect(w.empiricalScenario.observedErrorScenario?.meaning).toContain("not a confidence bound")}
})
test("scenarios reject different accounts, resets, tiers, providers, missing categories and stale evidence",()=>{
 const model=learnEmpiricalModel(samples)
 for(const wrong of [{...scope,accountID:"other"},{...scope,regime:"new plan"},{...scope,resetAt:resetAt+1}])expect(empiricalWorkloadScenario(model,astra,wrong,now).state).toBe("unavailable")
 for(const route of [{...astra.route,serviceTier:"fast"},{...astra.route,providerID:"cliproxyapi"},{...astra.route,reasoning:"medium"}])expect(empiricalWorkloadScenario(model,{...astra,route},scope,now).state).toBe("unavailable")
 expect(empiricalWorkloadScenario(model,astra,scope,now+31*60000).state).toBe("unavailable")
 expect(empiricalWorkloadScenario(model,astra,scope,now-1).state).toBe("unavailable")
 expect(empiricalWorkloadScenario(model,{...astra,tokens:{input:0,cacheRead:0,outputIncludingReasoning:10000}},scope,now).state).toBe("unavailable")
 expect(empiricalWorkloadScenario(model,{...astra,tokens:{input:0,cacheRead:0,outputIncludingReasoning:0}},scope,now).state).toBe("unavailable")
})
test("a model cannot be trained across reset cycles and unavailable pools never offer scenarios",()=>{
 expect(learnEmpiricalModel(samples.map((s,i)=>i? s:{...s,resetAt:resetAt-1})).state).toBe("collecting")
 const stale={...account,freshness:{stale:true,ageSeconds:100,resetPending:false}},plans=resetPlan([stale],[],now)
 expect(compareWorkloads([stale],plans,[],[astra],now,[learnEmpiricalModel(samples)])[0].windows[0].empiricalScenario.state).toBe("unavailable")
})
