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

/** @core-observed September 13 the fresh host timed out discovery while synchronous workspace preparation admitted a real coding worker. */
test('workspace installation leaves the actual API listener responsive',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync}=await import('node:fs')
 const {spawnSync}=await import('node:child_process')
 const {tmpdir}=await import('node:os')
 const {join}=await import('node:path')
 const {QuestStore}=await import('../quest/store')
 const {allocateWorkspace}=await import('../quest/workspace-allocation')
 const {serveQuestAPI}=await import('../quest/api-server')
 const {saveUserGiver}=await import('../quest/giver-registry.mjs')
 const {discoverQuestAPI}=await import('../quest/client.mjs')
 const root=mkdtempSync(join(tmpdir(),'quest-responsive-')),repo=join(root,'repo'),store=new QuestStore(join(root,'board'))
 mkdirSync(repo);writeFileSync(join(repo,'README.md'),'owned fixture')
 const git=(args:string[])=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr)}
 git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture'])
 let endpoint:any,preparation:Promise<any>|undefined
 try{
  saveUserGiver(store.runtime,{state:'bound',sessionID:'ses_giver',directory:repo})
  endpoint=await serveQuestAPI(store,{call:async()=>({})} as any,repo)
  const marker=join(root,'install-started')
  let complete=false
  preparation=allocateWorkspace({runtime:store.runtime,projectRoot:store.projectRoot,mode:'worktree',input:{runID:'responsive',questID:'fixture',directory:repo,bootstrap:['bun','-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1800)`]}}).finally(()=>{complete=true})
  while(!existsSync(marker)&&!complete)await new Promise(resolve=>setTimeout(resolve,10))
  expect(complete).toBe(false)
  expect((await discoverQuestAPI({registry:join(store.runtime,'quest-api'),signal:AbortSignal.timeout(1000)})).url).toBe(endpoint.url)
  expect(complete).toBe(false)
  expect((await preparation).bootstrapComplete).toBe(true)
 }finally{await preparation?.catch(()=>{});endpoint?.dispose();rmSync(root,{recursive:true,force:true})}
},20000)
