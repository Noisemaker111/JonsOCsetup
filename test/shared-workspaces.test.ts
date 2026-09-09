import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {QuestWorkspaces} from '../quest/workspaces'
import {QuestStore} from '../quest/store'
import {projectIdentity,physicalDirectory} from '../quest/project'
import {questsAPI} from '../quest/api'
import {startQuestRun} from '../quest/runtime'
import {coordination} from '../quest/coordination'
import {workspaceSettings,setWorkspaceMode} from '../quest/workspace-settings'
import {typedQuestTool} from '../quest/typed-tool'
import {assertSharedAssignment} from '../quest/shared-guard'
function fixture(){
 const scratch=mkdtempSync(join(tmpdir(),'quest-shared-')),root=join(scratch,'repo');mkdirSync(root)
 const git=(...args:string[])=>{const r=spawnSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid',...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
 git('init');writeFileSync(join(root,'user.txt'),'keep');git('add','.');git('commit','-m','base')
 const store=new QuestStore(join(scratch,'ledger')),project=projectIdentity(root),manager=new QuestWorkspaces(store.runtime),settings=join(scratch,'settings.json')
 const api=questsAPI(store,{project,directory:root,sessionID:'giver',requestID:'create'},async()=>({sessionID:'unused'}));const q=api.create({title:'Shared work',description:'Two disjoint files',steps:[{id:'a',title:'A'},{id:'b',title:'B'}]})
 return {scratch,root,git,store,project,manager,settings,q}
}
test('shared disjoint workers use original checkout; overlap and cross-host conflicts are rejected',()=>{
 const f=fixture();try{
  const a=f.manager.createShared({runID:'a',questID:f.q.id,directory:f.root,files:['a.txt'],store:f.store}),b=f.manager.createShared({runID:'b',questID:f.q.id,directory:f.root,files:['b.txt'],store:f.store})
  expect(a.path).toBe(physicalDirectory(f.root));expect(b.path).toBe(physicalDirectory(f.root));expect(existsSync(join(f.root,'.claude/worktrees'))).toBe(false)
  expect(()=>f.manager.createShared({runID:'conflict',questID:f.q.id,directory:f.root,files:['a.txt'],store:f.store})).toThrow('conflict')
  expect(()=>f.manager.createShared({runID:'whole',questID:f.q.id,directory:f.root,store:f.store})).toThrow('conflict')
  const codex=coordination(f.store,{directory:f.root,host:'codex',sessionID:'editor'});expect(codex({action:'join',title:'Other work',scopes:['a.txt']}).acquired).toBe(false)
  expect(codex({action:'join',title:'Other work',scopes:['user.txt']}).acquired).toBe(true)
  expect(()=>f.manager.createShared({runID:'codex-conflict',questID:f.q.id,directory:f.root,files:['user.txt'],store:f.store})).toThrow('conflict')
  writeFileSync(join(f.root,'a.txt'),'A');writeFileSync(join(f.root,'b.txt'),'B')
  expect(f.manager.collect('a').changes?.files.map(x=>x.path)).toEqual(['a.txt']);expect(f.manager.collect('b').changes?.files.map(x=>x.path)).toEqual(['b.txt']);expect(readFileSync(join(f.root,'user.txt'),'utf8')).toBe('keep')
  f.manager.releaseShared('a',f.store,'Observed terminal');expect(f.manager.createShared({runID:'next',questID:f.q.id,directory:f.root,files:['a.txt'],store:f.store}).path).toBe(physicalDirectory(f.root))
  expect(f.manager.cleanup('a')).toMatchObject({removed:false});expect(existsSync(f.root)).toBe(true)
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)
test('settings apply to future dispatches and workers cannot change the global mode',async()=>{
 const f=fixture();try{
  expect(workspaceSettings(f.settings).workspaceMode).toBe('worktree');setWorkspaceMode('shared',f.settings);expect(workspaceSettings(f.settings).workspaceMode).toBe('shared')
  expect(()=>setWorkspaceMode('bogus' as any,f.settings)).toThrow();expect(workspaceSettings(f.settings).workspaceMode).toBe('shared')
  const host={get:async()=>({location:{directory:f.root}}),create:async()=>null,prompt:async()=>null}
  const tool=typedQuestTool(f.store,host,{settingsFile:f.settings,startRun:async()=>({sessionID:'x'})})
  const result=await tool.execute({action:'update',update:{workspaceMode:'worktree'}},{sessionID:'giver',id:'setting'});expect(result.output.workspaceSettings.workspaceMode).toBe('worktree')
  f.store.apply(f.q.id,'session-planned',{callID:'worker',runID:'worker',role:'worker',deliverables:['a']});f.store.apply(f.q.id,'session-bound',{callID:'worker',sessionID:'worker-session'})
  await expect(tool.execute({action:'update',update:{workspaceMode:'shared'}},{sessionID:'worker-session',id:'unauthorized'})).rejects.toThrow('Workers')
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
})
test('shared command steps continue in place and preserve unrelated dirty files',async()=>{
 const f=fixture();try{
  setWorkspaceMode('shared',f.settings);writeFileSync(join(f.root,'user.txt'),'user dirty');writeFileSync(join(f.root,'.gitignore'),'result.json\n');writeFileSync(join(f.root,'result.json'),'{}')
  const policy=join(f.scratch,'policy.json');writeFileSync(policy,JSON.stringify({version:1,commandsByProject:{[f.project.id]:{write:{description:'Write A',argv:[process.execPath,'-e',"require('fs').writeFileSync('a.txt','shared')"],timeoutMilliseconds:5000},check:{description:'Read A',argv:[process.execPath,'-e',"if(require('fs').readFileSync('a.txt','utf8')!=='shared')process.exit(1)"],timeoutMilliseconds:5000}}}}))
  const start=startQuestRun(f.store,{get:async()=>null,create:async()=>null,prompt:async()=>null},{policyFile:policy,settingsFile:f.settings})
  const first=questsAPI(f.store,{project:f.project,directory:f.root,sessionID:'giver',requestID:'commands'},start),q=first.create({title:'Sequence',description:'Shared sequence',steps:[{id:'write',title:'Write',commandID:'write'},{id:'check',title:'Check',commandID:'check',needs:['write']}]})
  expect((await first.run(q.id,{files:['a.txt','result.json']})).state).toBe('completed')
  const second=questsAPI(f.store,{project:f.project,directory:f.root,sessionID:'giver',requestID:'next'},start);expect((await second.run(q.id,{files:['a.txt','result.json']})).state).toBe('completed');expect(readFileSync(join(f.root,'user.txt'),'utf8')).toBe('user dirty');expect(existsSync(join(f.root,'.claude/worktrees'))).toBe(false)
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)
test('unknown native launch retains shared ownership; released worker cannot resume writes',async()=>{
 const f=fixture();try{
  setWorkspaceMode('shared',f.settings);let location:any,model:any
  const host={create:async(i:any)=>{location=i.location;model=i.model;return{id:'native'}},get:async()=>({location,model,agent:'general'}),prompt:async()=>{throw Error('transport lost')}}
  const reserve:any=async()=>({route:{providerID:'p',modelID:'m',harness:'native',reasoning:'medium',serviceTier:'default'},bootstrapByProject:{},ledger:{settle:()=>{}}})
  const start=startQuestRun(f.store,host,{policyFile:'unused',settingsFile:f.settings,reserve}),api=questsAPI(f.store,{project:f.project,directory:f.root,sessionID:'giver',requestID:'unknown'},start)
  await expect(api.run(f.q.id,{model:'p/m#medium',stepIDs:['a'],files:['a.txt']})).rejects.toThrow('transport lost')
  expect(()=>f.manager.createShared({runID:'overlap',questID:f.q.id,directory:f.root,files:['a.txt'],store:f.store})).toThrow('conflict')
  const run=f.store.read(f.q.id)!.sessions[0];f.manager.releaseShared(run.runID!,f.store,'Fixture confirms worker terminated')
  expect(()=>assertSharedAssignment(f.store,'native')).toThrow('ended')
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)

test('switching modes preserves dependencies and never moves active workspaces',()=>{
 const f=fixture();try{
  const shared=f.manager.createShared({runID:'shared',questID:f.q.id,directory:f.root,files:['a.txt'],store:f.store});writeFileSync(join(f.root,'a.txt'),'result');f.manager.releaseShared('shared',f.store,'Terminal')
  const isolated=f.manager.create({runID:'isolated',questID:f.q.id,directory:f.root,inheritRunIDs:['shared']});expect(readFileSync(join(isolated.path,'a.txt'),'utf8')).toBe('result');expect(f.manager.collect('isolated').changes?.files).toHaveLength(0)
  writeFileSync(join(isolated.path,'b.txt'),'unfinished')
  expect(()=>f.manager.createShared({runID:'back',questID:f.q.id,directory:f.root,files:['b.txt'],inheritRunIDs:['isolated'],store:f.store})).toThrow('Integrate isolated dependency')
  expect(f.manager.get('shared')?.path).toBe(physicalDirectory(f.root));expect(existsSync(isolated.path)).toBe(true)
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)

test('typed run forwards file ownership and repeated requests do not launch twice',async()=>{
 const f=fixture();try{
  let calls=0,seen:any
  const tool=typedQuestTool(f.store,{get:async()=>({location:{directory:f.root}}),create:async()=>null,prompt:async()=>null},{settingsFile:f.settings,startRun:async input=>{calls++;seen=input.files;return {sessionID:'worker'}}})
  const input={action:'run',id:f.q.id,run:{model:'p/m#medium',stepIDs:['a'],files:['./a.txt']}}
  await tool.execute(input,{sessionID:'giver',id:'same-request'});await tool.execute(input,{sessionID:'giver',id:'same-request'})
  expect(calls).toBe(1);expect(seen).toEqual(['./a.txt'])
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
})

test('worker update rejects mixed authority without saving and accepts a corrected durable report',async()=>{
 const f=fixture();try{
  const host={get:async()=>({location:{directory:f.root}}),create:async()=>null,prompt:async()=>null}
  const tool=typedQuestTool(f.store,host,{settingsFile:f.settings,startRun:async()=>({sessionID:'x'})})
  f.store.apply(f.q.id,'session-planned',{callID:'worker',runID:'worker',role:'worker',deliverables:['a']});f.store.apply(f.q.id,'session-bound',{callID:'worker',sessionID:'worker-session'})
  const context={sessionID:'worker-session',id:'result'}
  const before=f.store.read(f.q.id)!.revision
  await expect(tool.execute({action:'update',id:f.q.id,update:{steps:[{id:'a',state:'done',note:'actual check'}],artifacts:[]} },context)).rejects.toThrow('No Quest changes were saved')
  expect(f.store.read(f.q.id)!.revision).toBe(before)
  await tool.execute({action:'update',id:f.q.id,update:{steps:[{id:'a',state:'done',note:'actual check; artifact a.txt'}]}},{...context,id:'corrected'})
  const result=await tool.execute({action:'get',id:f.q.id},{...context,id:'verify'})
  expect(result.output.steps.find((s:any)=>s.id==='a')).toMatchObject({state:'done',note:'actual check; artifact a.txt'})
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
})
