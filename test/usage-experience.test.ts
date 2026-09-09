import { expect, test } from "bun:test"
import { hiddenExecFileSync } from "../scripts/windows-process"
import { usageExperience, type ExperienceEvidence } from "../usage/experience"
import { renderUsageExperience } from "../usage/experience-report"
import { accountRegime } from "../usage/calibration-store"
import { burnTargetKey } from "../usage/burn-control"
import type { AccountUsage } from "../usage/account-types"
import type { Observation } from "../usage/calibration"
import type { LedgerRow } from "../usage/passive-ledger"
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const now=Date.parse("2026-09-09T00:30:00Z"),resetAt=Date.parse("2026-09-15T01:24:10Z")
function evidence():ExperienceEvidence {
 const account:AccountUsage={id:"a",provider:"openai",identity:"account",connections:[{id:"c",owner:"opencode",routeProviders:["openai"],modelPrefix:null}],plan:{name:"pro",rateLimitTier:null,multiplier:null,provenance:"provider-observed",observedAt:new Date(now).toISOString()},windows:[{id:"shared",label:"7d",scope:"shared",durationSeconds:604800,usedPercent:26,remainingPercent:74,resetAt:new Date(resetAt).toISOString(),observedAt:new Date(now).toISOString(),state:"available"}],extraUsage:{enabled:null},state:"available",observedAt:new Date(now).toISOString(),attemptedAt:new Date(now-20).toISOString(),nextAttemptAt:new Date(now+30000).toISOString(),failures:0,error:null}
 const regime=accountRegime(account)
 const observations:Observation[]=[now-10*3600000,now-3600000,now-120000,now].map((at,i)=>({id:"o"+i,accountID:"a",windowID:"shared",regime,resetAt,at,usedPoints:i<2?20:26,precisionPoints:null,reportingDelayMilliseconds:null}))
 const target={accountID:"a",deadlineAt:resetAt,reservePoints:0,updatedAt:now-600000,pacing:{windowID:"shared",regime,resetAt,maxConcurrent:4}}
 return {now,accounts:[account],observations,requests:[],targets:[target],controls:[{accountID:"a",windowID:"shared",targetKey:burnTargetKey(target),deadlineAt:resetAt,state:"ready",desiredConcurrency:0,maxConcurrent:4,lastAdjustedAt:now-600000,updatedAt:now,requiredPointsPerMinute:.01,observedPointsPerMinute:0,reason:"Measured pace hold"}],collectorAt:now-30000,hostScanAt:now-60000,coverageFrom:now-2*86400000}
}
function request(id="r",at=now-1000):LedgerRow {return {id,source:"opencode",sessionID:"s",accountID:"a",at,startedAt:at-10000,route:{providerID:"openai",modelID:"gpt-6-astra",reasoning:"medium",harness:"native"},kind:"primary",state:"completed",tokens:{input:100,cacheRead:20,cacheWrite:0,output:8,reasoning:2}}}
const q={accountID:"a",windowID:"shared"}

