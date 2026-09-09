import { appendFileSync,existsSync,mkdirSync,readFileSync,renameSync,writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { createHash } from "node:crypto"
import { acquireLock } from "../quest/locking"
import type { AccountSnapshot,AccountUsage } from "./account-types"
import { TELEMETRY_FILE } from "./telemetry-store"
import { predictAllowance,routeKey,canonicalRouteKey,type Calibration,type Observation } from "./calibration"
import type { RequestRecord } from "./telemetry"
export const accountRegime=(account:AccountUsage)=>createHash("sha256").update(JSON.stringify({provider:account.provider,name:account.plan.name,tier:account.plan.rateLimitTier,multiplier:account.plan.multiplier})).digest("hex").slice(0,16)
export function recordQuotaObservations(snapshot:AccountSnapshot,file=TELEMETRY_FILE+".observations") {
 const lock=acquireLock(dirname(file),"quota-observations")
 try { const prior=readQuotaObservations(file),ids=new Set(prior.observations.map(o=>o.id));mkdirSync(dirname(file),{recursive:true})
  for(const a of snapshot.accounts)for(const w of a.windows){if(w.usedPercent===null||!Number.isFinite(Date.parse(w.observedAt)))continue
   const row:Observation={id:createHash("sha256").update([a.id,w.id,w.observedAt,w.usedPercent,w.resetAt,accountRegime(a)].join(":")).digest("hex"),accountID:a.id,windowID:w.id,at:Date.parse(w.observedAt),usedPoints:w.usedPercent,resetAt:w.resetAt?Date.parse(w.resetAt):null,regime:accountRegime(a),precisionPoints:w.precisionPoints??null,reportingDelayMilliseconds:w.reportingDelayMilliseconds??null}
   if(!ids.has(row.id)){appendFileSync(file,JSON.stringify(row)+"\n",{mode:0o600});ids.add(row.id)}
  }
 }finally{lock.release()}
}
export function readQuotaObservations(file=TELEMETRY_FILE+".observations") {
 const observations:Observation[]=[],diagnostics:string[]=[]
 if(existsSync(file))for(const [i,line]of readFileSync(file,"utf8").split("\n").entries()){if(!line.trim())continue;try{const o=JSON.parse(line);if(!o.id||!Number.isFinite(o.usedPoints))throw new Error();observations.push(o)}catch{diagnostics.push("Invalid quota observation at line "+(i+1))}}
 return {observations,diagnostics}
}
export function saveCalibration(calibration:Calibration,file=TELEMETRY_FILE+".calibrations") {
 const lock=acquireLock(dirname(file),"calibrations")
 try{const prior=readCalibrations(file);if(prior.diagnostics.length)throw new Error(prior.diagnostics.join("; "));mkdirSync(dirname(file),{recursive:true});const rows=prior.calibrations.filter(c=>c.version!==calibration.version);rows.push(calibration);const tmp=file+"."+process.pid+".tmp";writeFileSync(tmp,JSON.stringify(rows),{mode:0o600});renameSync(tmp,file)}finally{lock.release()}
}
export function readCalibrations(file=TELEMETRY_FILE+".calibrations"):{calibrations:Calibration[];diagnostics:string[]} {
 if(!existsSync(file))return {calibrations:[],diagnostics:[]}
 try{const rows=JSON.parse(readFileSync(file,"utf8"));if(!Array.isArray(rows)||rows.some(c=>!c.version||!Array.isArray(c.weights)||c.weights.length!==4))throw new Error();return {calibrations:rows,diagnostics:[]}}catch{return {calibrations:[],diagnostics:["Calibration store is unreadable; allowance attribution is unavailable"]}}
}
export function calibratedUsage(records:RequestRecord[],calibrations:Calibration[],options:{now:number;maxAgeMilliseconds?:number}) {
 const groups=new Map<string,{accountID:string;windowID:string;points:number;low:number;high:number;requests:number;versions:Set<string>;from:number;to:number}>()
 let unavailableRequests=0
 for(const r of records){const versions=new Map<string,Calibration>();for(const c of calibrations.filter(c=>c.accountID===r.accountID&&canonicalRouteKey(c.routeKey)===routeKey(r)&&c.regime===r.accountRegime).sort((a,b)=>a.trainedAt-b.trainedAt))versions.set(c.windowID,c)
  let predicted=false
  for(const c of versions.values()){const p=predictAllowance(c,r,{...options,regime:r.accountRegime??"unknown"});if(!p)continue;predicted=true;const key=c.accountID+":"+c.windowID,g=groups.get(key)??{accountID:c.accountID,windowID:c.windowID,points:0,low:0,high:0,requests:0,versions:new Set<string>(),from:r.startedAt,to:r.completedAt??r.startedAt};g.points+=p.points;g.low+=p.low;g.high+=p.high;g.requests++;g.versions.add(c.version);g.from=Math.min(g.from,r.startedAt);g.to=Math.max(g.to,r.completedAt??r.startedAt);groups.set(key,g)}
  if(!predicted)unavailableRequests++
 }
 return {provenance:"calibrated" as const,unavailableRequests,windows:[...groups.values()].map(g=>({...g,versions:[...g.versions],percentagePointsPerMinute:g.to>g.from?g.points/((g.to-g.from)/60000):null})),note:"Forecasts include held-out error bounds. Unexplained account movement is not assigned to this conversation."}
}
