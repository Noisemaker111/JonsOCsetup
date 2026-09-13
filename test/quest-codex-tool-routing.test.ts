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
test('flat MCP operations use host session metadata and persist a create/update/get round trip',async()=>{
 const {root,cwd,store}=fixture()
 try{
  const session_id='native-host-thread'
  codexHook({session_id,cwd,hook_event_name:'SessionStart'},store)
  const dispatch=questMCP({store})
  const listed=await dispatch({id:1,method:'tools/list'})
  expect(listed.result.tools.map((t:any)=>t.name)).toEqual(['list','get','create','update','inspect'])
  expect(JSON.stringify(listed)).not.toContain('_questTicket')
  const invoke=async(name:string,args:any,meta:any={threadId:session_id})=>{
   expect(codexHook({session_id,cwd,hook_event_name:'PreToolUse',tool_name:'mcp__quest__'+name,tool_input:args},store)).toEqual({})
   const r=await dispatch({id:crypto.randomUUID(),method:'tools/call',params:{name,arguments:args,_meta:meta}})
   return {error:r.result.isError,value:JSON.parse(r.result.content[0].text)}
  }
  expect((await invoke('list',{},{})).error).toBe(true)
  expect((await invoke('create',{create:{title:'wrong'}})).error).toBe(true)
  const created=await invoke('create',{title:'Recover tool access',description:'Use direct typed operations.',steps:[{id:'verify',title:'Reopen saved progress'}]})
  expect(created.error).toBeUndefined()
  expect((await invoke('update',{id:created.value.id,description:'Saved and reopened.'})).error).toBeUndefined()
  expect(new QuestStore(store.projectRoot).read(created.value.id)?.description).toBe('Saved and reopened.')
  expect((await invoke('get',{id:created.value.id})).value.title).toBe('Recover tool access')
 }finally{rmSync(root,{recursive:true,force:true})}
})
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
