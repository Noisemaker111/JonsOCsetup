/**
 * @core-prevents a saved blocked terminal result permanently preventing a corrected retry, while retaining the duplicate-dispatch guard
 * @core-observed The Luna measurement worker saved lifecycle-invalid trials as blocked; after corrected dev activation, quests.run still raised STEP_UNRECONCILED despite the giver inspecting and saving that result (2026-09-14).
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {QuestStore} from '../quest/store'
import {questsAPI} from '../quest/api'

test('an explicit saved result permits one corrected retry after reload, never an active or unrecorded duplicate',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-result-retry-'))
 try{
  let launched=0
  const context={project:{id:'result-check',root},sessionID:'giver',requestID:'create'}
  const store=new QuestStore(root)
  const api=(requestID:string)=>questsAPI(new QuestStore(root),{...context,requestID},async()=>{launched++;return{sessionID:'worker-'+launched}})
  const q=api('create').create({title:'Measure corrected native operations',description:'Retain rejected trials and repeat the corrected operation',steps:[{id:'measure',title:'Measure the native operation'}]})
  store.apply(q.id,'session-claimed',{callID:'old',runID:'old',sessionID:'old-worker',role:'worker',deliverables:['measure']},'test')
  store.apply(q.id,'session-state',{callID:'old',state:'completed'},'test')
  await expect(api('unrecorded').run(q.id,{stepIDs:['measure']})).rejects.toMatchObject({code:'STEP_UNRECONCILED'})
  api('pending-only').update(q.id,{steps:[{id:'measure',state:'pending',note:'Try again'}]})
  await expect(api('still-unrecorded').run(q.id,{stepIDs:['measure']})).rejects.toMatchObject({code:'STEP_UNRECONCILED'})
  api('record-result').update(q.id,{steps:[{id:'measure',state:'blocked',note:'The observed trial ended early; retain it as invalid. Corrected runtime is now available.'}]})
  api('authorize-retry').update(q.id,{steps:[{id:'measure',state:'pending'}]})
  await api('retry').run(q.id,{stepIDs:['measure']})
  expect(launched).toBe(1)
  await expect(api('active-duplicate').run(q.id,{stepIDs:['measure']})).rejects.toMatchObject({code:'STEP_RUNNING'})
  const saved=new QuestStore(root).read(q.id)!
  expect(saved.sessions.find(s=>s.runID==='old')?.state).toBe('completed')
  expect(saved.stages[0].note).toContain('retain it as invalid')
  const current=saved.sessions.find(s=>s.runID!=='old')!
  store.apply(q.id,'session-state',{callID:current.callID,state:'completed'},'test')
  await expect(api('new-unrecorded').run(q.id,{stepIDs:['measure']})).rejects.toMatchObject({code:'STEP_UNRECONCILED'})
  expect(launched).toBe(1)
 }finally{rmSync(root,{recursive:true,force:true})}
})
