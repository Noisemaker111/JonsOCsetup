/**
 * @core-prevents a stripped legacy update reporting success without saving any requested change
 * @core-observed September 13 the real giver reported that nested update arguments became a successful no-op through Code Mode; the new methods use flat arguments.
 */
import {test,expect} from 'bun:test'
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import {questOperations} from '../quest/operations.mjs'
import {realpathSync} from 'node:fs'

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
 const root=realpathSync.native(mkdtempSync(join(tmpdir(),'quest-api-listener-'))),store=new QuestStore(root)
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
 const root=realpathSync.native(mkdtempSync(join(tmpdir(),'quest-responsive-'))),repo=join(root,'repo'),store=new QuestStore(join(root,'board'))
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
/** @core-observed September 13 native oc completed both workers, then discovery timed out while synchronous retirement inspected twelve retained workspaces (5.7 seconds in a read-only replay). */
test('retirement leaves discovery responsive and preserves a Quest reopened during Git inspection',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync,readFileSync}=await import('node:fs')
 const {spawnSync}=await import('node:child_process')
 const {tmpdir}=await import('node:os')
 const {join}=await import('node:path')
 const {QuestStore}=await import('../quest/store')
 const {QuestWorkspaces}=await import('../quest/workspaces')
 const {retireWorkspace}=await import('../quest/workspace-retirement')
 const {serveQuestAPI}=await import('../quest/api-server')
 const {saveUserGiver}=await import('../quest/giver-registry.mjs')
 const {discoverQuestAPI}=await import('../quest/client.mjs')
 const root=realpathSync.native(mkdtempSync(join(tmpdir(),'quest-retirement-responsive-'))),repo=join(root,'repo'),store=new QuestStore(join(root,'board'))
 mkdirSync(repo);writeFileSync(join(repo,'README.md'),'owned fixture')
 const git=(args:string[])=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr)}
 git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture'])
 const q=store.create({id:'a'.repeat(26),title:'Preserve reopened work',objective:'Retirement must recheck the saved Quest'})
 const workspace=new QuestWorkspaces(store.runtime).create({runID:'retirement',questID:q.id,directory:repo})
 let endpoint:any,retirement:Promise<any>|undefined
 try{
  const marker=join(root,'git-inspection-started'),hook=join(root,'fsmonitor.cjs')
  writeFileSync(hook,`const fs=require('node:fs');if(!fs.existsSync(${JSON.stringify(marker)})){fs.writeFileSync(${JSON.stringify(marker)},'started');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1800)}process.stdout.write('token\\0/\\0')`)
  git(['config','core.fsmonitor',`node "${hook.replaceAll('\\','/')}"`])
  saveUserGiver(store.runtime,{state:'bound',sessionID:'ses_giver',directory:repo})
  endpoint=await serveQuestAPI(store,{call:async()=>({})} as any,repo)
  store.apply(q.id,'archive',{reason:'Retirement regression fixture'},'test')
  let complete=false
  retirement=retireWorkspace({runtime:store.runtime,projectRoot:store.projectRoot,questID:q.id,runID:workspace.runID}).finally(()=>{complete=true})
  while(!existsSync(marker)&&!complete)await new Promise(resolve=>setTimeout(resolve,10))
  expect(existsSync(marker)).toBe(true);expect(complete).toBe(false)
  store.apply(q.id,'reopen',{reason:'User reopened during inspection'},'test')
  expect((await discoverQuestAPI({registry:join(store.runtime,'quest-api'),signal:AbortSignal.timeout(1000)})).url).toBe(endpoint.url)
  expect(complete).toBe(false)
  const result=await retirement
  expect(result.removed).toBe(false);expect(result.reason).toContain('Quest reopened')
  expect(readFileSync(join(workspace.path,'README.md'),'utf8')).toBe('owned fixture')
  const artifact=join(workspace.path,'result.txt');writeFileSync(artifact,'durable result')
  store.apply(q.id,'patched',{evidence:{...store.read(q.id)!.evidence,artifacts:[{name:'Saved result',path:artifact,verified:true}]}},'test')
  store.apply(q.id,'archive',{reason:'User accepted the saved result'},'test')
  git(['config','quest.integrationRef','HEAD'])
  const retired=await retireWorkspace({runtime:store.runtime,projectRoot:store.projectRoot,questID:q.id,runID:workspace.runID})
  expect(retired.removed).toBe(true);expect(existsSync(workspace.path)).toBe(false)
  expect(readFileSync(store.read(q.id)!.evidence.artifacts[0].path!,'utf8')).toBe('durable result')
 }finally{await retirement?.catch(()=>{});endpoint?.dispose();rmSync(root,{recursive:true,force:true})}
},20000)
