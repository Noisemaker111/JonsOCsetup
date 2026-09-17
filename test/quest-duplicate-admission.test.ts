/**
 * @core-prevents a failed dispatch spawning a second Quest for the same request, and a refusal deadlocking the Quest it points at
 * @core-observed One request produced four near-duplicate Quests because requestFingerprint was written and never read back (2026-09-10, PR40).
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {QuestStore} from '../quest/store'
import {questsAPI} from '../quest/api'
import {readAllQuests} from '../quest/index'
import {reconcileWorkers} from '../quest/worker-inspection'
import {observeGiverInstruction} from '../quest/giver-instruction'

// Real directories, because dispatch now refuses a Quest whose recorded project folder is gone: a
// fabricated root is the very condition that stranded 92 records on 2026-09-17.
const projects=new Map<string,string>()
const projectRoot=(projectID:string)=>{let root=projects.get(projectID);if(!root){root=realpathSync.native(mkdtempSync(join(tmpdir(),'quest-admission-'+projectID+'-')));projects.set(projectID,root)}return root}
const context=(requestID:string,projectID='project-a'):any=>({project:{id:projectID,root:projectRoot(projectID)},sessionID:'ses_giver',requestID})
const started=async()=>({sessionID:'ses_worker'})
const request={title:'Missing provider credential must surface a TUI error, not silently drop the prompt',description:'A missing provider credential must show a TUI error instead of dropping the prompt.',steps:[{title:'Drive the TUI without a credential'}]}
const code=(call:()=>unknown)=>{try{call()}catch(error){return (error as any).code}return 'no error'}

/** @core-observed One native giver instruction created the same title in two projects; the unfinished repair required a messageID the installed MCP transport never sends. */
test('native MCP keeps one title per delivered instruction across destinations, tool rounds and compaction; public creation remains usable',async()=>{
 const {createQuestService}=await import('../quest/service')
 const {serveQuestAPI}=await import('../quest/api-server')
 const {createQuestClient}=await import('../quest/client.mjs')
 const {selectUserGiverProject}=await import('../quest/user-giver')
 const root=realpathSync.native(mkdtempSync(join(tmpdir(),'quest-instruction-'))),a=join(root,'a'),b=join(root,'b')
 mkdirSync(a);mkdirSync(b)
 const store=new QuestStore(join(root,'ledger')),sessionID='ses_giver'
 let messages:any[]=[{id:'msg_human',type:'user',time:{created:10}},{id:'msg_response1',type:'assistant',time:{created:20}}],dispose=()=>{},endpoint:any
 const host={get:async()=>({id:sessionID,agent:'quest-giver',location:{directory:a}}),context:async()=>({data:messages})} as any
 const service=createQuestService(store,host,{directory:a,onDispose:fn=>{dispose=fn},startRun:started})
 try{
  endpoint=await serveQuestAPI(store,service,a)
  let sequence=0
  const create=async(title:string,description:string)=>{
   const response=await fetch(endpoint.mcpURL,{method:'POST',headers:{authorization:'Bearer '+endpoint.token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name:'create',arguments:{title,description,steps:[{id:'verify',title:'Verify the saved result'}],workflow:{readOnly:true,delivery:'none'}},_meta:{sessionID}}})})
   expect(response.status).toBe(200)
   const result=(await response.json() as any).result
   return result.isError?JSON.parse(result.content[0].text):result.structuredContent
  }
  const first=await create('Review the release','Inspect the release notes')
  expect(first.id).toBeString()
  selectUserGiverProject(store,sessionID,[{directory:b}],1)
  messages.push({id:'msg_response2',type:'assistant',time:{created:30}})
  expect((await create('Review the release','Inspect the package compatibility')).code).toBe('DUPLICATE_QUEST_TITLE')
  // The real event path records delivered identities before model context can be compacted.
  const event=(type:string,id:string,created:number,item?:any)=>observeGiverInstruction(store.runtime,{type,created,data:{sessionID,inboxID:id,item}})
  event('session.inbox.enqueued','msg_human',5,{type:'user',payload:{text:'content is not stored'}})
  event('session.inbox.delivered','msg_human',10)
  event('session.inbox.enqueued','msg_notice',31,{type:'user',payload:{metadata:{questWorkerReturn:true}}})
  event('session.inbox.delivered','msg_notice',32)
  event('session.inbox.enqueued','msg_queued_human',33,{type:'user',payload:{}})
  messages=[{type:'compaction',time:{created:34}},{id:'msg_response3',type:'assistant',time:{created:35}}]
  expect((await create('Review the release','Inspect a different implementation')).code).toBe('DUPLICATE_QUEST_TITLE')
  // Delivery, not enqueue, establishes the next instruction; reconnecting reads the saved identity.
  event('session.inbox.delivered','msg_queued_human',40)
  messages=[{type:'compaction',time:{created:41}},{id:'msg_response4',type:'assistant',time:{created:42}}]
  const next=await create('Review the release','Check an unrelated deployment')
  expect(next.id).toBeString();expect(next.id).not.toBe(first.id)
  const client=createQuestClient({endpoint})
  const external=await client.create({title:'Inspect editor shortcuts',description:'Check character deletion behavior',steps:[{id:'verify',title:'Verify deletion behavior'}],workflow:{readOnly:true,delivery:'none'}})
  expect((await client.get({id:external.id})).id).toBe(external.id)
  expect(new QuestStore(store.projectRoot).read(next.id)!.extensions.giverTurnID).toBe('msg_queued_human')
  expect(readAllQuests(store.projectRoot).length).toBe(3)
 }finally{dispose();endpoint?.dispose();rmSync(root,{recursive:true,force:true})}
},15000)

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

