import {test,expect} from 'bun:test'
import {assertWorkerIdentity} from '../quest/worker-identity'
const run:any={runtime:'native',agentRole:'proxy-sol',providerID:'cliproxyapi',modelID:'gpt-5.6-sol',reasoningEffort:'xhigh'}
const actual={agent:'proxy-sol',model:{providerID:'cliproxyapi',id:'gpt-5.6-sol',variant:'xhigh'}}
test('worker subsequent turns retain exactly the authorized agent, provider, model and reasoning',()=>{
 expect(()=>assertWorkerIdentity(run,actual)).not.toThrow()
 for(const changed of [{...actual,agent:'quest-giver'},{...actual,model:{...actual.model,id:'gpt-5.6-luna'}},{...actual,model:{...actual.model,variant:'medium'}},{...actual,model:{...actual.model,providerID:'openai'}},{}])expect(()=>assertWorkerIdentity(run,changed)).toThrow('No inference was sent')
})
