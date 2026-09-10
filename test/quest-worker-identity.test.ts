import {test,expect} from 'bun:test'
import {assertWorkerIdentity} from '../quest/worker-identity'
const run:any={runtime:'native',agentRole:'proxy-sol',providerID:'cliproxyapi',modelID:'gpt-5.6-sol',reasoningEffort:'xhigh'}
const actual={agent:'proxy-sol',model:{providerID:'cliproxyapi',id:'gpt-5.6-sol',variant:'xhigh'}}
test('worker subsequent turns retain exactly the authorized agent, provider, model and reasoning',()=>{
 expect(()=>assertWorkerIdentity(run,actual)).not.toThrow()
 for(const changed of [{...actual,agent:'quest-giver'},{...actual,model:{...actual.model,id:'gpt-5.6-luna'}},{...actual,model:{...actual.model,variant:'medium'}},{...actual,model:{...actual.model,providerID:'openai'}},{}])expect(()=>assertWorkerIdentity(run,changed)).toThrow('No inference was sent')
})

import {connectHostObservation,disconnectHostObservation,recordHostObservation,hostExecution,hostPermissions} from '../quest/host-observation'
import {filterQuests} from '../quest/tui-model'

test('live worker evidence and permissions never cross host clients',async()=>{
 const first={},second={}
 connectHostObservation(first,{list:async()=>[{action:'read'}]});connectHostObservation(second)
 recordHostObservation(first,{type:'session.status',data:{sessionID:'worker',status:{type:'running'}}})
 expect(hostExecution(first,'worker')).toBe(true)
 expect(hostExecution(second,'worker')).toBeUndefined()
 expect(await hostPermissions(second,'worker')).toEqual([])
 disconnectHostObservation(second)
 expect(hostExecution(first,'worker')).toBe(true)
 disconnectHostObservation(first)
 expect(hostExecution(first,'worker')).toBeUndefined()
 connectHostObservation(first)
 expect(hostExecution(first,'worker')).toBeUndefined()
})

test('saved execution state cannot make a Quest active without host evidence',()=>{
 const quest:any={state:'Working',sessions:[{callID:'call',state:'executing'}]}
 expect(filterQuests([quest],'active')).toHaveLength(0)
 expect(filterQuests([quest],'active',()=>({state:'running'}))).toHaveLength(1)
 for(const state of ['unknown','unreachable','blocked','completed'])expect(filterQuests([quest],'active',()=>({state}))).toHaveLength(0)
})

import {enforceSessionModelChange} from '../models/session-lifecycle'
test('host model change guard preserves an executing worker pin',()=>{
 const event={sessionModel:'cliproxyapi/gpt-5.6-sol',sessionVariant:'xhigh',workerStarted:true,input:{model:'cliproxyapi/gpt-5.6-sol',variant:'xhigh'}}
 expect(()=>enforceSessionModelChange(event)).not.toThrow()
 expect(()=>enforceSessionModelChange({...event,input:{...event.input,model:'openai/gpt-6-astra'}})).toThrow('immutable')
 expect(()=>enforceSessionModelChange({...event,input:{...event.input,variant:'medium'}})).toThrow('immutable')
})
