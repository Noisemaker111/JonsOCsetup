/**
 * @core-prevents an id-only Quest start importing absent legacy code, duplicating an admission, or losing its saved model and delivery choice
 * @core-observed On September 13 the external start helper imported quest/cli-api.ts, a master-only file absent from agents, and the external board used a different ledger from oc.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {questsAPI} from '../quest/api'
import {QuestStore} from '../quest/store'
import {requestQuestStart,requestQuestReview,startRequests,questStartAuthorization} from '../quest/start-request'
import {runtimeQueuePath} from '../quest/runtime-queues'
import {questWorkflow,deliveryInstructions} from '../quest/workflow'

test('the callable board persists workflow choices and one admission across reopening',async()=>{
 const ledgerRoot=mkdtempSync(join(tmpdir(),'quest-start-'))
 try{
  const store=new QuestStore(ledgerRoot)
  const api=questsAPI(store,{project:{id:'workflow-check',root:ledgerRoot},sessionID:'giver',requestID:'create'},async()=>{throw Error('Persistence check must not dispatch')})
  const quest=api.create({title:'Summarize account costs',description:'Produce a cost summary from saved task measurements',steps:[{id:'summary',title:'Summarize measurements'}],workflow:{readOnly:true,task:'utility',delivery:'none'}})
  const first=requestQuestStart(store,quest.id),again=requestQuestStart(new QuestStore(ledgerRoot),quest.id)
  expect(again).toEqual(first)
  if(!('requestID' in first))throw Error('Expected a new admission')
  expect(first.generation).toBeUndefined()
  expect(startRequests(new QuestStore(ledgerRoot),quest.id)).toHaveLength(1)
  // A recorded Start, bound by the runtime to this continuation, is distinct from assignment text.
  const requestFile=join(store.runtime,'start-requests',first.requestID+'.json')
  const request=JSON.parse(readFileSync(requestFile,'utf8'));request.state='admitting';request.authorization.giverID='giver'
  writeFileSync(requestFile,JSON.stringify(request))
  const continuationFile=runtimeQueuePath(store.runtime,'continuations',undefined,'.json')
  const admitted={id:'continuation',state:'running',questID:quest.id,context:{sessionID:'giver',requestID:first.requestID},runID:'owned-run'}
  writeFileSync(continuationFile,JSON.stringify([admitted]))
  expect(requestQuestStart(store,quest.id).state).toBe('running')
  expect(startRequests(store,quest.id)[0].state).toBe('started')
  expect(questStartAuthorization(store,quest.id,'owned-run','giver')?.action).toBe('Start saved Quest')
  expect(questStartAuthorization(store,quest.id,'other-run','giver')).toBeUndefined()
  expect(questStartAuthorization(store,quest.id,'owned-run','other-giver')).toBeUndefined()
  api.update(quest.id,{workflow:{readOnly:true,task:'review',model:'user-provider/user-model#high',delivery:'quest-pr'}})
  expect(questStartAuthorization(store,quest.id,'owned-run','giver')?.action).toBe('Start saved Quest')
  const saved=new QuestStore(ledgerRoot).read(quest.id)!
  expect(questWorkflow(saved)).toEqual({readOnly:true,task:'review',model:'user-provider/user-model#high',delivery:'quest-pr'})
  expect(deliveryInstructions(saved)).toContain('one pull request')
  api.update(quest.id,{workflow:{delivery:'none'}})
  expect(questWorkflow(new QuestStore(ledgerRoot).read(quest.id)!).model).toBeUndefined()
  store.apply(quest.id,'patched',{description:'Different work requires a new Start'})
  expect(questStartAuthorization(store,quest.id,'owned-run','giver')).toBeUndefined()
  writeFileSync(continuationFile,JSON.stringify([{...admitted,state:'stopped'}]))
  const next=requestQuestStart(store,quest.id)
  expect(next.state).toBe('queued')
  expect('requestID' in next&&next.requestID).not.toBe(first.requestID)
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
