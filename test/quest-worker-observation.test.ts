import {test,expect} from 'bun:test'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {observeWorker,boundedInspection} from '../quest/worker-observation.mjs'
import {reconcileWorkers,inspectWorker} from '../quest/worker-inspection'
import {QuestStore} from '../quest/store'
import {QuestTracker} from '../quest/tracker'
import {dispatchReservationFile} from '../models/dispatch-planner'
import {RouteReservations} from '../models/route-reservations'

test('unfinished transcript and old outcome do not imply running or completion',()=>{
 const session={time:{updated:20,idle:10},outcome:'succeeded',model:{providerID:'p',id:'m',variant:'medium'}}
 expect(observeWorker(session).state).toBe('unknown')
 expect(observeWorker({...session,time:{updated:20,idle:30}},{messages:[{time:{created:40}}]}).state).toBe('unknown')
 expect(observeWorker(session,{active:true}).state).toBe('running')
 expect(observeWorker(session,{active:true,permissions:[{}]}).state).toBe('blocked')
 expect(observeWorker({...session,time:{updated:20,idle:30}},{active:false}).state).toBe('completed')
})
test('bounded host failure is actionable and preserves uncertainty',async()=>{
 await expect(boundedInspection(()=>new Promise(()=>{}),10)).rejects.toThrow('timed out')
 const observed=await inspectWorker({get:async()=>{throw Error('fetch failed')}},{sessionID:'ses_worker',callID:'r'} as any)
 expect(observed.state).toBe('unreachable');expect(observed.reason).toContain('do not redispatch')
})
test('missed terminal outcome reconciles once after reload, settles hold and preserves unfinished steps',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quest-observation-')),store=new QuestStore(dir),runID='12345678901234567890123456'
 try{
 const q=store.create({id:'01j00000000000000000000988',title:'Reconcile',objective:'Verify',contractVersion:2,stages:[{id:'edit',title:'Edit',status:'pending',needs:[]}]})
 store.apply(q.id,'session-planned',{callID:runID,runID,role:'worker',deliverables:['edit']},'test')
 store.apply(q.id,'session-bound',{callID:runID,sessionID:'ses_observed'},'test')
 const file=dispatchReservationFile(store.runtime)
 writeFileSync(file,JSON.stringify({version:1,reservations:[{runID,routeID:'route',accountID:'account',windows:{},exclusive:true,state:'active',reason:'fixture'}]}))
 const tracker=new QuestTracker(store)
 tracker.onHostEvent({type:'session.execution.interrupted',data:{sessionID:'ses_observed',reason:'shutdown'}})
 expect(store.read(q.id)!.sessions[0].state).toBe('executing')
 await reconcileWorkers(store,{get:async()=>{throw Error('unreachable')}})
 expect(new RouteReservations(file).get(runID)?.state).toBe('active')
 const completed=Date.now()+1000,host={get:async()=>({id:'ses_observed',outcome:'failed',time:{updated:completed-100,idle:completed}})}
 await reconcileWorkers(store,host)
 expect(store.read(q.id)!.sessions[0].state).toBe('failed')
 expect(store.read(q.id)!.stages[0].status).not.toBe('done')
 expect(new RouteReservations(file).get(runID)?.completedAt).toBe(new Date(completed).toISOString())
 const revision=store.read(q.id)!.revision
 await reconcileWorkers(new QuestStore(dir),host)
 expect(store.read(q.id)!.revision).toBe(revision)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('permission waits identify read scope and native recovery without exposing shell arguments',()=>{
 const result=observeWorker({time:{updated:20}},{active:true,permissions:[{action:'external_directory',resources:['C:/hub/AGENTS.md\x1b[31m']},{action:'shell',resources:['curl -H Authorization: SECRET']}]})
 expect(result.state).toBe('blocked');expect(result.reason).toContain('external_directory (C:/hub/AGENTS.md)');expect(result.reason).toContain('Open the worker session');expect(result.reason).toContain('Existing launch retained');expect(JSON.stringify(result)).not.toMatch(/SECRET|Authorization|\\u001b/)
})

test('pending forms and live identity drift are blocked without inventing terminal outcomes',()=>{
 const expected={agentRole:'proxy-sol',providerID:'cliproxyapi',modelID:'gpt-5.6-sol',reasoningEffort:'xhigh'}
 const actual={agent:'quest-giver',model:{providerID:'cliproxyapi',id:'gpt-5.6-luna',variant:'medium'},time:{updated:20}}
 expect(observeWorker(actual,{active:true,expected}).state).toBe('blocked')
 expect(observeWorker(actual,{active:true,expected}).reason).toContain('differs from the recorded dispatch')
 expect(observeWorker(actual,{active:true,forms:[{id:'pending'}]}).reason).toContain('worker question')
 expect(observeWorker({...actual,outcome:'failed',time:{updated:20,idle:30}},{active:false,expected}).state).toBe('failed')
 expect(observeWorker({...actual,outcome:'failed',time:{updated:20,idle:30}},{expected}).state).toBe('failed')
})
