import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {decideBurnControl,updateBurnControls,readBurnControls} from '../usage/burn-control'
import {setUsageTarget,readUsageTargets,type UsageTarget} from '../usage/usage-target'
import {accountRegime} from '../usage/calibration-store'
import type {AccountUsage} from '../usage/account-types'
import type {Observation} from '../usage/calibration'
import {RouteReservations} from '../models/route-reservations'
import routing from './fixtures/routing-19h.json'
const start=2000000000000,resetAt=start+86400000
const account=(now=start,used=40):AccountUsage=>({id:'a',provider:'openai',identity:'Account',connections:[],plan:{name:'Pro',rateLimitTier:null,multiplier:null,provenance:'provider-observed',observedAt:null},windows:[{id:'shared',label:'7d',scope:'shared',durationSeconds:604800,usedPercent:used,remainingPercent:100-used,resetAt:new Date(resetAt).toISOString(),observedAt:new Date(now).toISOString(),state:'available'}],extraUsage:{enabled:null},state:'available',observedAt:new Date(now).toISOString(),attemptedAt:null,nextAttemptAt:null,failures:0,error:null})
const regime=accountRegime(account()),target:UsageTarget={accountID:'a',deadlineAt:start+7200000,reservePoints:0,updatedAt:start,pacing:{windowID:'shared',regime,resetAt,maxConcurrent:4}}
const observations=(now:number,delta=1,used=40):Observation[]=>[now-600000,now].map((at,i)=>({id:String(at),accountID:'a',windowID:'shared',regime,resetAt,at,usedPoints:used-(i?0:delta),replenishing:false,precisionPoints:null,reportingDelayMilliseconds:null}))
test('fresh provider access recovers old zero-slot pacing immediately without bypassing unavailable quota',()=>{
 const first=decideBurnControl(target,account(),[],undefined,start),zero={...first,desiredConcurrency:0}
 expect(decideBurnControl(target,account(start+299999),[],zero,start+299999).desiredConcurrency).toBe(1)
 const recovered=decideBurnControl(target,account(start+300000),[],zero,start+300000)
 expect(recovered.desiredConcurrency).toBe(1)
 expect(recovered.lastAdjustedAt).toBe(start)
 expect(recovered.reason).toContain('one useful worker')
 expect(decideBurnControl(target,account(start+600000),[],recovered,start+600000).desiredConcurrency).toBe(1)
 expect(decideBurnControl(target,account(start+300000),[],{...zero,state:'stopped'},start+300000).state).toBe('ready')
 expect(decideBurnControl(target,account(),[],zero,start+300000).state).toBe('hold')
 expect(decideBurnControl(target,undefined,[],zero,start+300000).state).toBe('hold')
 expect(decideBurnControl(target,account(start+300000),[],{...zero,updatedAt:start+400000},start+300000).state).toBe('hold')
 expect(decideBurnControl({...target,reservePoints:60},account(start+300000),[],zero,start+300000).state).toBe('ready')
 expect(decideBurnControl(target,{...account(start+300000),state:'exhausted'},[],zero,start+300000).state).toBe('stopped')
 expect(decideBurnControl(target,account(start+300000),[],{...first,desiredConcurrency:4},start+300000).desiredConcurrency).toBe(1)
})
test('feedback has dwell and hysteresis, keeps at least one slot, and survives reload without double ramping',()=>{
 const dir=mkdtempSync(join(tmpdir(),'usage-burn-')),file=join(dir,'control.json'),targetsFile=join(dir,'targets.json')
 try{
  setUsageTarget('a',target.deadlineAt,0,targetsFile,start,target.pacing)
  const targets=readUsageTargets(targetsFile)
  let rows=updateBurnControls([account()],observations(start),start,targets,file)
  expect(rows[0].desiredConcurrency).toBe(1)
  rows=updateBurnControls([account(start+299999)],observations(start+299999),start+299999,targets,file);expect(rows[0].desiredConcurrency).toBe(1)
  rows=updateBurnControls([account(start+300000)],observations(start+300000),start+300000,targets,file);expect(rows[0].desiredConcurrency).toBe(2)
  expect(readBurnControls(file)[0].desiredConcurrency).toBe(2)
  expect(updateBurnControls([account(start+300000)],observations(start+300000),start+300000,targets,file)[0].desiredConcurrency).toBe(2)
  let control=decideBurnControl(target,account(start+600000),observations(start+600000,30),rows[0],start+600000);expect(control.desiredConcurrency).toBe(1)
  control=decideBurnControl(target,account(start+900000),observations(start+900000,30),control,start+900000);expect(control.desiredConcurrency).toBe(1)
  control=decideBurnControl(target,account(start+1200000),observations(start+1200000),control,start+1200000);expect(control.desiredConcurrency).toBe(2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('provider freshness and exhaustion remain gates; planned deadlines are advisory',()=>{
 const first=decideBurnControl(target,account(),observations(start),undefined,start)
 expect(decideBurnControl(target,account(),observations(start),first,start+30001).state).toBe('hold')
 expect(decideBurnControl(target,undefined,[],first,start).state).toBe('hold')
 expect(decideBurnControl(target,{...account(),plan:{...account().plan,name:'Different'}},[],first,start).state).toBe('stopped')
 const changed=account();changed.windows[0].resetAt=new Date(resetAt+1).toISOString();expect(decideBurnControl(target,changed,[],first,start).state).toBe('stopped')
 const depleted=decideBurnControl(target,{...account(start,100),state:"exhausted"},observations(start,1,100),first,start);expect(depleted.state).toBe('stopped');expect(depleted.desiredConcurrency).toBe(0)
 expect(decideBurnControl(target,account(start+1),observations(start+1),depleted,start+1).state).toBe('ready')
 expect(decideBurnControl(target,account(target.deadlineAt),[],first,target.deadlineAt).state).toBe('ready')
 expect(decideBurnControl(target,account(start-1),[],first,start-1).state).toBe('hold')
})
test('atomic reservations enforce desired concurrency including unknown runs without weakening exclusive holds',()=>{
 const dir=mkdtempSync(join(tmpdir(),'usage-burn-reserve-'));try{
 const input=structuredClone(routing) as any,route=input.routes[0],a=input.accounts.find((x:any)=>x.id===route.accountID),now=Date.parse(input.request.now)
 input.request.allowedRouteIDs=[route.id];input.request.explicitRouteID=route.id;input.request.reserveFraction=0
 route.admission='configured-choice';route.quotaPerTask={}
 a.pacing={state:'ready',desiredConcurrency:2,deadlineAt:now+7200000,updatedAt:now,reason:'Measured pacing'}
 const ledger=new RouteReservations(join(dir,'reservations.json'))
 expect(ledger.reserve('one',input).reservation?.paced).toBe(true);ledger.settle('one',{state:'unknown'})
 const second=ledger.reserve('two',input);expect(second.reservation).not.toBeNull();expect(second.reservation?.reason).toContain('up to 2 concurrent managed workers')
  const denied=ledger.reserve('three',input);expect(denied.reservation).toBeNull();expect(JSON.stringify(denied.decision)).toContain('Burn pacing hold:')
  a.pacing.desiredConcurrency=1;expect(ledger.reserve('bounded-probe',input).reservation).toBeNull()
 a.pacing.state='stopped';expect(JSON.stringify(ledger.reserve('four',input).decision)).toContain('Burn pacing stopped:')
 const exclusive=new RouteReservations(join(dir,'exclusive.json')),pacing=a.pacing;pacing.state='ready';delete a.pacing;route.quotaPerTask={}
 expect(exclusive.reserve('first',input).reservation?.exclusive).toBe(true);a.pacing=pacing;expect(JSON.stringify(exclusive.reserve('second',input).decision)).toContain('Uncalibrated worker hold:')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

import {paceSummary} from '../usage/tui-evidence'
test('pace above 100 percent is visible without becoming a work blocker',()=>{expect(paceSummary(4,1)[0]).toContain('400%');expect(paceSummary(4,1)[0]).toContain('over target');expect(paceSummary(4,1)[0]).toContain('does not block');expect(paceSummary(4,0)[0]).toContain('Over planned allocation');expect(paceSummary(null,1)[0]).toContain('still measuring')})
