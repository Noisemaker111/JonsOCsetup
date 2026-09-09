import { expect, test } from "bun:test"
import { resetPlan, resetPlanLines } from "../usage/reset-planner"
import { accountRegime } from "../usage/calibration-store"
import { creditValue, workloadRequest, type UsageWorkload } from "../usage/credit-rates"
import { compareWorkloads } from "../usage/workload-planner"
import { modelUsage } from "../usage/model-usage"
import type { AccountUsage } from "../usage/account-types"
import type { Observation, Calibration } from "../usage/calibration"
import { routeKey } from "../usage/calibration"
const now = Date.parse("2026-09-07T20:00:00Z"), reset = now+4*3600000
const account = (): AccountUsage => ({id:"a",provider:"openai",identity:"account",connections:[],plan:{name:"pro",rateLimitTier:null,multiplier:null,provenance:"provider-observed",observedAt:new Date(now).toISOString()},windows:[{id:"shared",label:"5h",scope:"shared",durationSeconds:18000,usedPercent:40,remainingPercent:60,resetAt:new Date(reset).toISOString(),observedAt:new Date(now).toISOString(),state:"available"}],extraUsage:{enabled:null},state:"available",observedAt:new Date(now).toISOString(),attemptedAt:null,nextAttemptAt:null,failures:0,error:null})
const observation = (at:number, usedPoints:number):Observation => ({id:String(at),accountID:"a",windowID:"shared",at,usedPoints,resetAt:reset,regime:accountRegime(account()),precisionPoints:null,reportingDelayMilliseconds:null})
const workload = (modelID="gpt-5.6-luna", requests=10):UsageWorkload => ({label:modelID,accountID:"a",route:{providerID:"openai",modelID,serviceTier:"standard"},requests,tokens:{input:100000,cacheRead:200000,outputIncludingReasoning:10000}})
test("four-hour reset budget uses account points and wall time with reserve", () => {
 const p=resetPlan([account()],[observation(now-600000,35),observation(now,40)],now,10)[0]
 expect(p.requiredPointsPerMinute).toBeCloseTo(50/240)
 expect(p.observedPointsPerMinute).toBe(.5)
 expect(p.paceMultiplier).toBeCloseTo((50/240)/.5)
 expect(p.projectedUsedAtReset).toBe(100)
 expect(resetPlanLines([p])[0]).toContain("Usage left: 60.0% / Resets in: 240m")
 expect(resetPlanLines([p])[1]).toContain("Usage burn per hour: 30.00%/hour; needed: 12.50%/hour")
})
test("unknown, stale, reset, clock skew, plan change and decreasing counters cannot authorize a forecast", () => {
 for(const at of [now-30000,now+1]) {const a=account();a.windows[0].observedAt=new Date(at).toISOString();expect(resetPlan([a],[],now)[0].state).toBe("unavailable")}
 const a=account();a.windows[0].resetAt=new Date(now).toISOString();expect(resetPlan([a],[],now)[0].requiredPointsPerMinute).toBeNull()
 for(const rows of [[observation(now-600000,50),observation(now,40)],[{...observation(now-600000,35),regime:"other"},observation(now,40)],[{...observation(now-600000,35),resetAt:reset-1},observation(now,40)]]) expect(resetPlan([account()],rows,now)[0].observedPointsPerMinute).toBeNull()
 expect(()=>resetPlan([],[],now,NaN)).toThrow()
})
test("flat account meter is zero measured pace, never infinite workers", () => {
 const p=resetPlan([account()],[observation(now-600000,40),observation(now,40)],now)[0]
 expect(p.observedPointsPerMinute).toBe(0);expect(p.paceMultiplier).toBeNull();expect(p.pace).toBe("below-target")
})
test("published credit comparison distinguishes token mix, request count and fast tier", () => {
 const result=compareWorkloads([account()],resetPlan([account()],[],now),[],[workload(),workload("gpt-6-astra",1)],now)
 expect(result[0].creditEquivalent.credits).toBeCloseTo(9)
 expect(result[1].creditEquivalent.credits).toBeCloseTo(42.5)
 expect(result[0].windows[0].estimate).toBeNull()
 const r=workloadRequest(workload("gpt-6-astra",1),"r",now);r.route.serviceTier="fast"
 expect(creditValue(r,now).credits).toBeCloseTo(106.25)
 delete r.route.serviceTier;expect(creditValue(r,now).credits).toBeNull()
 expect(creditValue(r,Date.parse("2026-10-01")).reason).toContain("rechecking")
 expect(()=>compareWorkloads([],[],[],[{...workload(),requests:NaN}],now)).toThrow()
})
test("calibrated workload checks shared pools separately and excludes Spark reset", () => {
 const a=account();a.windows.push({...a.windows[0],id:"weekly",label:"7d",usedPercent:99}, {...a.windows[0],id:"spark",scope:"model",model:"gpt-5.3-codex-spark"})
 const w=workload(),r=workloadRequest(w,accountRegime(a),now)
 const c:Calibration={version:"v",accountID:"a",windowID:"shared",regime:accountRegime(a),routeKey:routeKey(r),trainedAt:now-1,validUntil:now+100000,weights:[1e-6,0,0,0],method:"weighted",identifiable:true,trainingSamples:5,heldOutSamples:2,trainingRequestIDs:[],heldOutRequestIDs:[],mixRange:[],validation:{meanAbsoluteErrorPoints:.01,biasPoints:0,intervalCoverage:1,baselineMeanAbsoluteErrorPoints:0,upperErrorPoints:.01},state:"validated"}
 const windows=compareWorkloads([a],resetPlan([a],[],now),[c,{...c,windowID:"weekly"}],[w],now)[0].windows
 expect(windows).toHaveLength(2);expect(windows[0].estimate!.points).toBeCloseTo(1);expect(windows[0].fit).toBe("within-estimate");expect(windows[1].fit).toBe("uncertain")
 expect(windows[1].requestsWithinUpperEstimate).toBe(9)
})
test("recent model evidence deduplicates requests and does not call partial sessions completed", () => {
 const r={...workloadRequest(workload(),"r",now),id:"one",completedAt:now+10}
 const models=modelUsage([r,r,{...r,id:"old",startedAt:now-31*60000}],now)
 expect(models).toHaveLength(1);expect(models[0].requests).toBe(1);expect(models[0].meanRequestTokens!.input).toBe(100000)
})

test("provider exhaustion cannot advertise spendable capacity; reserve targets need no burn sample", () => {
 const a=account(); a.windows[0].state="exhausted"; expect(resetPlan([a],[],now)[0].spendablePoints).toBeNull()
 a.windows[0].usedPercent=100; expect(resetPlan([a],[],now)[0].spendablePoints).toBe(0)
 expect(resetPlan([account()],[],now,60)[0].pace).toBe("target-reached")
})
