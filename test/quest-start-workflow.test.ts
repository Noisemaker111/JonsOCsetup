/**
 * @core-prevents an id-only Quest start importing absent legacy code, duplicating an admission, or losing its saved model and delivery choice
 * @core-observed On September 13 the external start helper imported quest/cli-api.ts, a master-only file absent from agents, and the external board used a different ledger from oc.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {openBoard} from '../setup/files/.agents/quest-api.mjs'
import {QuestStore} from '../quest/store'
import {requestQuestStart,requestQuestReview,startRequests} from '../quest/start-request'
import {questWorkflow,deliveryInstructions} from '../quest/workflow'

test('the callable board persists workflow choices and one admission across reopening',async()=>{
 const ledgerRoot=mkdtempSync(join(tmpdir(),'quest-start-'))
 try{
  const options={release:resolve(import.meta.dir,'..'),ledgerRoot,agent:'workflow-check'}
  const board=await openBoard(options)
  const {quest}=board.file({title:'Summarize account costs',intent:'Produce a cost summary from saved task measurements',project:ledgerRoot,steps:['Summarize measurements'],workflow:{task:'utility',delivery:'none'}})
  const first=board.start(quest.id),again=(await openBoard(options)).start(quest.id)
  expect(again).toEqual(first)
  expect(startRequests(new QuestStore(ledgerRoot),quest.id)).toHaveLength(1)
  board.configure(quest.id,{task:'review',model:'user-provider/user-model#high',delivery:'quest-pr'})
  const saved=new QuestStore(ledgerRoot).read(quest.id)!
  expect(questWorkflow(saved)).toEqual({task:'review',model:'user-provider/user-model#high',delivery:'quest-pr'})
  expect(deliveryInstructions(saved)).toContain('one pull request')
  board.configure(quest.id,{delivery:'none'})
  expect(questWorkflow(new QuestStore(ledgerRoot).read(quest.id)!).model).toBeUndefined()
  board.progress(quest.id,'1','Started without a claim')
  board.release(quest.id,'1')
  expect((await openBoard(options)).read(quest.id).steps[0].status).toBe('pending')
 }finally{rmSync(ledgerRoot,{recursive:true,force:true})}
})

test('finished external work queues one review and active work cannot be duplicated',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-return-')),store=new QuestStore(root)
 try{
  const q=store.create({id:'12345678901234567890123456',title:'Finish account report',objective:'Save the measured result',stages:[{id:'report',title:'Report',status:'done',needs:[],todos:[],proofs:[]}]})
  requestQuestReview(store,q.id);requestQuestReview(store,q.id)
  expect(startRequests(store,q.id)).toHaveLength(1)
  expect(()=>requestQuestStart(store,q.id)).toThrow('No pending steps')
 }finally{rmSync(root,{recursive:true,force:true})}
})
