/**
 * @core-prevents a provider warning inferred without an actual response, or one session's failure being reported against another
 * @core-observed Quota failures were previously inferred rather than observed, producing warnings for accounts that had not answered (2026-09-10).
 */
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


import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {recordNotification,pendingCompletionEvidence} from '../orchestration/orchestration-ledger'
import {deliverPendingCompletion} from '../orchestration/orchestration'

test('unreachable parent preserves a durable return until confirmed delivery',async()=>{
 const file=join(mkdtempSync(join(tmpdir(),'opencode-return-')),'ledger.jsonl')
 recordNotification('ses_parent','call_worker','ses_child','completed','Finished',file)
 const completion=pendingCompletionEvidence('ses_parent',file)[0]
 let deliveries=0
 await expect(deliverPendingCompletion({get:async()=>{throw new Error('fetch failed')},synthetic:async()=>{deliveries++}},completion,file)).rejects.toThrow('fetch failed')
 expect(pendingCompletionEvidence('ses_parent',file)).toHaveLength(1)
 expect(deliveries).toBe(0)
 const host={get:async()=>({id:'ses_parent'}),synthetic:async()=>{deliveries++}}
 expect(await deliverPendingCompletion(host,completion,file)).toBe(true)
 expect(await deliverPendingCompletion(host,completion,file)).toBe(true)
 expect(deliveries).toBe(1)
 expect(pendingCompletionEvidence('ses_parent',file)).toHaveLength(0)
})
