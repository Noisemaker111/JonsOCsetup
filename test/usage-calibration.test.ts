import { expect,test } from "bun:test"
import { pairInterval,fitCalibration,predictAllowance,routeKey,canonicalRouteKey,type Observation,type CalibrationSample } from "../usage/calibration"
import type { RequestRecord } from "../usage/telemetry"
const request=(id:string,features=[100,20,10,30]):RequestRecord=>({id,sessionID:id,accountID:"a",route:{providerID:"p",modelID:"m",harness:"h"},kind:"primary",startedAt:100,completedAt:200,state:"completed",tokens:{input:features[0],cacheRead:features[1],cacheWrite:features[2],output:features[3],reasoning:0}})
const observation=(id:string,at:number,usedPoints:number):Observation=>({id,accountID:"a",windowID:"5h",at,usedPoints,resetAt:1e9,regime:"plan1",precisionPoints:0.1,reportingDelayMilliseconds:50})
test("interval pairing includes delayed batches, excludes unsettled, rounded-zero, external, reset and missing-token intervals",()=>{
 const b=observation("b",0,10),a=observation("a",300,10.5),r=request("r")
 expect(pairInterval(b,a,[r],{complete:true,externalActivity:false}).sample?.points.low).toBeCloseTo(0.4)
 expect(pairInterval(b,a,[r],{complete:true,externalActivity:"unknown"}).sample).toBeNull()
 expect(pairInterval(b,{...a,usedPoints:10},[r],{complete:true,externalActivity:false}).reason).toContain("Rounded")
 expect(pairInterval(b,{...a,at:220},[r],{complete:true,externalActivity:false}).reason).toContain("unsettled")
 expect(pairInterval(b,{...a,resetAt:2e9},[r],{complete:true,externalActivity:false}).reason).toContain("Reset")
 expect(pairInterval(b,a,[{...r,tokens:{...r.tokens,input:null}}],{complete:true,externalActivity:false}).sample).toBeNull()
 const child={...request("child"),startedAt:110};expect(pairInterval(b,a,[r,child,r],{complete:true,externalActivity:false}).sample?.requestIDs).toHaveLength(2)
})
const weights=[0.001,0.0002,0.002,0.003]
function sample(i:number,f:number[],w=weights):CalibrationSample { const points=f.reduce((n,v,k)=>n+v*w[k],0);return {id:String(i),accountID:"a",windowID:"5h",regime:"plan1",routeKey:routeKey(request("r")),sessionIDs:["session"+i],requestIDs:["r"+i],from:i*1000,to:i*1000+500,features:f,points:{low:points-0.0001,high:points+0.0001},provenance:"provider-observed"} }
const mixes=[[100,0,0,0],[0,100,0,0],[0,0,100,0],[0,0,0,100],[10,20,30,40],[200,10,20,80],[20,30,200,10],[90,20,10,120]]
const opts={now:10000,maxAgeMilliseconds:20000,maxErrorPoints:0.01}
test("recovers independent weights and measures later held-out error against aggregate baseline",()=>{
 const samples=mixes.map((f,i)=>sample(i,f)),fit=fitCalibration(samples.slice(0,6),samples.slice(6),opts)
 expect(fit.identifiable).toBe(true);fit.weights.forEach((v,i)=>expect(v).toBeCloseTo(weights[i],8));expect(fit.validation.meanAbsoluteErrorPoints).toBeLessThan(1e-6)
 expect(fit.validation.baselineMeanAbsoluteErrorPoints).toBeGreaterThan(0.01)
 expect(predictAllowance(fit,request("new"),{now:10001,maxAgeMilliseconds:10000,regime:"plan1"})?.provenance).toBe("calibrated")
 expect(predictAllowance(fit,request("new"),{now:10001,maxAgeMilliseconds:10000,regime:"plan2"})).toBeNull()
})
test("rank-deficient mixes use a labelled scale and refuse extrapolated cache mixes",()=>{
 const s=Array.from({length:8},(_,i)=>sample(i,[100*(i+1),20*(i+1),10*(i+1),30*(i+1)])),fit=fitCalibration(s.slice(0,6),s.slice(6),opts)
 expect(fit.identifiable).toBe(false);expect(fit.method).toBe("aggregate-scale")
 expect(predictAllowance(fit,request("new",[10,500,10,30]),{now:10001,maxAgeMilliseconds:10000,regime:"plan1"})).toBeNull()
})
test("drift disables forecasts; leaked validation sessions and overlapping intervals are rejected",()=>{
 const s=mixes.map((f,i)=>sample(i,f,i<6?weights:weights.map(w=>w*3))),fit=fitCalibration(s.slice(0,6),s.slice(6),opts)
 expect(fit.state).toBe("drift");expect(predictAllowance(fit,request("r"),{now:10001,maxAgeMilliseconds:10000,regime:"plan1"})).toBeNull()
 expect(()=>fitCalibration(s.slice(0,6),[{...s[6],sessionIDs:s[0].sessionIDs},s[7]],opts)).toThrow("independent sessions")
 expect(()=>fitCalibration([{...s[0],to:1500},...s.slice(1,6)],s.slice(6),opts)).toThrow("Overlapping")
})

