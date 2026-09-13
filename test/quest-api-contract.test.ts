/**
 * @core-prevents a stripped legacy update reporting success without saving any requested change
 * @core-observed September 13 the real giver reported that nested update arguments became a successful no-op through Code Mode; the new methods use flat arguments.
 */
import {test,expect} from 'bun:test'
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import {questOperations} from '../quest/operations.mjs'

test('updates require a real change and reject the old nested envelope',()=>{
 const validate=new AjvJsonSchemaValidator().getValidator(questOperations.update.input)
 expect(validate({id:'quest'}).valid).toBe(false)
 expect(validate({id:'quest',update:{reward:'saved'}}).valid).toBe(false)
 expect(validate({id:'quest',reward:'saved'}).valid).toBe(true)
 expect(validate({id:'quest',workflow:{readOnly:true,task:'review'}}).valid).toBe(true)
})

/** @core-observed September 13 discovery retained dozens of listeners from worker locations while clients could not reach a ready giver. */
test('locations share one authenticated listener and retiring a worker keeps the giver available', async()=>{
 const {mkdtempSync,readdirSync,readFileSync,rmSync}=await import('node:fs')
 const {tmpdir}=await import('node:os')
 const {join}=await import('node:path')
 const {QuestStore}=await import('../quest/store')
 const {serveQuestAPI}=await import('../quest/api-server')
 const {saveUserGiver}=await import('../quest/giver-registry.mjs')
 const {discoverQuestAPI}=await import('../quest/client.mjs')
 const root=mkdtempSync(join(tmpdir(),'quest-api-listener-')),store=new QuestStore(root)
 const calls:any[]=[]
 const service={call:async(method:string,input:any,context:any)=>{calls.push({method,input,context});return {id:input.id}}} as any
 let giver:any,worker:any
 try {
  saveUserGiver(store.runtime,{state:'bound',sessionID:'ses_giver',directory:root})
  ;[giver,worker]=await Promise.all([serveQuestAPI(store,service,root),serveQuestAPI(store,service,root)])
  const registry=join(store.runtime,'quest-api'),records=readdirSync(registry)
  expect(records).toHaveLength(1)
  const record=JSON.parse(readFileSync(join(registry,records[0]),'utf8'))
  expect(record.pid).toBe(process.pid)
  expect(giver.url).toBe(worker.url)
  expect(giver.mcpURL).not.toBe(worker.mcpURL)
  expect((await fetch(giver.url+'/health')).status).toBe(403)
  expect((await fetch(giver.url+'/health',{headers:{authorization:'Bearer '+giver.token,origin:'https://example.com'}})).status).toBe(403)
  expect((await discoverQuestAPI({registry})).url).toBe(giver.url)
  worker.dispose()
  const response=await fetch(giver.url+'/api/status',{method:'POST',headers:{authorization:'Bearer '+giver.token,'idempotency-key':'read-quest'},body:JSON.stringify({id:'quest'})})
  expect(response.status).toBe(200)
  expect(calls[0].context.sessionID).toBe('ses_giver')
  giver.dispose()
  expect(readdirSync(registry)).toHaveLength(0)
 } finally {worker?.dispose();giver?.dispose();rmSync(root,{recursive:true,force:true})}
})
