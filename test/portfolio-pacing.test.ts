import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {AccountUsage} from '../usage/account-types'
import {setUsageTarget,readUsageTargets,renewUsageTargets} from '../usage/usage-target'
import {accountRegime} from '../usage/calibration-store'
import {decideBurnControl,burnTargetKey} from '../usage/burn-control'
import {portfolioPacing} from '../usage/portfolio-pacing'
const now=2000000000000,oldReset=now-1000,newReset=now+3600000
const account=(id='a',provider:any='openai'):AccountUsage=>({id,provider,identity:'account',connections:[{id:id+'-connection',owner:'broker',routeProviders:['cliproxyapi'],modelPrefix:id}],plan:{name:'subscription',rateLimitTier:null,multiplier:null,provenance:'provider-observed',observedAt:new Date(now).toISOString()},windows:[{id:'shared',scope:'shared',label:'5h',durationSeconds:18000,usedPercent:20,remainingPercent:80,resetAt:new Date(newReset).toISOString(),observedAt:new Date(now).toISOString(),state:'available'}],extraUsage:{enabled:false},state:'available',observedAt:new Date(now).toISOString(),attemptedAt:null,nextAttemptAt:null,failures:0,error:null})
const pacing=(a=account(),resetAt=oldReset)=>({windowID:'shared',regime:accountRegime(a),resetAt,maxConcurrent:16})
function withTargets(body:(file:string)=>void){const dir=mkdtempSync(join(tmpdir(),'portfolio-targets-'));try{body(join(dir,'targets.json'))}finally{rmSync(dir,{recursive:true,force:true})}}
test('recurring accounts renew independently on fresh observed resets and reload idempotently',()=>withTargets(file=>{
 const a=account(),b=account('b','claude')
 setUsageTarget(a.id,oldReset,0,file,now-2000,pacing(a),true);setUsageTarget(b.id,oldReset,5,file,now-2000,pacing(b),true)
 const rows=renewUsageTargets([a],now,file);expect(rows.find(t=>t.accountID==='a')!.deadlineAt).toBe(newReset);expect(rows.find(t=>t.accountID==='b')!.deadlineAt).toBe(oldReset)
 const key=burnTargetKey(rows[0]);expect(burnTargetKey(renewUsageTargets([a],now+1,file)[0])).toBe(key)
 expect(renewUsageTargets([a,b],now,file).every(t=>t.deadlineAt===newReset)).toBe(true);expect(readUsageTargets(file).every(t=>t.followResets)).toBe(true)
}))
test('fixed deadlines, cancelled targets, changed plans, stale clocks and pre-reset observations never auto-renew',()=>withTargets(file=>{
 const a=account();setUsageTarget('a',oldReset,0,file,now-2000,pacing(a));expect(renewUsageTargets([a],now,file)[0].deadlineAt).toBe(oldReset)
 for(const changed of [{...a,plan:{...a.plan,name:'another'}},{...a,freshness:{stale:true,ageSeconds:60,resetPending:false}},{...a,windows:[{...a.windows[0],observedAt:new Date(now+1).toISOString()}]},{...a,windows:[{...a.windows[0],observedAt:new Date(oldReset-1).toISOString()}]}]){setUsageTarget('a',oldReset,0,file,now-2000,pacing(a),true);expect(renewUsageTargets([changed],now,file)[0].deadlineAt).toBe(oldReset)}
 setUsageTarget('a',null,0,file,now);expect(renewUsageTargets([a],now,file)).toEqual([])
 expect(()=>setUsageTarget('a',newReset-1,0,file,now,pacing(a,newReset),true)).toThrow('observed reset')
}))
test('portfolio keeps independent balances and constraints and never counts ambiguous accounts as capacity',()=>{
 const a=account(),b=account('b');const targets=[a,b].map(x=>({accountID:x.id,deadlineAt:newReset,reservePoints:0,updatedAt:now,pacing:pacing(x,newReset),followResets:true}))
 const controls=targets.map((t,i)=>decideBurnControl(t,[a,b][i],[],undefined,now)),p=portfolioPacing([a,b],[],targets,controls,now)
 expect(p.accounts).toHaveLength(2);expect(p.requestedSlots).toBe(2);expect(p.accounts.map(a=>a.focus!.remainingPoints)).toEqual([80,80]);expect(p).not.toHaveProperty('remainingPoints')
 const ambiguous=[a,b].map(a=>({...a,connections:a.connections.map(c=>({...c,modelPrefix:null}))}));const held=portfolioPacing(ambiguous,[],targets,controls,now)
 expect(held.requestedSlots).toBe(0);expect(held.accounts.every(a=>a.state==='account-selection-unverified')).toBe(true)
 const exhausted={...a,windows:[...a.windows,{...a.windows[0],id:'weekly',state:'exhausted' as const,usedPercent:100,remainingPercent:0}]}
 expect(portfolioPacing([exhausted,b],[],targets,controls,now).accounts.find(a=>a.accountID==='a')!.state).toBe('quota-constrained')
 expect(portfolioPacing([a,b],[],[],[],now).requestedSlots).toBe(0)
})
test('large measured deficits ramp by at most twice the slots, within dwell and ceiling',()=>{
 const a=account(),t={accountID:'a',deadlineAt:now+600000,reservePoints:0,updatedAt:now-600000,pacing:pacing(a,newReset)}
 const observations=[{id:'old',accountID:'a',windowID:'shared',at:now-300000,usedPoints:19,resetAt:newReset,regime:accountRegime(a),precisionPoints:null,reportingDelayMilliseconds:null},{id:'new',accountID:'a',windowID:'shared',at:now,usedPoints:20,resetAt:newReset,regime:accountRegime(a),precisionPoints:null,reportingDelayMilliseconds:null}]
 const prior={...decideBurnControl(t,a,observations,undefined,now),desiredConcurrency:4,lastAdjustedAt:now-300000}
 const next=decideBurnControl(t,a,observations,prior,now);expect(next.desiredConcurrency).toBe(8);expect(decideBurnControl(t,a,observations,next,now).desiredConcurrency).toBe(8)
 expect(decideBurnControl(t,a,observations,{...prior,desiredConcurrency:12},now).desiredConcurrency).toBe(16)
})

test('advisory reserve and elapsed plan retain the controller slot in the displayed portfolio',()=>{
 const a=account();
 for(const policy of [{deadlineAt:now-1,reservePoints:0},{deadlineAt:newReset,reservePoints:90}]){
  const t={accountID:a.id,...policy,updatedAt:now-1000,pacing:pacing(a,newReset)};
  const control=decideBurnControl(t,a,[],undefined,now);
  const result=portfolioPacing([a],[],[t],[control],now).accounts[0];
  expect(result.state).toBe('ready');expect(result.requestedSlots).toBe(1);expect(result.sharedConstraints).toEqual([]);
 }
})
