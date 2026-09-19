/**
 * @core-prevents a created but unprompted worker being persisted as executing while launch readiness or prompt admission is still pending
 * @core-observed On September 15 the self-saving Quest showed an executing worker for over thirty minutes although its native session had zero messages.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {QuestStore} from '../quest/store'
import {questsAPI} from '../quest/api'
import {startQuestRun} from '../quest/runtime'
import {projectIdentity,physicalDirectory} from '../quest/project'
import {installSharedWorkspaceGuard} from '../quest/shared-guard'
import {reconcileWorkers} from '../quest/worker-inspection'

test('created workers remain planned until the native prompt is admitted, including across saved reloads',async()=>{
 const root=physicalDirectory(mkdtempSync(join(tmpdir(),'quest-prompt-admission-')))
 let releaseReady!:()=>void,releasePrompt!:()=>void
 const readyGate=new Promise<void>(r=>releaseReady=r),promptGate=new Promise<void>(r=>releasePrompt=r)
 let reachedReady!:()=>void,reachedPrompt!:()=>void
 const atReady=new Promise<void>(r=>reachedReady=r),atPrompt=new Promise<void>(r=>reachedPrompt=r)
 let running:Promise<any>|undefined
 try{
  expect(spawnSync('git',['init',root],{windowsHide:true}).status).toBe(0)
  const project=projectIdentity(root),store=new QuestStore(root),policyFile=join(root,'policy.json'),settingsFile=join(root,'settings.json')
  writeFileSync(policyFile,'{}');writeFileSync(settingsFile,JSON.stringify({version:1,workspaceMode:'worktree'}))
  const model={providerID:'configured-provider',id:'configured-model',variant:'high'},sessions=new Map<string,any>([['giver',{id:'giver',location:{directory:root}}]])
  const host={get:async({sessionID}:any)=>sessions.get(sessionID),create:async(input:any)=>{const worker={...input,id:'ses_admission_worker'};sessions.set(worker.id,worker);return worker},prompt:async()=>{reachedPrompt();await promptGate;return {id:'msg_admitted'}}}
  await installSharedWorkspaceGuard({session:host,tool:{transform:async()=>{}}},store)
  const start=startQuestRun(store,host,{policyFile,settingsFile,beforePrompt:async()=>{reachedReady();await readyGate},reserve:(async()=>({route:{accountID:'configured-account',providerID:model.providerID,modelID:model.id,reasoning:model.variant,agent:'worker',serviceTier:'default',harness:'native'},bootstrapByProject:{},decision:{summary:'User-selected route'},ledger:{settle(){}}})) as any})
  const context={project,directory:root,sessionID:'giver',requestID:'admission'}
  const api=questsAPI(store,context,start)
  const q=api.create({title:'Inspect the maintained README',description:'Record its first heading',workflow:{readOnly:true},steps:[{id:'read',title:'Read the first heading'}]})
  running=api.run(q.id,{model:'configured-provider/configured-model#high',task:'utility'})
  await atReady
  const saved=()=>new QuestStore(root).read(q.id)!
  expect(saved().sessions[0].sessionID).toBe('ses_admission_worker')
  expect(saved().sessions[0].state).toBe('planned')
  expect(saved().sessions[0].scope?.readOnly).toBe(true)
  expect(saved().state).toBe('Waiting')
  await expect(questsAPI(store,{...context,requestID:'duplicate'},start).run(q.id,{readOnly:true,task:'utility'})).rejects.toThrow('already has an active run')
  releaseReady();await atPrompt
  expect(saved().sessions[0].state).toBe('planned')
  releasePrompt();await running
  expect(saved().sessions[0].state).toBe('executing')
  expect(saved().state).toBe('Working')
  // A late acknowledgment or repeated identity claim cannot resurrect terminal work.
  const run=saved().sessions[0]
  store.apply(q.id,'session-state',{callID:run.callID,state:'completed'},'native-terminal')
  store.apply(q.id,'session-claimed',{callID:run.callID,sessionID:run.sessionID,state:'planned'},'late-identity')
  store.apply(q.id,'session-state',{callID:run.callID,state:'executing',preserveTerminal:true},'late-ack')
  expect(saved().sessions[0].state).toBe('completed')
 }finally{releaseReady();releasePrompt();await running?.catch(()=>{});rmSync(root,{recursive:true,force:true})}
},30000)

test('inspecting one Quest does not join an unrelated pending host observation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-scoped-observation-')),store=new QuestStore(root)
 let release!:()=>void,entered!:()=>void
 const pending=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r)
 let old:Promise<any>|undefined
 try{
  const make=(id:string,sessionID:string)=>store.create({id,title:'Inspect '+sessionID,objective:'Observe this assigned worker',contractVersion:2,stages:[],sessions:[{callID:id,runID:id,sessionID,state:'executing',role:'worker',deliverables:[],evidence:[],attempt:1,updatedAt:new Date().toISOString()} as any]})
  const first=make('a'.repeat(26),'ses_slow_history'),second=make('b'.repeat(26),'ses_requested_worker')
  const calls:string[]=[]
  const host={get:async({sessionID}:any)=>{calls.push(sessionID);if(sessionID==='ses_slow_history'){entered();await pending}return {id:sessionID}},active:async()=>({})}
  old=reconcileWorkers(store,host,first.id);await started
  expect(reconcileWorkers(store,host,first.id)).toBe(old)
  const result=await reconcileWorkers(store,host,second.id)
  expect(result[second.id].state).toBe('unknown')
  expect(calls).toEqual(['ses_slow_history','ses_requested_worker'])
 }finally{release();await old;rmSync(root,{recursive:true,force:true})}
})
