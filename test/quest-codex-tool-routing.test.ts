/**
 * @core-prevents documentation calls inheriting checkout locks, Quest arguments exposing host tickets, and non-Git project reads waiting on Git
 * @core-observed September 13 Codex transcripts contained five blocked docs searches; the Quest MCP list failed Git identity after 15000 ms and advertised quest.quest with a nested create payload.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,rmSync,readdirSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {QuestStore} from '../quest/store'
import {projectIdentity} from '../quest/project'
import {codexHook} from '../quest/codex/runtime'
import {checkoutIndependent,hasCheckout} from '../quest/codex/recovery-workspace'
import {questMCP} from '../quest/mcp-server'

const fixture=()=>{const root=realpathSync.native(mkdtempSync(join(tmpdir(),'quest-host-')));const cwd=join(root,'project');mkdirSync(cwd);return {root,cwd,store:new QuestStore(join(root,'ledger'))}}
/** @core-observed The September 13 fresh hub session's named MCP tools returned NOT_FOUND for a Quest that the managed oc board and installed CLI could read. */
test('Codex MCP discovers the CLI contract and reopens the same persisted API record',async()=>{
 const {createQuestService}=await import('../quest/service')
 const {serveQuestAPI}=await import('../quest/api-server')
 const {createQuestClient}=await import('../quest/client.mjs')
 const {questOperations}=await import('../quest/operations.mjs')
 const {root,cwd,store}=fixture()
 const host={get:async({sessionID}:any)=>({id:sessionID,agent:'quest-giver',location:{directory:cwd}})} as any
 let dispose=()=>{},endpoint:any
 const service=createQuestService(store,host,{directory:cwd,onDispose:fn=>{dispose=fn},startRun:async()=>{throw Error('No dispatch')}})
 try{
  const created=await service.call('create',{title:'Recover shared access',description:'Reopen on the same board',steps:[{id:'verify',title:'Verify saved progress'}],workflow:{readOnly:true,delivery:'none'}},{sessionID:'ses_giver',id:'create'})
  endpoint=await serveQuestAPI(store,service,cwd)
  const client=createQuestClient({endpoint}),sessionStore=new QuestStore(join(root,'hook-journal')),dispatch=questMCP({client,sessionStore})
  codexHook({session_id:'fixture-thread',cwd,hook_event_name:'SessionStart'},sessionStore)
  const denied=await dispatch({id:'no-context',method:'tools/call',params:{name:'get',arguments:{id:created.id}}})
  expect(denied.result.isError).toBe(true)
  expect(denied.result.content[0].text).toContain('HOOK_REQUIRED')
  const listed=await dispatch({id:1,method:'tools/list'})
  expect(listed.result.tools.map((t:any)=>t.name)).toEqual(Object.keys(questOperations))
  for(const tool of listed.result.tools)expect(tool.inputSchema).toEqual(questOperations[tool.name].input)
  const invoke=async(name:string,args:any)=>{
   const r=await dispatch({id:crypto.randomUUID(),method:'tools/call',params:{name,arguments:args,_meta:{threadId:'fixture-thread'}}})
   if(r.result.isError)throw Error(r.result.content[0].text)
   return r.result.structuredContent
  }
  expect((await invoke('get',{id:created.id})).title).toBe('Recover shared access')
  await invoke('report',{id:created.id,stepID:'verify',state:'done',note:'Saved through the Codex API transport'})
  expect((await client.get({id:created.id})).progress.done).toBe(1)
  expect((await invoke('plan',{id:created.id})).id).toBe(created.id)
  expect(new QuestStore(store.projectRoot).read(created.id)?.stages[0].note).toBe('Saved through the Codex API transport')
 }finally{dispose();endpoint?.dispose();rmSync(root,{recursive:true,force:true})}
},10000)
test('documentation is independent while arbitrary persistent JavaScript still requires a binding',()=>{
 for(const name of ['search_docs','list_libraries','refresh_version'])expect(checkoutIndependent('mcp__docs__'+name,{})).toBe(true)
 expect(checkoutIndependent('mcp__node_repl__js',{code:'writeFileSync(...)'})).toBe(false)
 expect(checkoutIndependent('mcp__cua_repl__js',{code:'await cua.getState();'})).toBe(true)
 expect(checkoutIndependent('mcp__cua_repl__js',{code:'await cua.getState(); require("fs").writeFileSync("x", "x")'})).toBe(false)
})
test('non-Git project identity does not require Git to be executable',()=>{
 const {root,cwd}=fixture(),path=process.env.PATH
 try{process.env.PATH='';expect(projectIdentity(cwd).root).toBe(cwd);expect(hasCheckout(cwd)).toBe(false)}
 finally{process.env.PATH=path;rmSync(root,{recursive:true,force:true})}
})
test('a persistent-tool conflict prepares a worktree and reports its path without releasing the owner',()=>{
 const {root,cwd,store}=fixture()
 try{
  const git=(...args:string[])=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
  git('init');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','initial')
  const hook=(session_id:string,tool_name:string,tool_input:any)=>codexHook({session_id,cwd,hook_event_name:'PreToolUse',tool_name,tool_input},store,{aliases:{},needsEnvironment:false})
  hook('owner','Bash',{command:'git status'})
  expect(hook('second','mcp__docs__search_docs',{library:'x',query:'y'})).toEqual({})
  const result=hook('second','mcp__node_repl__js',{code:'1'})
  expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
  const workspace=join(cwd,'.worktrees',readdirSync(join(cwd,'.worktrees'))[0])
  expect(result.hookSpecificOutput.permissionDecisionReason).toContain(workspace)
  expect(projectIdentity(workspace).id).toBe(projectIdentity(cwd).id)
  expect(hook('owner','Bash',{command:'git status'})).toEqual({})
 }finally{rmSync(root,{recursive:true,force:true})}
})

