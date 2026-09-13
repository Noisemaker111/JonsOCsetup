/**
 * @core-prevents a hub source remap from rejecting this session's preserved recovery receipt, adopting a foreign or malformed one, or preparing a second worktree beside a valid owned one
 * @core-observed On 2026-09-13 the preserved receipt af61cb2a9a3ed5d820a07a3f (Codex session 01a09bcc-06ae-7451-82c3-0f8ac3091687) held a blocked preparation for the historical .config/opencode checkout; after the hub mapped to JonsOCsetup every blocked tool call failed with "Worktree recovery receipt does not match this session; preserving it".
 */
import {test,expect} from 'bun:test'
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {QuestStore} from '../quest/store'
import {codexHook} from '../quest/codex/runtime'
import {recoverWorkspace} from '../quest/codex/recovery-workspace'

const git=(cwd:string,...args:string[])=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
const repository=(path:string,untracked=false)=>{
 mkdirSync(path,{recursive:true})
 git(path,'init','--quiet')
 git(path,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','--quiet','-m','initial')
 if(untracked)writeFileSync(join(path,'scratch.txt'),'untracked input')
 return realpathSync(path)
}
const fixture=()=>{const root=realpathSync.native(mkdtempSync(join(tmpdir(),'quest-recovery-'))),origin=join(root,'hub');mkdirSync(origin);return {root,origin,store:new QuestStore(join(root,'ledger'))}}

test('a changed repository mapping prepares the current checkout while the blocked receipt and its owner are preserved',()=>{
 const {root,origin,store}=fixture()
 try{
  repository(origin)
  const historical=repository(join(root,'historical'),true),current=repository(join(root,'current'))
  const hook=(session_id:string,tool_name:string,tool_input:any,mapped?:string)=>codexHook({session_id,cwd:origin,hook_event_name:'PreToolUse',tool_name,tool_input},store,mapped?{aliases:{[origin]:mapped},needsEnvironment:false}:{aliases:{},needsEnvironment:false})
  // The first session holds the hub scope, so the second one needs recovery.
  expect(hook('owner','Bash',{command:'git status'})).toEqual({})
  expect(()=>hook('second','mcp__node_repl__js',{code:'1'},historical)).toThrow(/Untracked source inputs are ambiguous/)
  const records=join(store.runtime,'codex','workspaces'),blocked=readdirSync(records)
  expect(blocked.length).toBe(1)
  const preserved=readFileSync(join(records,blocked[0]),'utf8'),before=JSON.parse(preserved)
  expect(before.repository).toBe(historical)
  expect(before.preparation.state).toBe('blocked')
  expect(existsSync(before.directory)).toBe(false)
  const recovered=hook('second','mcp__node_repl__js',{code:'2'},current)
  expect(recovered.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(recovered.hookSpecificOutput.permissionDecisionReason).toContain(join(current,'.worktrees'))
  expect(readFileSync(join(records,blocked[0]),'utf8')).toBe(preserved)
  const receipts=readdirSync(records)
  expect(receipts.length).toBe(2)
  const migrated=JSON.parse(readFileSync(join(records,receipts.find(name=>name!==blocked[0])!),'utf8'))
  expect(migrated.repository).toBe(current)
  expect(existsSync(migrated.directory)).toBe(true)
  expect(git(historical,'worktree','list')).not.toContain('.worktrees')
  expect(git(current,'worktree','list').split('\n').filter(line=>line.includes('.worktrees')).length).toBe(1)
  // The retry reuses the recovered workspace and creates nothing new.
  const again=hook('second','mcp__node_repl__js',{code:'3'},current)
  expect(again.hookSpecificOutput.permissionDecisionReason).toContain(migrated.directory)
  expect(readdirSync(records).length).toBe(2)
  expect(git(current,'worktree','list').split('\n').filter(line=>line.includes('.worktrees')).length).toBe(1)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('a valid owned workspace is reused when the repository mapping changes instead of preparing a second',()=>{
 const {root,origin,store}=fixture()
 try{
  const first=repository(join(root,'historical')),second=repository(join(root,'current'))
  const firstCall=recoverWorkspace(store,origin,'session',{aliases:{[origin]:first},needsEnvironment:false})
  expect(existsSync(firstCall.directory)).toBe(true)
  const records=join(store.runtime,'codex','workspaces')
  writeFileSync(join(records,'foreign.json'),'{not this session')
  const receipts=()=>readdirSync(records).sort().map(name=>[name,readFileSync(join(records,name),'utf8')] as const)
  const before=receipts()
  const secondCall=recoverWorkspace(store,origin,'session',{aliases:{[origin]:second},needsEnvironment:false})
  expect(secondCall.repository).toBe(first)
  expect(secondCall.directory).toBe(firstCall.directory)
  expect(secondCall.branch).toBe(firstCall.branch)
  expect(receipts()).toEqual(before)
  expect(existsSync(join(second,'.worktrees'))).toBe(false)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('malformed and foreign receipts are preserved and never adopted',()=>{
 const {root,origin,store}=fixture()
 try{
  const first=repository(join(root,'first'),true),second=repository(join(root,'second'))
  expect(()=>recoverWorkspace(store,origin,'session',{aliases:{[origin]:first},needsEnvironment:false})).toThrow(/Untracked source inputs are ambiguous/)
  recoverWorkspace(store,origin,'session',{aliases:{[origin]:second},needsEnvironment:false})
  const records=join(store.runtime,'codex','workspaces'),names=readdirSync(records).sort()
  expect(names.length).toBe(2)
  const call=()=>recoverWorkspace(store,origin,'session',{aliases:{[origin]:second},needsEnvironment:false})
  const preserved=(file:string,text:string)=>{writeFileSync(file,text);expect(call).toThrow(/preserving it/);expect(readFileSync(file,'utf8')).toBe(text)}
  for(const name of names){
   const file=join(records,name),binding=JSON.parse(readFileSync(file,'utf8'))
   preserved(file,'{')
   preserved(file,JSON.stringify({...binding,sessionID:'another-session'}))
   preserved(file,JSON.stringify({...binding,directory:join(root,'elsewhere')}))
  }
  const scopedName=names.find(name=>JSON.parse(readFileSync(join(records,name),'utf8')).repository===second)!
  const scoped=JSON.parse(readFileSync(join(records,scopedName),'utf8')),id=scopedName.slice(0,-5)
  preserved(join(records,scopedName),JSON.stringify({...scoped,repository:first,directory:join(first,'.worktrees','quest-recovery-'+id)}))
 }finally{rmSync(root,{recursive:true,force:true})}
})
