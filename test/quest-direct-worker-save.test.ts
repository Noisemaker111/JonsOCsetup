/**
 * @core-prevents a worker losing its own step save when the remote quests MCP namespace cannot connect
 * @core-observed September 15 the host logged `mcp connect failed server=quests ... Request timed out`
 * for worker worktree locations while the hub location connected with tools=13, so those workers had no
 * quests namespace; the documented report contract also dropped its verification before saving.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {QuestStore} from '../quest/store'
import {physicalDirectory} from '../quest/project'
import {createQuestService} from '../quest/service'
import {reportTool} from '../quest/adaptive-tools'
import {installQuestTools} from '../quest/server'
import {coordinatorInput} from '../quest/operations.mjs'
import {judgeRun} from '../quest/run-judgment'

test('a worker saves its assigned step through the direct tool without the quests MCP namespace',async()=>{
 const root=physicalDirectory(mkdtempSync(join(tmpdir(),'quest-direct-save-'))),store=new QuestStore(root)
 const host:any={get:async({sessionID}:any)=>({id:sessionID,agent:sessionID==='ses_giver'?'quest-giver':'worker',location:{directory:root}}),active:async()=>({data:{}})}
 let dispose=()=>{}
 const service=createQuestService(store,host,{directory:root,onDispose:fn=>{dispose=fn},startRun:async()=>{throw Error('No new dispatch')}})
 try{
  const created=await service.call('create',{title:'Save the assigned step directly',description:'A worker must save without the remote MCP.',steps:[{id:'work',title:'Finish the assigned work'}]},{sessionID:'ses_giver',id:'create'})
  store.apply(created.id,'session-claimed',{callID:'run',runID:'run',sessionID:'ses_worker',parentID:'ses_giver',role:'worker',deliverables:['work'],attempt:1},'check')
  store.apply(created.id,'session-state',{callID:'run',state:'executing'},'check')

  // The direct tool keeps the worker-assignment guard: an unassigned step is refused.
  const denied=await reportTool(service.call).execute({id:created.id,stepID:'other',state:'done',note:'out of scope'},{sessionID:'ses_worker',id:'call-denied'}).then(()=>({ok:true,code:undefined}),error=>({ok:false,code:error?.code}))
  expect(denied).toMatchObject({ok:false,code:'WORKER_ASSIGNMENT_DENIED'})

  const saved=await reportTool(service.call).execute({id:created.id,stepID:'work',state:'done',note:'Implemented and checked.',verification:{command:'bun test test/quest-direct-worker-save.test.ts',exitCode:0,artifact:'run/direct.txt'}},{sessionID:'ses_worker',id:'call-saved'})
  expect(saved.output.steps.find((step:any)=>step.id==='work')).toMatchObject({state:'done',note:'Implemented and checked.'})
  const recorded=store.read(created.id)!
  expect(recorded.evidence.tests.at(-1)).toMatchObject({command:'bun test test/quest-direct-worker-save.test.ts',result:'passed',stepID:'work',artifact:'run/direct.txt'})
  store.apply(created.id,'session-state',{callID:'run',state:'completed',result:'done'},'check')
  const settled=store.read(created.id)!
  expect(judgeRun(settled,settled.sessions.find(run=>run.runID==='run')!).accepted).toBe(true)
 }finally{dispose();rmSync(root,{recursive:true,force:true})}
})

test('a failing remote MCP registration no longer removes the direct Quest tools',async()=>{
 const root=physicalDirectory(mkdtempSync(join(tmpdir(),'quest-direct-degrade-'))),store=new QuestStore(root)
 const host:any={get:async({sessionID}:any)=>({id:sessionID,agent:'worker',location:{directory:root}}),active:async()=>({data:{}})}
 const added:any[]=[]
 const ctx:any={tool:{transform:async(callback:any)=>callback({add:(tool:any)=>added.push(tool)})},mcp:{transform:async()=>{throw Error('MCP listener unavailable')}},session:host,location:{directory:root}}
 let dispose:(()=>void)|undefined
 try{
  dispose=await installQuestTools(ctx,{store} as any)
  expect(added.map(tool=>tool.name)).toEqual(expect.arrayContaining(['quest_guidance','quest_outcome','quest_work_supply','quest_report']))
 }finally{dispose?.();rmSync(root,{recursive:true,force:true})}
})

test('the report operation keeps the verification it documents',()=>{
 const verification={command:'bun test',exitCode:0,artifact:'run/x.txt'}
 expect(coordinatorInput('report',{id:'q',stepID:'work',state:'done',note:'done',verification})).toEqual({action:'update',id:'q',update:{steps:[{id:'work',state:'done',note:'done',verification}]}})
})
