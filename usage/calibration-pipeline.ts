import {pairInterval,fitCalibration,canonicalRouteKey,type Observation,type CalibrationSample,type Calibration} from "./calibration"
import type {RequestRecord} from "./telemetry"
/** Evidence describes account-wide collection, not merely the current session. */
export type CoverageEvidence={accountID:string;from:number;to:number;complete:boolean;externalActivity:boolean|"unknown";source:string}
export type PairingDiagnostic={accountID:string;windowID:string;from:number;to:number;reason:string;unattributedPoints:number|null}
export function pairObservedHistory(observations:Observation[],records:RequestRecord[],coverage:CoverageEvidence[],maxIntervalMilliseconds:number){
 if(!Number.isFinite(maxIntervalMilliseconds)||maxIntervalMilliseconds<=0)throw Error("A positive maximum calibration interval is required")
 if(coverage.some(c=>!c.source?.trim()||!Number.isFinite(c.from)||!Number.isFinite(c.to)||c.to<=c.from||typeof c.complete!=="boolean"||![true,false,"unknown"].includes(c.externalActivity)))throw Error("Invalid account coverage evidence")
 const groups=new Map<string,Observation[]>(),samples:CalibrationSample[]=[],diagnostics:PairingDiagnostic[]=[]
 for(const o of new Map(observations.map(o=>[o.id,o])).values()){const key=JSON.stringify([o.accountID,o.windowID]);const rows=groups.get(key)??[];rows.push(o);groups.set(key,rows)}
 for(const rows of groups.values()){
  rows.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));let start=0
  if(rows.some((r,i)=>i>0&&r.at===rows[i-1].at&&JSON.stringify({...r,id:""})!==JSON.stringify({...rows[i-1],id:""}))){diagnostics.push({accountID:rows[0].accountID,windowID:rows[0].windowID,from:rows[0].at,to:rows.at(-1)!.at,reason:"Conflicting observations at the same timestamp",unattributedPoints:null});continue}
  for(let end=1;end<rows.length;end++){
   const before=rows[start],after=rows[end]
   // Adjacent evidence segments may establish continuous coverage. Any overlapping
   // negative/unknown evidence wins; a quiet local request log cannot prove exclusivity.
   const evidence=coverage.filter(c=>c.accountID===before.accountID&&c.to>before.at&&c.from<after.at).sort((a,b)=>a.from-b.from)
   let cursor=before.at
   for(const c of evidence){if(c.from>cursor)break;if(c.complete&&c.externalActivity===false)cursor=Math.max(cursor,c.to)}
   const covered=cursor>=after.at&&!evidence.some(c=>!c.complete||c.externalActivity!==false)
   const result=after.at-before.at>maxIntervalMilliseconds?{sample:null,reason:"Maximum calibration interval exceeded"}:pairInterval(before,after,records,{complete:covered,externalActivity:covered?false:"unknown"})
   if(result.sample){samples.push(result.sample);start=end;continue}
   const reason=result.reason??"No usable interval"
   // Rounded counters and delayed completion may become identifiable when batched.
   // Other failures establish a new baseline; they must not contaminate later samples.
   const canExtend=reason.startsWith("Rounded movement")||reason.startsWith("Requests are unsettled")
   if(canExtend&&end<rows.length-1&&rows[end+1].at-before.at<=maxIntervalMilliseconds)continue
   diagnostics.push({accountID:before.accountID,windowID:before.windowID,from:before.at,to:after.at,reason,unattributedPoints:before.resetAt===after.resetAt&&before.regime===after.regime?Math.max(0,after.usedPoints-before.usedPoints):null});start=end
  }
 }
 return {samples,diagnostics}
}
/** All fitting remains offline. Independent held-out sessions are enforced by the core. */
export function calibrateObservedHistory(input:{observations:Observation[];requests:RequestRecord[];coverage:CoverageEvidence[];options:{maxIntervalMilliseconds:number;heldOutIntervals:number;now:number;maxAgeMilliseconds:number;maxErrorPoints:number}}){
 const o=input.options
 if(!Number.isInteger(o.heldOutIntervals)||o.heldOutIntervals<2)throw Error("At least two held-out intervals are required")
 const paired=pairObservedHistory(input.observations,input.requests,input.coverage,o.maxIntervalMilliseconds),groups=new Map<string,CalibrationSample[]>(),calibrations:Calibration[]=[],rejected:{key:string;reason:string}[]=[]
 for(const s of paired.samples){const key=JSON.stringify([s.accountID,s.windowID,s.regime,canonicalRouteKey(s.routeKey)]);const rows=groups.get(key)??[];rows.push(s);groups.set(key,rows)}
 for(const [key,rows]of groups){rows.sort((a,b)=>a.from-b.from);const split=Math.max(0,rows.length-o.heldOutIntervals);try{calibrations.push(fitCalibration(rows.slice(0,split),rows.slice(split),o))}catch(error){rejected.push({key,reason:error instanceof Error?error.message:String(error)})}}
 return {...paired,calibrations,rejected}
}
