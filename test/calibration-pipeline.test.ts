import {test,expect} from "bun:test"
import {pairObservedHistory,calibrateObservedHistory,type CoverageEvidence} from "../usage/calibration-pipeline"
import type {Observation} from "../usage/calibration"
import type {RequestRecord} from "../usage/telemetry"
const obs=(i:number,points=i):Observation=>({id:"o"+i,accountID:"a",windowID:"5h",at:i*1000,usedPoints:points,resetAt:100000,regime:"r",precisionPoints:0.1,reportingDelayMilliseconds:50})
const req=(i:number):RequestRecord=>({id:"q"+i,sessionID:"s"+i,accountID:"a",accountRegime:"r",startedAt:i*1000+100,completedAt:i*1000+200,state:"completed",kind:"primary",route:{providerID:"p",modelID:"m"},tokens:{input:1000,output:0,reasoning:0,cacheRead:0,cacheWrite:0}})
const coverage:CoverageEvidence[]=[{accountID:"a",from:0,to:10000,complete:true,externalActivity:false,source:"Isolated fixture account-wide recorder"}]
test("pairs rounded and delayed batches without overlapping accepted intervals",()=>{
 const result=pairObservedHistory([obs(0,0),obs(1,0),obs(2,1),obs(3,2)],[req(0),req(1),req(2)],coverage,4000)
 expect(result.samples.map(s=>s.requestIDs)).toEqual([["q0","q1"],["q2"]]);expect(result.diagnostics).toHaveLength(0)
 const delayed=pairObservedHistory([obs(0,0),{...obs(1,0),at:225},obs(2,1)],[req(0)],coverage,4000);expect(delayed.samples).toHaveLength(1);expect(delayed.samples[0].to).toBe(2000)
})
test("does not infer coverage, bridge evidence gaps or assign external account movement",()=>{
 for(const c of [[],[{...coverage[0],externalActivity:"unknown" as const}],[{...coverage[0],to:500},{...coverage[0],from:600}],[...coverage,{...coverage[0],from:400,to:600,externalActivity:true}]]){
  const result=pairObservedHistory([obs(0),obs(1)],[req(0)],c,3000);expect(result.samples).toHaveLength(0);expect(result.diagnostics[0].unattributedPoints).toBe(1)
 }
 expect(pairObservedHistory([obs(0),obs(1)],[req(0)],[{...coverage[0],to:500},{...coverage[0],from:500}],3000).samples).toHaveLength(1)
})
test("reset, mixed routes, unknown precision and contradictory observations are diagnosed",()=>{
 for(const observations of [[obs(0),{...obs(1),resetAt:200000}],[obs(0),{...obs(1),precisionPoints:null}],[obs(0),obs(1),{...obs(1,2),id:"conflict"}]])expect(pairObservedHistory(observations,[req(0)],coverage,3000).samples).toHaveLength(0)
 const result=pairObservedHistory([obs(0),obs(1)],[req(0),{...req(0),id:"other",route:{providerID:"p",modelID:"other"}}],coverage,3000);expect(result.diagnostics[0].reason).toContain("Mixed routes")
 expect(pairObservedHistory([obs(0,0),obs(1,0),obs(2,0)],[req(0),req(1)],coverage,1000).samples).toHaveLength(0)
})
test("fits observed history with later independent validation and refuses leakage",()=>{
 const input={observations:Array.from({length:8},(_,i)=>obs(i)),requests:Array.from({length:7},(_,i)=>req(i)),coverage,options:{maxIntervalMilliseconds:2000,heldOutIntervals:2,now:8000,maxAgeMilliseconds:9000,maxErrorPoints:0.2}}
 const result=calibrateObservedHistory(input);expect(result.calibrations).toHaveLength(1);expect(result.calibrations[0].state).toBe("validated");expect(result.calibrations[0].heldOutRequestIDs).toEqual(["q5","q6"])
 const leaked=calibrateObservedHistory({...input,requests:input.requests.map(r=>({...r,sessionID:"shared"}))});expect(leaked.calibrations).toHaveLength(0);expect(leaked.rejected[0].reason).toContain("independent sessions")
 expect(()=>calibrateObservedHistory({...input,options:{...input.options,maxErrorPoints:NaN}}).calibrations).not.toThrow();expect(calibrateObservedHistory({...input,options:{...input.options,maxErrorPoints:NaN}}).rejected[0].reason).toContain("policy")
})
