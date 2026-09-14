/**
 * @core-prevents routing and Quest creation disagreeing about the selected project after correction, failed selection, or restart
 * @core-observed Installed project_select accepted an unsupported directory field, returned clarify, then quest create saved in the fallback project. Router plugin storage and giver registry independently owned selection (2026-09-12).
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {QuestStore} from '../quest/store'
import {saveUserGiver,readUserGiver} from '../quest/giver-registry.mjs'
import {giverContext,selectUserGiverProject} from '../quest/user-giver'
import {RouterMemory} from '../project-router/memory'
import {verifyTarget,resolveTargets} from '../project-router/resolution'
import {installProjectRouter} from '../project-router/server'
import {DiscoveryHost} from '../project-router/host'
import {QuestContinuation} from '../quest/continuation'
import {questsAPI} from '../quest/api'
const sessionID='ses_selectioncheck'
const fixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'selection-authority-')),prior=process.env.OPENCODE_QUEST_ROOT
 process.env.OPENCODE_QUEST_ROOT=root
 const a=join(root,'a'),b=join(root,'b');mkdirSync(a);mkdirSync(b)
 const store=new QuestStore(root),session={id:sessionID,agent:'quest-giver',location:{directory:root}}
 saveUserGiver(store.runtime,{state:'bound',sessionID,directory:root})
 const data=new Map<string,any>(),storage={get:async(k:string)=>data.get(k),set:async(k:string,v:any)=>{data.set(k,v)}}
 return {root,a,b,store,session,data,storage,close:()=>{if(prior===undefined)delete process.env.OPENCODE_QUEST_ROOT;else process.env.OPENCODE_QUEST_ROOT=prior;rmSync(root,{recursive:true,force:true})}}
}
test('registered prompt hook preserves goals for automatic notices and pauses on user steering',async()=>{
 const f=fixture();let dispose:(()=>void)|undefined
 try{
  const project=verifyTarget(f.root),runID='notice-worker'
  const context={sessionID,requestID:'goal-start',directory:f.root,project} as any
  const {id}=questsAPI(f.store,context,async()=>({sessionID})).create({title:'Keep pursuing the assigned work',description:'Preserve the goal while handling automatic notices',steps:[{id:'work',title:'Complete assigned work'}]})
  f.store.apply(id,'session-claimed',{callID:runID,runID,sessionID,role:'worker',deliverables:['work']},'test')
  f.store.apply(id,'session-state',{callID:runID,state:'executing'},'test')
  const continuation=new QuestContinuation(f.store,async()=>({sessionID}) as any,{goalMode:true})
  continuation.startWorkerGoal(id,['work'],context,'configured/model#effort')
  let prompt:Function|undefined
  dispose=await installProjectRouter({storage:f.storage,tool:{transform:async()=>{}},session:{get:async()=>f.session,create:async()=>{},prompt:async()=>{},hook:async(name:string,fn:Function)=>{if(name==='prompt')prompt=fn}}},new DiscoveryHost('unused',async()=>{throw Error('No discovery needed')}))
  for(const flag of ['questWorkerReturn','questWorkerPermission','questReview','projectRouterGoal','projectRouterReturn']){
   await prompt!({sessionID,metadata:{[flag]:true}})
   expect(continuation.goalStatus(sessionID)[0].state).toBe('running')
  }
  await prompt!({sessionID,metadata:{questWorkerPermission:false}})
  expect(continuation.goalStatus(sessionID)[0].state).toBe('stopped')
 }finally{dispose?.();f.close()}
})
test('legacy selection migrates once and a new router reads the same authority as Quest creation',async()=>{
 const f=fixture()
 try{
  const a=verifyTarget(f.a),b=verifyTarget(f.b)
  saveUserGiver(f.store.runtime,{state:'bound',sessionID,directory:f.root,selection:{revision:3,targets:[{directory:a.directory,project:{id:a.id,root:a.root}}]}})
  f.data.set('selection/'+sessionID,{revision:3,targets:[a],pin:a,asked:false})
  const first=await new RouterMemory(f.storage).selection(sessionID)
  expect(first.pin?.directory).toBe(a.directory)
  expect(readUserGiver(f.store.runtime).selection.version).toBe(2)
  f.data.set('selection/'+sessionID,{revision:999,targets:[b]})
  const reloaded=await new RouterMemory(f.storage).selection(sessionID)
  expect(reloaded.targets[0].directory).toBe(a.directory)
  expect(giverContext(f.store,f.session,'create',undefined,true).directory).toBe(a.directory)
  expect(()=>selectUserGiverProject(f.store,sessionID,[b],4,{expectedRevision:2})).toThrow('saved selection changed')
  expect(readUserGiver(f.store.runtime).selection.revision).toBe(3)
 }finally{f.close()}
})
test('a failed correction blocks new creation, leaves existing Quest destinations intact, and can be corrected after restart',async()=>{
 const f=fixture();let dispose:(()=>void)|undefined
 try{
  const operations=new Map<string,any>()
  dispose=await installProjectRouter({storage:f.storage,tool:{transform:async(fn:Function)=>fn({add:(op:any)=>operations.set(op.name,op)})},session:{get:async()=>f.session,create:async()=>{throw Error('Selection must never create a conversation')},prompt:async()=>{},hook:async()=>{}}},new DiscoveryHost('unused',async()=>{throw Error('Selection does not use host discovery')}))
  const call=(input:any)=>operations.get('project_select').execute(input,{sessionID,id:'selection-call'})
  const selected=await call({action:'pin',selectors:[f.a]})
  expect(selected.output.targets[0].directory).toBe(verifyTarget(f.a).directory)
  const reads=await Promise.all([{}, {selectors:[f.a]}].map(input=>operations.get('project_resolve').execute(input,{sessionID,id:'parallel-read'})))
  expect(reads.map(r=>r.output.state)).toEqual(['resolved','resolved'])
  expect(reads.map(r=>r.output.revision)).toEqual([selected.output.revision,selected.output.revision])
  const revision=selected.output.revision
  const routed=await operations.get('project_route').execute({revision},{sessionID,id:'confirm-route'})
  expect(routed.output.createdSessions).toBe(0)
  expect(readUserGiver(f.store.runtime).selection.revision).toBe(revision)
  const q=f.store.create({id:'01j00000000000000000000aa',title:'Keep the original project',objective:'Keep the existing Quest in its original project',contractVersion:2,project:verifyTarget(f.a),stages:[]} as any)
  const failed=await call({action:'correct',directory:f.b})
  expect(failed.output.code).toBe('INVALID_INPUT')
  expect(resolveTargets(await new RouterMemory(f.storage).selection(sessionID),[],{}).state).toBe('clarify')
  expect(()=>giverContext(new QuestStore(f.root),f.session,'new',undefined,true)).toThrow('No Quest was created')
  expect(giverContext(f.store,f.session,'existing',q.id).directory).toBe(verifyTarget(f.a).directory)
  expect(()=>giverContext(f.store,f.session,'list')).not.toThrow()
  // A removed old directory must not prevent choosing its replacement.
  rmSync(f.a,{recursive:true})
  const corrected=await call({action:'correct',selectors:[f.b]})
  expect(corrected.output.pending).toBeUndefined()
  expect(giverContext(new QuestStore(f.root),f.session,'new',undefined,true).directory).toBe(verifyTarget(f.b).directory)
  expect((await new RouterMemory(f.storage).selection(sessionID)).targets[0].directory).toBe(verifyTarget(f.b).directory)
 }finally{dispose?.();f.close()}
})