import { calibratedUsage,recordQuotaObservations,readQuotaObservations } from "../usage/calibration-store"
import { mkdtempSync,rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
test("overlapping window estimates stay separate and unknown requests remain unavailable",()=>{
 const s=mixes.map((f,i)=>sample(i,f)),fit=fitCalibration(s.slice(0,6),s.slice(6),opts),r={...request("r"),accountRegime:"plan1"}
 const result=calibratedUsage([r,{...r,id:"other",accountRegime:"unknown"}],[fit,{...fit,windowID:"weekly"}],{now:10001,maxAgeMilliseconds:20000})
 expect(result.windows).toHaveLength(2);expect(result.windows[0].percentagePointsPerMinute).toBeGreaterThan(0);expect(result.unavailableRequests).toBe(1)
})
test("quota observation history deduplicates native-precision readings without inventing precision",()=>{
 const dir=mkdtempSync(join(tmpdir(),"usage-observations-")),file=join(dir,"observations")
 try{const snapshot:any={accounts:[{id:"a",provider:"openai",plan:{name:"plan",rateLimitTier:null,multiplier:null},windows:[{id:"5h",usedPercent:1.234567,observedAt:"2026-09-05T12:00:00Z",resetAt:"2026-09-05T17:00:00Z"}]}]};recordQuotaObservations(snapshot,file);recordQuotaObservations(snapshot,file);const rows=readQuotaObservations(file).observations;expect(rows).toHaveLength(1);expect(rows[0].usedPoints).toBe(1.234567);expect(rows[0].precisionPoints).toBeNull()}finally{rmSync(dir,{recursive:true,force:true})}
})

test("route calibration identity is stable across property order and preserves historical object keys",()=>{
 const r=request("r"),other={...r,route:Object.fromEntries(Object.entries(r.route).reverse()) as typeof r.route};expect(routeKey(r)).toBe(routeKey(other));expect(canonicalRouteKey(JSON.stringify(r.route))).toBe(routeKey(r));
})

test("shared allowance views use recorded calibration expiry and stricter routing policy",()=>{
 const samples=mixes.map((f,i)=>sample(i,f)),fit=fitCalibration(samples.slice(0,6),samples.slice(6),opts),r={...request("r"),accountRegime:"plan1"}
 expect(calibratedUsage([r],[fit],{now:10001}).unavailableRequests).toBe(0)
 expect(calibratedUsage([r],[fit],{now:30001}).unavailableRequests).toBe(1)
 expect(predictAllowance(fit,r,{now:10002,maxAgeMilliseconds:1,regime:"plan1"})).toBeNull()
 expect(calibratedUsage([r],[{...fit,validUntil:undefined}],{now:10001}).unavailableRequests).toBe(1)
})
