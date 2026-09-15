/**
 * @core-prevents public Quest summaries and work inventory counting saved execution as live activity
 * @core-observed September 15 the canonical giver inspected a zero-message unknown worker while public get still returned Working/running1.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {QuestStore} from '../quest/store'
import {physicalDirectory} from '../quest/project'
import {createQuestService} from '../quest/service'
import {serveQuestAPI} from '../quest/api-server'
import {createQuestClient} from '../quest/client.mjs'
import {workSupplyTool} from '../quest/adaptive-tools'
import {connectHostObservation,disconnectHostObservation,recordHostObservation} from '../quest/host-observation'

test('public reads and work supply distinguish native activity from retained ownership after reload',async()=>{
 const root=physicalDirectory(mkdtempSync(join(tmpdir(),'quest-live-summary-'))),store=new QuestStore(root)
 let mode='idle',checks=0,dispose=()=>{},endpoint:any
 const host:any={get:async({sessionID}:any)=>({id:sessionID,agent:'quest-giver',location:{directory:root}}),active:async()=>{checks++;if(mode==='offline')throw Error('Connection lost');return {data:mode==='running'?{ses_worker:{}}:{}}}}
 const service=createQuestService(store,host,{directory:root,onDispose:fn=>{dispose=fn},startRun:async()=>{throw Error('No new dispatch')}})
 try{
  const created=await service.call('create',{title:'Inspect a retained worker',description:'Retain the assignment while checking actual host activity.',steps:[{id:'work',title:'Finish the assigned work'}]},{sessionID:'ses_giver',id:'create'})
  store.apply(created.id,'session-claimed',{callID:'run',runID:'run',sessionID:'ses_worker',parentID:'ses_giver',role:'worker',deliverables:['work']},'check')
  store.apply(created.id,'session-state',{callID:'run',state:'executing'},'check')
  endpoint=await serveQuestAPI(store,service,root)
  const client=createQuestClient({endpoint})
  for(const phase of ['idle','running','offline','idle']){
   mode=phase
   const record=await client.get({id:created.id})
   expect(record.recordedState).toBe('Working')
   expect(record.state).toBe(phase==='running'?'Working':'Waiting')
   expect(record.running).toBe(phase==='running'?1:0)
   expect(record.activity.unconfirmed).toBe(phase==='running'?0:1)
   expect(record.steps[0].ready).toBe(false)
   const before=checks,list=await client.list({allProjects:true})
   expect(checks-before).toBe(1)
   expect(list.items[0].activity).toMatchObject({running:record.running,assigned:1,unconfirmed:record.activity.unconfirmed})
   const supply=await workSupplyTool(store,host).execute({allProjects:true},{sessionID:'ses_giver',id:'supply-'+phase})
   expect(supply.output).toMatchObject({activeRuns:record.running,unconfirmedRuns:record.activity.unconfirmed,activeOrUncertainRuns:1,readySteps:0})
   expect(supply.output.items[0]).toMatchObject({active:record.running,unknown:record.activity.unconfirmed,assigned:1})
   expect(new QuestStore(root).read(created.id)!.sessions[0].state).toBe('executing')
  }
  // The installed server plugin exposes session events, not the TUI's active-list API.
  delete host.active
  connectHostObservation(host)
  recordHostObservation(host,{type:'session.status',data:{sessionID:'ses_worker',status:{type:'running'}}})
  expect((await client.get({id:created.id})).running).toBe(1)
  const otherHost:any={}
  connectHostObservation(otherHost)
  recordHostObservation(otherHost,{type:'session.execution.succeeded',data:{sessionID:'ses_worker'}})
  expect((await client.get({id:created.id})).running).toBe(1)
  disconnectHostObservation(host)
  expect((await client.get({id:created.id})).activity).toMatchObject({running:0,unconfirmed:1,assigned:1})
  connectHostObservation(host)
  expect((await client.get({id:created.id})).running).toBe(0)
  recordHostObservation(host,{type:'session.status',data:{sessionID:'ses_worker',status:{type:'running'}}})
  expect((await client.get({id:created.id})).running).toBe(1)
  recordHostObservation(host,{type:'session.execution.succeeded',data:{sessionID:'ses_worker'}})
  expect((await client.get({id:created.id})).running).toBe(0)
  expect(new QuestStore(root).read(created.id)!.sessions[0].state).toBe('executing')
 }finally{dispose();endpoint?.dispose();rmSync(root,{recursive:true,force:true})}
})
