/**
 * @core-prevents a mistaken configured command remaining hidden and impossible for the giver to clear on the existing Quest
 * @core-observed September 15 native Luna created commandID="none" for read-only verification; two dispatches failed, and omitting the field in update silently retained the binding.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import {QuestStore} from '../quest/store'
import {questsAPI} from '../quest/api'
import {toolDetail,toolPlan} from '../quest/tool-projection'
import {questOperations} from '../quest/operations.mjs'

test('the giver can see and clear a failed command after reload without rewriting history or an active assignment',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-command-correction-'))
 try{
  const context={project:{id:'command-correction',root},sessionID:'giver',requestID:'create'}
  const api=()=>questsAPI(new QuestStore(root),context,async()=>{throw Error('No dispatch in this persistence check')})
  const q=api().create({title:'Measure native accounting counters',description:'Read the existing counters and retain measured results',steps:[{id:'measure',title:'Read counters',commandID:'none'}]})
  const store=new QuestStore(root)
  store.apply(q.id,'session-planned',{callID:'failed-command',runID:'failed-command',role:'worker',deliverables:['measure']},'fixture')
  store.apply(q.id,'session-state',{callID:'failed-command',state:'failed',result:'Read-only research cannot execute configured commands'},'fixture')
  const before=new QuestStore(root).read(q.id)!
  expect(toolDetail(before).steps[0].commandID).toBe('none')
  expect(toolPlan(before).steps[0].commandID).toBe('none')
  api().update(q.id,{steps:[{id:'measure',state:'pending'}]})
  expect(new QuestStore(root).read(q.id)!.stages[0].commandID).toBe('none')
  const correction={id:q.id,steps:[{id:'measure',state:'pending',commandID:null}]}
  expect(new AjvJsonSchemaValidator().getValidator(questOperations.update.input)(correction).valid).toBe(true)
  api().update(q.id,{steps:[{id:'measure',state:'pending',commandID:null}]})
  const cleared=new QuestStore(root).read(q.id)!
  expect(cleared.stages[0].commandID).toBeUndefined()
  expect(cleared.sessions).toEqual(before.sessions)
  expect(()=>api().update(q.id,{steps:[{id:'measure',state:'pending',commandID:''}]})).toThrow('nonempty text')
  api().update(q.id,{steps:[{id:'measure',state:'pending',commandID:'configured-check'}]})
  store.apply(q.id,'session-planned',{callID:'active',runID:'active',role:'worker',deliverables:['measure']},'fixture')
  expect(()=>api().update(q.id,{steps:[{id:'measure',state:'pending',commandID:null}]})).toThrow('active or unconfirmed run')
  const active=new QuestStore(root).read(q.id)!
  expect(active.stages[0].commandID).toBe('configured-check')
  expect(active.sessions.find(s=>s.callID==='active')?.state).toBe('planned')
 }finally{rmSync(root,{recursive:true,force:true})}
})
