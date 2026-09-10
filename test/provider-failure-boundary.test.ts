import {test,expect} from 'bun:test'
import {installProviderFailureObservation} from '../models/server'
import {detectProviderFailure} from '../usage/usage-reached'
test('provider warnings require actual responses and remain scoped to their session',async()=>{
 const hooks:Record<string,Function>={}
 await installProviderFailureObservation({session:{hook:async(name:string,callback:Function)=>{hooks[name]=callback}}})
 const request={sessionID:'worker-a',model:{providerID:'openai',id:'assigned'}}
 hooks['http.response']({...request,response:new Response('',{status:429})})
 const other={sessionID:'worker-b',system:[]};hooks.context(other);expect(other.system).toHaveLength(0)
 const own={sessionID:'worker-a',system:[]};hooks.context(own);expect(own.system).toHaveLength(1);expect(JSON.stringify(own.system)).toContain('rate limited')
 hooks['http.response']({...request,response:new Response('',{status:403})});hooks['http.response']({...request,response:new Response('',{status:200})})
 const recovered={sessionID:'worker-a',system:[]};hooks.context(recovered);expect(recovered.system).toHaveLength(0)
 expect(detectProviderFailure('HTTP 429 Too Many Requests')?.kind).toBe('provider')
 expect(detectProviderFailure('HTTP 403 Forbidden')?.kind).toBe('provider')
 expect(detectProviderFailure('insufficient quota')?.kind).toBe('usage')
})
