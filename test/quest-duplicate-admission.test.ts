import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {QuestStore} from '../quest/store'
import {questsAPI} from '../quest/api'
import {readAllQuests} from '../quest/index'
import {reconcileWorkers} from '../quest/worker-inspection'

const context=(requestID:string,projectID='project-a'):any=>({project:{id:projectID,root:join('C:','projects',projectID)},sessionID:'ses_giver',requestID})
const started=async()=>({sessionID:'ses_worker'})
const request={title:'Missing provider credential must surface a TUI error, not silently drop the prompt',description:'A missing provider credential must show a TUI error instead of dropping the prompt.',steps:[{title:'Drive the TUI without a credential'}]}
const code=(call:()=>unknown)=>{try{call()}catch(error){return (error as any).code}return 'no error'}

test('one unresolved Quest owns a request: a reworded retry is refused, other work and other projects are not',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-admission-'))
 try{
  const store=new QuestStore(root)
  const first=questsAPI(store,context('call-1'),started).create(request)
  expect(questsAPI(store,context('call-1'),started).create(request).id).toBe(first.id)
  expect(code(()=>questsAPI(store,context('call-2'),started).create({...request,title:'A missing provider credential must show a TUI error instead of silently dropping the prompt'}))).toBe('DUPLICATE_QUEST')
  expect(questsAPI(store,context('call-3'),started).create({title:'Word-wise editing keys for the composer',description:'Ctrl+Backspace and Ctrl+Delete must edit whole words in the composer.',steps:[{title:'Drive the composer keys'}]}).id).not.toBe(first.id)
  expect(questsAPI(store,context('call-4','project-b'),started).create(request).id).not.toBe(first.id)
  expect(readAllQuests(root).length).toBe(3)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('a dispatch that never bound a worker is settled, so the retry is another run of the same Quest',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-dispatch-'))
 try{
  const store=new QuestStore(root)
  const quest=questsAPI(store,context('call-1'),started).create({title:'Append a marker line',description:'Append one marker line to a scratch file.',steps:[{title:'Append the marker'}]})
  const transportFailure=async()=>{throw new Error('transport reset before the host answered')}
  await expect(questsAPI(store,context('call-2'),transportFailure as any).run(quest.id)).rejects.toThrow('call action=run on Quest '+quest.id)
  expect(store.read(quest.id)!.sessions.at(-1)!.state).toBe('planned')
  // Left planned the step is ineligible forever, and a fresh duplicate Quest is the only move left.
  await expect(questsAPI(store,context('call-3'),started).run(quest.id)).rejects.toThrow('already has an active run')
  await reconcileWorkers(store,{get:async()=>undefined})
  expect(store.read(quest.id)!.sessions.at(-1)!.state).toBe('failed')
  expect((await questsAPI(store,context('call-4'),started).run(quest.id)).sessionID).toBe('ses_worker')
  expect(readAllQuests(root).length).toBe(1)
 }finally{rmSync(root,{recursive:true,force:true})}
})