test('a lost creation response stays protected until dispatch evidence proves whether work started',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-dispatch-'))
 try{
  const store=new QuestStore(root)
  const quest=questsAPI(store,context('call-1'),started).create({title:'Append a marker line',description:'Append one marker line to a scratch file.',steps:[{title:'Append the marker'}]})
  const transportFailure=async()=>{throw new Error('transport reset before the host answered')}
  await expect(questsAPI(store,context('call-2'),transportFailure as any).run(quest.id)).rejects.toThrow('call action=run on Quest '+quest.id)
  expect(store.read(quest.id)!.sessions.at(-1)!.state).toBe('planned')
  // Missing response identity is uncertainty, not evidence of a failed creation.
  await expect(questsAPI(store,context('call-3'),started).run(quest.id)).rejects.toThrow('already has an active run')
  await reconcileWorkers(store,{get:async()=>undefined})
  expect(store.read(quest.id)!.sessions.at(-1)!.state).toBe('planned')
  await expect(questsAPI(store,context('call-4'),started).run(quest.id)).rejects.toThrow('already has an active run')
  expect(readAllQuests(root).length).toBe(1)
  // A recovered Markdown snapshot can lag its journal (including the created event).
  // It must not poison reconciliation, and thereby every later native dispatch.
  const recovered=store.create({id:'00000000000000000000000001',title:'Recovered terminal worker',objective:'Retain the failed attempt',stages:[{id:'check',title:'Check',status:'working',needs:[]}],sessions:[{callID:'old',runID:'old',state:'failed',deliverables:['check'],evidence:['Confirmed failed'],result:'Confirmed failed',attempt:1,updatedAt:new Date().toISOString()} as any]})
  expect(readAllQuests(root).find(row=>row.quest?.id===recovered.id)!.quest!.revision).toBeLessThan(store.read(recovered.id)!.revision)
  await reconcileWorkers(store,{get:async()=>undefined})
  expect(store.read(recovered.id)!.stages[0].status).toBe('pending')
 }finally{rmSync(root,{recursive:true,force:true})}
})