/** @core-observed After preparation failed in the real hub chat, relative Get-Content of the failure receipt triggered preparation again; read-only transcript lookup was rewritten into a mutating ticket. */
test('literal diagnostic reads never become dependency preparation tickets',()=>{
 const {root,cwd,store}=fixture()
 try{
  const git=(...args:string[])=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr)}
  git('init');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','initial')
  const hook=(session_id:string,tool_input:any)=>codexHook({session_id,cwd,hook_event_name:'PreToolUse',tool_name:'Bash',tool_input},store,{aliases:{},needsEnvironment:false})
  hook('owner',{command:'git status'})
  // Force this session's recovery through the supported persistent-tool conflict.
  codexHook({session_id:'second',cwd,hook_event_name:'PreToolUse',tool_name:'mcp__node_repl__js',tool_input:{code:'1'}},store,{aliases:{},needsEnvironment:false})
  for(const command of ['Get-Content .quest-environment-failed.json','Get-Content MEMORY.md; Get-Content .openeval-tools/resume-comparison.md',"Get-ChildItem -LiteralPath C:/Users/Jk101/.codex/sessions/2026/09/13 -Filter '*session*'",'rg -n cached quest/codex']){
   expect(checkoutIndependent('Bash',{command})).toBe(true)
   expect(hook('second',{command}).hookSpecificOutput?.updatedInput?.command??command).toBe(command)
  }
  for(const command of ['Get-Content x | Set-Content y','Get-Content $(Remove-Item x)','rg --pre evil x','Get-Content x; Remove-Item y','Get-Content x > out','& Get-Content x','Get-Content x\nRemove-Item y'])expect(checkoutIndependent('Bash',{command})).toBe(false)
 }finally{rmSync(root,{recursive:true,force:true})}
})

/** @core-observed Recovery tried copying @msgpackr-extract/msgpackr-extract-darwin-arm64 on Windows before Bun could select platform dependencies. */
test('private preparation respects locked platform constraints',async()=>{
 const {lockedPackageApplies}=await import('../quest/codex/recovery-command')
 expect(lockedPackageApplies(['native@1.0.0','',{os:'darwin',cpu:'arm64'}],'win32','x64')).toBe(false)
 expect(lockedPackageApplies(['native@1.0.0','',{os:'win32',cpu:'x64'}],'win32','x64')).toBe(true)
 expect(lockedPackageApplies(['portable@1.0.0','',{}],'win32','x64')).toBe(true)
 expect(lockedPackageApplies(['native@1.0.0','',{os:['!win32']}],'win32','x64')).toBe(false)
})

