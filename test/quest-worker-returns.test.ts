import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {QuestStore} from '../quest/store'
import {projectIdentity} from '../quest/project'
import {QuestWorkerReturns} from '../quest/worker-returns'

test('direct Quest terminal outcome wakes its giver once and survives reload without another prompt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quest-return-')),project=projectIdentity(dir),store=new QuestStore(join(dir,'ledger')),runID='12345678901234567890123456',prompts:any[]=[]
 const context={project,directory:dir,sessionID:'giver',requestID:'request'},model={providerID:'p',id:'m',variant:'medium'},host={get:async()=>({agent:'giver',model,location:{directory:dir}}),create:async()=>null,prompt:async(value:any)=>{prompts.push(value)}}
 try{
  const q=store.create({id:'01j00000000000000000000980',title:'Direct doc edit',objective:'Edit',project,contractVersion:2,stages:[{id:'edit',title:'Edit',status:'pending',needs:[]}]})
  store.apply(q.id,'session-planned',{callID:runID,runID,parentID:'giver',role:'worker',deliverables:['edit']},'test')
  const returns=new QuestWorkerReturns(store,host);await returns.watch({quest:q,runID,stepIDs:['edit'],context})
  await returns.tick();expect(prompts).toHaveLength(0)
  store.apply(q.id,'session-state',{callID:runID,state:'completed',result:'Saved documentation PR'},'test')
  await Promise.all([returns.tick(),returns.tick()]);expect(prompts).toHaveLength(1);expect(prompts[0].text).toContain('Saved documentation PR');expect(prompts[0].metadata.questWorkerReturn).toBe(true)
  await new QuestWorkerReturns(store,host).tick();expect(prompts).toHaveLength(1)
 }finally{rmSync(dir,{recursive:true,force:true})}
},30000)

test('unknown direct return admission never duplicates',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quest-return-')),store=new QuestStore(join(dir,'ledger')),project=projectIdentity(dir),runID='22345678901234567890123456';let calls=0
 const context={project,directory:dir,sessionID:'giver',requestID:'request'},host={get:async()=>({location:{directory:dir}}),create:async()=>null,prompt:async()=>{calls++;throw Error('transport lost')}}
 try{const q=store.create({id:'01j00000000000000000000981',title:'Failure',objective:'Report',project,stages:[]});store.apply(q.id,'session-planned',{callID:runID,runID,parentID:'giver',role:'worker',deliverables:[]},'test');const returns=new QuestWorkerReturns(store,host);await returns.watch({quest:q,runID,stepIDs:[],context});store.apply(q.id,'session-state',{callID:runID,state:'failed',result:'Actual failure'},'test');await returns.tick();await new QuestWorkerReturns(store,host).tick();expect(calls).toBe(1)}finally{rmSync(dir,{recursive:true,force:true})}
},30000)

test('dev worker returns stay with their loaded generation while older hosts remain alive',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quest-return-generations-')),store=new QuestStore(join(dir,'ledger')),project=projectIdentity(dir),runID='32345678901234567890123456',prompts:any[]=[]
 const context={project,directory:dir,sessionID:'giver',requestID:'request'},host={get:async()=>({location:{directory:dir}}),create:async()=>null,prompt:async(value:any)=>{prompts.push(value)}}
 try{
  const q=store.create({id:'01j00000000000000000000982',title:'Generation-owned return',objective:'Verify',project,stages:[]})
  store.apply(q.id,'session-planned',{callID:runID,runID,parentID:'giver',role:'worker',deliverables:[]},'test')
  const current=new QuestWorkerReturns(store,host,'gen-current');await current.watch({quest:q,runID,stepIDs:[],context});store.apply(q.id,'session-state',{callID:runID,state:'completed',result:'Verified actual result'},'test')
  await new QuestWorkerReturns(store,host,'').tick();await new QuestWorkerReturns(store,host,'gen-other').tick();expect(prompts).toHaveLength(0)
  await current.tick();await new QuestWorkerReturns(store,host,'gen-current').tick();expect(prompts).toHaveLength(1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
