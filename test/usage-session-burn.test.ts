import {test,expect} from 'bun:test'
import {sessionBurn} from '../usage/session-burn'
import {accountRegime} from '../usage/calibration-store'
import type {AccountUsage} from '../usage/account-types'
import type {LedgerRow} from '../usage/passive-ledger'
import type {Observation} from '../usage/calibration'
const now=2000000000000,resetAt=now+3600000,from=now-40*300000
const account:AccountUsage={id:'a',provider:'openai',identity:'account',connections:[],plan:{name:'Pro',rateLimitTier:null,multiplier:null,provenance:'provider-observed',observedAt:null},windows:[{id:'weekly',label:'7d',scope:'shared',usedPercent:40,remainingPercent:60,resetAt:new Date(resetAt).toISOString(),observedAt:new Date(now).toISOString(),state:'available'}],extraUsage:{enabled:null},state:'available',observedAt:new Date(now).toISOString(),attemptedAt:null,nextAttemptAt:null,failures:0,error:null}
const regime=accountRegime(account)
const row=(id:string,at:number,input=10000):LedgerRow=>({id,at,startedAt:at-1000,source:'opencode',sessionID:'s1',accountID:'a',regime,kind:'chat',state:'completed',route:{providerID:'openai',modelID:'astra',reasoning:'medium',serviceTier:'standard'},tokens:{input,cacheRead:0,cacheWrite:0,output:0,reasoning:0}})
const coverage={from,observedAt:now,gaps:[],diagnostics:[]}
function fixture(){const records:LedgerRow[]=[],observations:Observation[]=[];let used=0
 for(let i=0;i<=40;i++){observations.push({id:String(i),accountID:'a',windowID:'weekly',at:from+i*300000,usedPoints:used,resetAt,regime,precisionPoints:.001,reportingDelayMilliseconds:0});if(i<40){const input=10000+(i%4)*1000;records.push(row(String(i),from+(i+1)*300000,input));used+=input*.000001}}
 return {records,observations}
}
test('exact fixed-window rates deduplicate updates, separate pending and exclude corroborating host counters',()=>{
 const complete={...row('r',now-1000),tokens:{input:10000,cacheRead:20000,cacheWrite:0,output:100,reasoning:50},outputTotal:150,recordedAt:now}
 const running={...complete,state:'running',recordedAt:now-1,tokens:{input:null,cacheRead:null,cacheWrite:null,output:null,reasoning:null}}
 const pending={...running,id:'pending',sessionID:'s2'}
 const report=sessionBurn([account],[],[complete,running,pending,{...complete,id:'host',source:'opencode-host'}],now,coverage)
 expect(report.excludedHostCounterRecords).toBe(1)
 const s=report.pools[0].sessions.find(s=>s.sessionID==='s1')!
 expect(s.completedRequests).toBe(1);expect(s.totals.known).toEqual([10000,20000,0,150]);expect(s.totals.visibleOutput).toBe(100);expect(s.totals.reasoningOutput).toBe(50)
 expect(s.rates[1].knownTokensPerMinute).toEqual([2000,4000,0,30]);expect(s.rates[1].allowance.points).toBeNull()
 expect(report.pools[0].sessions.find(s=>s.sessionID==='s2')!.pendingRequests).toBe(1)
})
test('chronological estimates never train on the interval being scored and expose a surprise as residual',()=>{
 const f=fixture(),baseline=sessionBurn([account],f.observations,f.records,now,coverage).pools[0]
 expect(baseline.accuracy.chronologicalTestedIntervals).toBeGreaterThan(8);expect(baseline.accuracy.maximumAbsoluteErrorPoints!).toBeLessThan(.00001)
 for(const point of baseline.series.filter(s=>s.predictedPoints!==null))expect(point.trainingThrough!).toBeLessThanOrEqual(point.from)
 const changed=f.observations.map((o,i)=>i===40?{...o,usedPoints:o.usedPoints+2}:o)
 const surprised=sessionBurn([account],changed,f.records,now,coverage).pools[0],last=surprised.series.at(-1)!
 expect(last.predictedPoints).toBeCloseTo(baseline.series.at(-1)!.predictedPoints!,6);expect(last.residualPoints).toBeCloseTo(2,6);expect(surprised.accuracy.state).toBe('outside-target')
 expect(last.sessions.reduce((n,s)=>n+s.estimatedPoints!,0)).toBeCloseTo(last.predictedPoints!,6)
})
test('a missing component or stale collector cannot become an exact zero or a live allowance estimate',()=>{
 const f=fixture(),partial={...f.records.at(-1)!,tokens:{...f.records.at(-1)!.tokens,input:null}}
 const report=sessionBurn([account],f.observations,[...f.records.slice(0,-1),partial],now,coverage).pools[0]
 expect(report.series.at(-1)!.predictedPoints).toBeNull();expect(report.series.at(-1)!.tokens.missing[0]).toBe(1)
 const stale=sessionBurn([account],f.observations,f.records,now,{...coverage,observedAt:now-90001}).pools[0]
 expect(stale.sessions[0].rates[0].allowance.points).toBeNull();expect(stale.sessions[0].rates[0].coverageComplete).toBe(false)
})
test('unbound Codex activity is inferred only for a single account and remains separated by host',()=>{
 const r={...row('c',now),accountID:undefined,regime:undefined,source:'codex' as const}
 expect(sessionBurn([account],[],[r],now,coverage).pools[0].sessions[0].accountBinding).toBe('inferred-single-account')
 const multi=sessionBurn([account,{...account,id:'b'}],[],[r],now,coverage)
 expect(multi.pools.every(p=>p.sessions.length===0)).toBe(true);expect(multi.unassignedRequests).toBe(1)
})

test('empty captured activity cannot masquerade as a calibrated chronological prediction',()=>{
 const f=fixture(),pool=sessionBurn([account],f.observations,[],now,coverage).pools[0]
 expect(pool.accuracy.chronologicalTestedIntervals).toBe(0);expect(pool.accuracy.maximumAbsoluteErrorPoints).toBeNull();expect(pool.series.every(s=>s.predictedPoints===null)).toBe(true)
})