/** @core-observed Full repository preparation found the cached effect prerelease under Bun's hashed suffix; failed preflight receipts then prevented every retry. */
test('hashed cache lookup retries a known failed preflight and preserves its evidence',async()=>{
 const {prepareRecoveredEnvironment}=await import('../quest/codex/recovery-command')
 const {writeFileSync,readFileSync,existsSync}=await import('node:fs')
 const {root,cwd}=fixture(),cache=join(root,'cache'),receipt=join(cwd,'preparation.json')
 mkdirSync(cache)
 const dependencies={'fixture-package':'1.0.0-beta.1'}
 writeFileSync(join(cwd,'package.json'),JSON.stringify({name:'fixture',dependencies}))
 writeFileSync(join(cwd,'bun.lock'),JSON.stringify({workspaces:{'':{dependencies}},packages:{'fixture-package':['fixture-package@1.0.0-beta.1','',{},'sha512-'+Buffer.alloc(64).toString('base64')]}}))
 let executions=0
 const execute=async()=>{executions++;mkdirSync(join(cwd,'node_modules'));return {exitCode:0,stdout:'',stderr:''}}
 try{
  await expect(prepareRecoveredEnvironment(cwd,receipt,execute,cache)).rejects.toThrow('missing exact locked package')
  expect(executions).toBe(0)
  const slot=join(cache,'fixture-package@1.0.0-012345abcdef@@@1');mkdirSync(slot)
  writeFileSync(join(slot,'package.json'),JSON.stringify({name:'fixture-package',version:'1.0.0-beta.1'}))
  const prepared=await prepareRecoveredEnvironment(cwd,receipt,execute,cache)
  expect(prepared.state).toBe('ready')
  expect(executions).toBe(1)
  expect(readdirSync(cwd).some(n=>n.startsWith('preparation.json.failed-'))).toBe(true)
  expect(existsSync(join(prepared.cache.directory,'fixture-package@1.0.0-012345abcdef@@@1','package.json'))).toBe(true)
  await prepareRecoveredEnvironment(cwd,receipt,execute,cache)
  expect(executions).toBe(1)
 }finally{rmSync(root,{recursive:true,force:true})}
})

/** @core-observed AppforGutters Quest preparation blocked twice on inputs Bun never fetches: first @appforgutters/backend@workspace:packages/backend, then @emnapi/core@1.11.0, a bundled dependency of the cpu:"none" @tailwindcss/oxide-wasm32-wasi. */
test('private preparation demands no cache slot for inputs Bun never fetches',async()=>{
 const {lockedPackageNeedsCache,prepareRecoveredEnvironment}=await import('../quest/codex/recovery-command')
 const {writeFileSync}=await import('node:fs')
 const integrity='sha512-'+Buffer.alloc(64).toString('base64')
 const member=['@fixture/backend@workspace:packages/backend']
 const wasm=['@tailwindcss/oxide-wasm32-wasi@4.3.0','',{cpu:'none',dependencies:{'@emnapi/core':'^1.10.0'}},integrity]
 const bundled=['@emnapi/core@1.11.0','',{bundled:true},integrity]
 const nativeOnly=['native-only@1.0.0','',{os:'darwin',cpu:'arm64'},integrity]
 const nativeChild=['native-child@1.0.0','',{},integrity]
 const plain=['plain-package@1.0.0','',{},integrity]
 const locked:Record<string,any>={'@fixture/backend':member,'@tailwindcss/oxide-wasm32-wasi':wasm,'@tailwindcss/oxide-wasm32-wasi/@emnapi/core':bundled,'native-only':nativeOnly,'native-only/native-child':nativeChild,'plain-package':plain}
 const needs=(key:string,entry:any)=>lockedPackageNeedsCache(locked,key,entry,'win32','x64')
 expect(needs('plain-package',plain)).toBe(true)
 expect(needs('@fixture/backend',member)).toBe(false)
 expect(needs('@tailwindcss/oxide-wasm32-wasi',wasm)).toBe(false)
 expect(needs('@tailwindcss/oxide-wasm32-wasi/@emnapi/core',bundled)).toBe(false)
 expect(needs('native-only/native-child',nativeChild)).toBe(false)
 const {root,cwd}=fixture(),cache=join(root,'cache'),receipt=join(cwd,'preparation.json')
 mkdirSync(cache);mkdirSync(join(cwd,'packages','backend'),{recursive:true})
 const dependencies={'plain-package':'1.0.0'}
 writeFileSync(join(cwd,'packages','backend','package.json'),JSON.stringify({name:'@fixture/backend',dependencies}))
 writeFileSync(join(cwd,'package.json'),JSON.stringify({name:'fixture',workspaces:['packages/backend'],dependencies}))
 writeFileSync(join(cwd,'bun.lock'),JSON.stringify({workspaces:{'':{name:'fixture',dependencies},'packages/backend':{name:'@fixture/backend',dependencies}},packages:locked}))
 const slot=join(cache,'plain-package@1.0.0@@@1');mkdirSync(slot)
 writeFileSync(join(slot,'package.json'),JSON.stringify({name:'plain-package',version:'1.0.0'}))
 let executions=0
 const execute=async()=>{executions++;mkdirSync(join(cwd,'node_modules'));return {exitCode:0,stdout:'',stderr:''}}
 try{
  const prepared=await prepareRecoveredEnvironment(cwd,receipt,execute,cache)
  expect(prepared.state).toBe('ready')
  expect(executions).toBe(1)
  expect(prepared.cache.packages).toEqual(['plain-package@1.0.0'])
 }finally{rmSync(root,{recursive:true,force:true})}
})