test("separates canonical reset epochs and pools, removes duplicates, preserves long gaps and flat meters",()=>{
 const e=evidence(),old={...e.observations[0],id:"old",resetAt:resetAt-604800000,at:now-86400000,usedPoints:90}
 e.observations.push(old,{...e.observations[0],id:"duplicate"},{...old,id:"other",accountID:"b"},{...old,id:"pool",windowID:"other"})
 const p=usageExperience(e,{...q,view:"timeline"})
 expect(p.history.availableSamples).toBe(5);expect(p.history.duplicateSamples).toBe(1)
 expect(p.history.epochCount).toBe(2);expect(p.history.selectedSamples).toBe(4)
 expect(p.history.gapCount).toBe(2);expect(p.history.gaps.items[0].milliseconds).toBe(9*3600000)
 expect(p.timeline!.items.map(o=>o.breakBefore)).toEqual([true,true,true,false])
 expect(p.decision.measuredQuotaRate.pointsPerMinute).toBe(0)
 expect(p.history.epochs.items.find(o=>!o.current)?.samples).toBe(1)
 const previous=usageExperience(e,{...q,resetAt:old.resetAt,view:"timeline"})
 expect(previous.history.current).toBe(false);expect(previous.timeline!.items[0].usedPoints).toBe(90)
 expect(previous.observedQuota.resetAt).toBe(resetAt)
})
test("terminal counters remain independent of flat quota, requests dedupe and sources never combine",()=>{
 const e=evidence(),r=request()
 e.requests=[r,{...r,state:"running",recordedAt:now},request("r2"),{...request("codex"),source:"codex",accountID:undefined},{...request("host"),source:"opencode-host"},{...request("running"),state:"running"},{...request("missing"),tokens:{input:null,cacheRead:null,cacheWrite:null,output:null,reasoning:null}}]
 const p=usageExperience(e,{...q,view:"requests"})
 expect(p.activity.terminalRequests).toBe(3);expect(p.activity.runningRequests).toBe(1)
 expect(p.activity.activeMilliseconds).toBe(10000) // Overlapping intervals are not summed.
 expect(p.activity.tokens.input).toEqual({known:200,missingRequests:1})
 expect(p.activity.missingAccountBindings).toBe(1)
 expect(p.activity.sourceCounts.find(s=>s.source==="opencode-host")!.records).toBe(1)
 expect(p.requests!.items.find(r=>r.id==="r")!.state).toBe("completed")
 expect(p.requests!.items[0].harness).toBe("native")
 expect(p.decision.measuredQuotaRate.pointsPerMinute).toBe(0)
 expect(p.expectedActivity.predictedActiveHours).toBeNull()
 expect(p.expectedActivity.reason).toContain("Few observed days")
 expect(p.expectedActivity.neededEvidence.length).toBe(3)
 expect(p.decision.learnedEstimate.points).toBeNull()
})
test("ready with zero slots is not runnable, unknown ownership never becomes a launch grant",()=>{
 const e=evidence(),zero=usageExperience(e,q)
 expect(zero.decision.state).toBe("ready");expect(zero.decision.desiredSlots).toBe(0)
 expect(zero.decision.nextAction).toBe("wait-for-controller");expect(zero.decision.runnable).toBe(false)
 e.controls[0].desiredConcurrency=1
 expect(usageExperience(e,q).decision.nextAction).toBe("check-admission")
 e.requests=[{...request(),state:"running"}]
 expect(usageExperience(e,q).decision.nextAction).toBe("inspect-live-ownership")
 expect(usageExperience(e,q).decision.liveLaunches).toBeNull()
 e.controls[0].state="stopped"
 expect(usageExperience(e,q).decision.nextAction).toBe("hold")
 e.controls[0].state="ready";e.controls[0].updatedAt=now-30001
 expect(usageExperience(e,q).decision.state).toBe("awaiting-controller")
 e.accounts[0].state="unknown"
 expect(usageExperience(e,q).decision.nextAction).toBe("hold")
})
test("coverage includes precise source ages, conflicts and decreases without invented precision",()=>{
 const e=evidence();e.observations.push({...e.observations.at(-1)!,id:"conflict",usedPoints:27},{...e.observations[1],id:"decrease",at:now-60000,usedPoints:21})
 const p=usageExperience(e,{...q,view:"timeline"})
 expect(p.sources.collectorAgeMilliseconds).toBe(30000);expect(p.observedQuota.ageMilliseconds).toBe(0)
 expect(p.history.conflictingSamples).toBe(1);expect(p.history.decreases).toBe(1)
 expect(p.observedQuota.precisionPoints).toBeNull();expect(p.observedQuota.reportingDelayMilliseconds).toBeNull()
 expect(p.units.quota).toBe("percentage points of this pool")
 expect(p.timeline!.items.find(r=>r.usedPoints===21)!.breakBefore).toBe(true)
})
test("bounded deterministic JSON pages cover broad history without cross-account row inflation",()=>{
 const e=evidence(),base=e.observations[0]
 e.observations=Array.from({length:21000},(_,i)=>({...base,id:String(i),accountID:i<1000?"a":"b",at:now-i*1000}))
 e.requests=Array.from({length:1000},(_,i)=>request(String(i),now-i*1000))
 const p=usageExperience(e,{...q,view:"timeline",limit:17,offset:17})
 expect(p.history.availableSamples).toBe(1000);expect(p.timeline!.items.length).toBe(17)
 expect(p.timeline!.nextOffset).toBe(34);expect(p.timeline!.total).toBe(1000)
 const detail=usageExperience(e,{...q,view:"requests",limit:100})
 expect(detail.requests!.items.length).toBe(100);expect(detail.requests!.nextOffset).toBe(100)
 const visit=(v:unknown)=>{expect(v).not.toBeUndefined();if(typeof v==="number")expect(Number.isFinite(v)).toBe(true);if(v&&typeof v==="object")Object.values(v).forEach(visit)}
 visit(detail)
 expect(JSON.parse(JSON.stringify(detail))).toEqual(detail)
 expect(JSON.stringify(detail).length).toBeLessThan(65000)
 expect(JSON.stringify(usageExperience(e,q)).length).toBeLessThan(16000)
 expect(usageExperience(e,{...q,view:"requests",offset:1000}).requests!.nextOffset).toBeNull()
 expect(usageExperience(e,{...q,from:now-2000,to:now}).history.selectedSamples).toBe(3)
})
test("rejects invalid queries and preserves input; empty history declines activity prediction",()=>{
 const e=evidence(),before=JSON.stringify(e)
 usageExperience(e,q);expect(JSON.stringify(e)).toBe(before)
 for(const invalid of [{limit:101},{offset:-1},{limit:1.5},{from:NaN},{to:now+1},{from:now,to:now-1},{timeZone:"not/a-zone"},{accountID:"missing"},{windowID:"missing"}])expect(()=>usageExperience(e,{...q,...invalid})).toThrow()
 e.observations=[];e.requests=[]
 const p=usageExperience(e,q)
 expect(p.history.range).toBeNull();expect(p.activity.range).toBeNull();expect(p.activity.activeDays).toBe(0)
 expect(p.expectedActivity.state).toBe("unsupported");expect(p.decision.measuredQuotaRate.pointsPerMinute).toBeNull()
})
test("renderer escapes hostile source strings, has keyboard/data access and honest aligned units",()=>{
 const e=evidence(),payload='</title><script>alert("x")</script><img src=x onerror=alert(1)>'
 e.accounts[0].windows[0].label=payload;e.requests=[{...request(payload),route:{providerID:"openai",modelID:payload,harness:"native"}}]
 const quota=usageExperience(e,{...q,view:"timeline",timeZone:"America/New_York"}),activity=usageExperience(e,{...q,view:"requests",timeZone:"America/New_York"})
 const html=renderUsageExperience(quota,activity)
 expect(html).not.toContain("<script");expect(html).not.toContain("<img");expect(html).toContain("&lt;script&gt;")
 expect(html).toContain('tabindex="0"');expect(html).toContain('<caption>');expect(html).toContain('scope="col"')
 expect(html).toContain("prefers-color-scheme:dark");expect(html).toContain("max-width:600px")
 expect(html).toContain("Used points (0–100)");expect(html).toContain("Output including reasoning (tokens)")
 expect(html).toContain("Sep 08");expect(html).toContain("America/New_York")
 expect(html).not.toContain("<polyline");expect(html).not.toContain("3h/day")
 expect(()=>renderUsageExperience(quota,{...activity,accountID:"b"})).toThrow()
})
test("unbound synthetic-looking calls cannot become account activity and bound names do not prove route authority",()=>{
 const e=evidence()
 e.requests=[{...request("fixture"),accountID:undefined,route:{providerID:"bootstrap-fixture",modelID:"model"}},{...request("unbound-real-name"),accountID:undefined},{...request("bound-fixture"),route:{providerID:"fixture",modelID:"model"}}]
 const p=usageExperience(e,q)
 expect(p.activity.terminalRequests).toBe(1)
 expect(p.activity.excludedUnboundSourceRecords).toBe(2)
 expect(p.activity.estimateEligible).toBe(false)
 expect(p.activity.routeReceiptAuthority).toContain("unverified")
 expect(p.expectedActivity.predictedActiveHours).toBeNull()
 expect(p.decision.learnedEstimate.points).toBeNull()
})
test("cached server adapter is read-only, needs no network and returns identical strict JSON content",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"usage-experience-adapter-")),cache=join(dir,"accounts.json"),telemetry=join(dir,"requests.jsonl"),e=evidence()
 try {
  writeFileSync(cache,JSON.stringify({schema:1,updatedAt:new Date(now).toISOString(),accounts:e.accounts,diagnostics:[]}))
  writeFileSync(cache+".observations",e.observations.map(o=>JSON.stringify(o)).join("\n"))
  writeFileSync(telemetry,"")
  const before=readdirSync(dir).sort().map(name=>[name,readFileSync(join(dir,name),"utf8")])
  const script=`globalThis.fetch=()=>{throw Error("Network forbidden")}; const {getUsageExperience}=await import(${JSON.stringify(resolve(import.meta.dir,"../usage/server.ts"))}); console.log(JSON.stringify(getUsageExperience({accountID:"a",view:"timeline",limit:2})));`
  const stdout=String(hiddenExecFileSync(process.execPath,["-e",script],{env:{...process.env,OPENCODE_ACCOUNT_USAGE_FILE:cache,OPENCODE_TELEMETRY_FILE:telemetry,OPENCODE_PASSIVE_LEDGER_FILE:join(dir,"missing.sqlite")},encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:30000}))
  const result=JSON.parse(stdout);expect(result.timeline.items.length).toBe(2)
  expect(result.decision.runnable).toBe(false);expect(result.sources.collectorAt).toBeNull()
  expect(readdirSync(dir).sort().map(name=>[name,readFileSync(join(dir,name),"utf8")])).toEqual(before)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
