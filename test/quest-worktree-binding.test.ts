import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { QuestWorkspaces } from '../quest/workspaces'
import { projectIdentity, physicalDirectory, sourceCheckout, verifySourceBinding } from '../quest/project'
import { QuestStore } from '../quest/store'
import { coordination } from '../quest/coordination'
import { typedQuestTool } from '../quest/typed-tool'
import { questsAPI } from '../quest/api'
import { QuestContinuation } from '../quest/continuation'
import { startQuestRun } from '../quest/runtime'

for(const code of ['ETIMEDOUT','ENOENT'])test(`identity ${code} is actionable, bounded and never retried`,()=>{
  const spy=spyOn(childProcess,'spawnSync').mockImplementation(((_command:any,_args:any,options:any)=>{
    expect(options.timeout).toBe(15000)
    return {status:null,stdout:'',stderr:'',error:Object.assign(new Error(code),{code})}
  }) as any)
  try{expect(()=>projectIdentity(process.cwd())).toThrow(code==='ETIMEDOUT'?'timed out after 15000ms':'capability failed (ENOENT)');expect(spy).toHaveBeenCalledTimes(1)}finally{spy.mockRestore()}
})

test('durable goal resume retains the original physical binding and rejects same-project moves',async()=>{
  const f=fixture()
  try{
    const context={project:f.project,directory:physicalDirectory(f.selected),sessionID:'giver',requestID:'goal'}
    let launches=0
    const start=async(input:any)=>{expect(input.context.directory).toBe(context.directory);launches++;return {sessionID:'command_'+launches}}
    const q=questsAPI(f.store,context,start).create({title:'Goal',description:'fixture',steps:[{id:'step',title:'Step',commandID:'fixture'},{id:'next',title:'Next',commandID:'fixture',needs:['step']}]})
    const options={goalMode:true,refresh:async()=>({accounts:[]}) as any,verifyContext:async(c:any)=>verifySourceBinding(c,f.selected)}
    const first=new QuestContinuation(f.store,start,options)
    await first.run(q.id,{stepIDs:['step','next']},context)
    first.pauseGoal(context)
    f.store.apply(q.id,'stage-state',{stageID:'step',status:'done'},'fixture')
    f.store.apply(q.id,'proof-added',{stageID:'step',proof:{id:'verified',kind:'command',at:new Date().toISOString(),attempt:0,command:'fixture',verified:true,result:'passed'}},'fixture')
    f.store.apply(q.id,'session-state',{callID:f.store.read(q.id)!.sessions[0].callID,state:'completed'},'fixture')
    const restarted=new QuestContinuation(f.store,start,options)
    await expect(restarted.resumeGoal({...context,directory:physicalDirectory(f.main),requestID:'moved'})).rejects.toThrow('directory changed')
    expect(launches).toBe(1)
    await restarted.resumeGoal({...context,requestID:'resume'})
    expect(launches).toBe(2)
    expect(restarted.goalStatus(context.sessionID)[0].context.directory).toBe(context.directory)
  }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)

function fixture() {
  const tempParent=process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'Temp','opencode'):tmpdir();mkdirSync(tempParent,{recursive:true})
  const scratch=mkdtempSync(join(tempParent,'worktree-binding-'))
  const main=join(scratch,'main'),selected=join(main,'.worktrees','selected'),store=new QuestStore(join(scratch,'ledger'))
  mkdirSync(main)
  const git=(cwd:string,...args:string[])=>{const r=spawnSync('git',['--no-optional-locks','-C',cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
  git(main,'init');git(main,'config','core.autocrlf','false')
  writeFileSync(join(main,'AGENTS.md'),'main instructions\n');writeFileSync(join(main,'code.txt'),'base\n')
  git(main,'add','--','AGENTS.md','code.txt');git(main,'commit','-m','main')
  git(main,'worktree','add','-b','selected',selected,'HEAD')
  writeFileSync(join(selected,'AGENTS.md'),'selected instructions\n');mkdirSync(join(selected,'quest'));writeFileSync(join(selected,'quest','codex.ts'),'selected implementation\n')
  git(selected,'add','--','AGENTS.md','quest/codex.ts');git(selected,'commit','-m','selected')
  for(const root of [main,selected]){writeFileSync(join(root,'code.txt'),root===main?'main staged\n':'selected staged\n');git(root,'add','--','code.txt');writeFileSync(join(root,'code.txt'),root===main?'main dirty\n':'selected dirty\n')}
  writeFileSync(join(selected,'draft.txt'),'selected draft\n')
  const state=(root:string)=>({head:git(root,'rev-parse','HEAD'),index:readFileSync(git(root,'rev-parse','--path-format=absolute','--git-path','index')).toString('hex'),dirty:git(root,'diff','--binary'),staged:git(root,'diff','--cached','--binary')})
  const manager=new QuestWorkspaces(store.runtime),project=projectIdentity(main)
  return {scratch,main,selected,store,git,state,manager,project}
}

test('selected checkout HEAD, instructions and dirty snapshot reach worker without changing either source index',()=>{
  const f=fixture()
  try{
    const main=f.state(f.main),selected=f.state(f.selected)
    const w=f.manager.create({runID:'selected-worker',questID:'q',directory:f.selected,project:f.project})
    expect(w.base).toBe(selected.head);expect(w.base).not.toBe(main.head)
    expect(w.root).toBe(f.project.root);expect(w.source).toBe(physicalDirectory(f.selected))
    for(const [name,text] of [['AGENTS.md','selected instructions\n'],['quest/codex.ts','selected implementation\n'],['code.txt','selected dirty\n'],['draft.txt','selected draft\n']])expect(readFileSync(join(w.path,name),'utf8')).toBe(text)
    expect(f.state(f.main)).toEqual(main);expect(f.state(f.selected)).toEqual(selected)
    expect(f.manager.collect(w.runID).changes?.files).toEqual([])
    expect(()=>f.manager.create({runID:w.runID,questID:'q',directory:f.main})).toThrow('identity conflicts')
  }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)

test('shared claims and release bind the selected checkout; wrong projects and changed continuation bindings fail closed',()=>{
  const f=fixture()
  try{
    const before=f.state(f.main),selected=f.state(f.selected)
    coordination(f.store,{directory:f.main,sessionID:'main-owner',host:'opencode'})({action:'join',title:'Main owner',scopes:['.']})
    const q=questsAPI(f.store,{project:f.project,sessionID:'fixture',requestID:'shared'},async()=>{throw Error('no launch')}).create({title:'Shared',description:'fixture',steps:[{title:'Step'}]})
    const w=f.manager.createShared({runID:'shared',questID:q.id,directory:f.selected,project:f.project,store:f.store,files:['code.txt']})
    expect(w.path).toBe(physicalDirectory(f.selected));f.manager.verify(w)
    const status=()=>coordination(f.store,{directory:f.selected,sessionID:'observer',host:'opencode'})({action:'status'})
    expect(status().participants.find(p=>p.sessionID==='quest-run:shared')?.sameCheckout).toBe(true)
    expect(status().participants.find(p=>p.sessionID==='main-owner')?.sameCheckout).toBe(false)
    f.manager.releaseShared('shared',f.store,'fixture complete')
    expect(status().participants.map(p=>p.sessionID)).toEqual(['main-owner'])
    const context={project:f.project,directory:physicalDirectory(f.selected)}
    verifySourceBinding(context,f.selected)
    expect(()=>verifySourceBinding(context,f.main)).toThrow('directory changed')
    expect(()=>verifySourceBinding({project:f.project},f.main)).toThrow('directory changed')
    const wrong={...f.project,id:'wrong'}
    expect(()=>sourceCheckout(f.selected,wrong)).toThrow('different project')
    expect(()=>f.manager.create({runID:'wrong',questID:'q',directory:f.selected,project:wrong})).toThrow('different project')
    expect(()=>f.manager.createShared({runID:'wrong-shared',questID:'q',directory:f.selected,project:wrong,store:f.store})).toThrow('different project')
    expect(f.state(f.main)).toEqual(before);expect(f.state(f.selected)).toEqual(selected)
  }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)

test('production typed-tool and runtime execute configured command against selected source with private settings and ledger',async()=>{
  const f=fixture()
  try{
    const settings=join(f.scratch,'settings.json'),policy=join(f.scratch,'policy.json')
    writeFileSync(settings,JSON.stringify({version:1,workspaceMode:'worktree'}))
    writeFileSync(policy,JSON.stringify({version:1,commandsByProject:{[f.project.id]:{binding:{description:'Check selected instructions',argv:[process.execPath,'-e',"const fs=require('fs');if(fs.readFileSync('AGENTS.md','utf8')!=='selected instructions\\n'||fs.readFileSync('code.txt','utf8')!=='selected dirty\\n'||!fs.existsSync('quest/codex.ts'))process.exit(1);console.log('selected binding verified')"],timeoutMilliseconds:10000}}}}))
    const before=f.state(f.main),selected=f.state(f.selected)
    const tool=typedQuestTool(f.store,{get:async()=>({location:{directory:f.selected}}),create:async()=>{throw Error('command must not create model session')},prompt:async()=>{throw Error('command must not prompt')}},{settingsFile:settings,policyFile:policy})
    // Create via the canonical API to avoid scheduling the optional background preparer.
    const q=questsAPI(f.store,{project:f.project,sessionID:'fixture',requestID:'command'},async()=>{throw Error('no launch')}).create({title:'Binding command',description:'fixture',steps:[{id:'step',title:'Step',commandID:'binding'}]})
    const result=await tool.execute({action:'run',id:q.id,run:{stepIDs:['step']}},{sessionID:'fixture-giver',id:'command'})
    expect(result.output.state).toBe('completed')
    const w=f.manager.get(result.output.runID)!
    expect(w.source).toBe(physicalDirectory(f.selected));expect(w.base).toBe(selected.head)
    expect(f.store.read(q.id)?.stages[0].proofs.some(p=>p.verified&&p.result==='passed')).toBe(true)
    const missing=questsAPI(f.store,{project:f.project,sessionID:'missing-parent',requestID:'missing'},startQuestRun(f.store,{get:async()=>null,create:async()=>{throw Error('must not launch')},prompt:async()=>{throw Error('must not prompt')}},{settingsFile:settings,policyFile:policy}))
    const missingQuest=missing.create({title:'Missing binding',description:'fixture',steps:[{title:'Check',commandID:'binding'}]})
    await expect(missing.run(missingQuest.id)).rejects.toMatchObject({code:'SOURCE_BINDING_FAILED'})
    expect(f.manager.get(f.store.read(missingQuest.id)!.sessions[0].runID!)).toBeUndefined()
    expect(f.state(f.main)).toEqual(before);expect(f.state(f.selected)).toEqual(selected)
  }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)

test('main prepared spare is never used or removed by selected-worktree dispatch',()=>{
  const f=fixture()
  try{
    const p=f.manager.prepare({directory:f.main});expect(p.state).toBe('ready')
    expect(f.manager.prepare({directory:f.selected}).state).toBe('unsupported')
    const w=f.manager.create({runID:'selected',questID:'q',directory:f.selected})
    expect(w.physicalRunID).toBeUndefined();expect(f.manager.get(p.runID!)?.claimedRunID).toBeUndefined();expect(f.manager.get(p.runID!)?.removed).toBeUndefined()
    const main=f.manager.create({runID:'main-reuse',questID:'q',directory:f.main});expect(main.physicalRunID).toBe(p.runID)
    writeFileSync(join(f.selected,'code.txt'),'selected later\n');f.manager.assertPreparedSource(main)
    writeFileSync(join(f.main,'code.txt'),'main later\n');expect(()=>f.manager.assertPreparedSource(main)).toThrow('Project changed')
  }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)

test('typed host adapter carries actual session directory internally and ignores model directory input',async()=>{
  const f=fixture()
  try{
    const settings=join(f.scratch,'settings.json');writeFileSync(settings,JSON.stringify({version:1,workspaceMode:'worktree'}))
    let context:any
    const tool=typedQuestTool(f.store,{get:async()=>({location:{directory:f.selected}}),create:async()=>{throw Error('no host launch')},prompt:async()=>{throw Error('no model')}},{settingsFile:settings,startRun:async input=>{context=input.context;const w=f.manager.create({runID:input.runID,questID:input.quest.id,directory:input.context.directory!,project:input.context.project});expect(readFileSync(join(w.path,'AGENTS.md'),'utf8')).toBe('selected instructions\n');return {sessionID:'fixture-worker'}}})
    const created=await tool.execute({action:'create',create:{title:'Binding',description:'fixture',steps:[{id:'step',title:'Step'}]}},{sessionID:'fixture-giver',id:'create'})
    await tool.execute({action:'run',id:created.output.id,directory:f.main,run:{stepIDs:['step']}},{sessionID:'fixture-giver',id:'run'})
    expect(context.directory).toBe(physicalDirectory(f.selected));expect(context.project).toEqual(f.project)
  }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)


test('Windows worker paths preserve native casing and historical lower-case bindings still validate',()=>{
  if(process.platform!=='win32')return
  const f=fixture()
  try{
    const lower=f.selected.toLowerCase(),native=realpathSync.native(f.selected)
    expect(physicalDirectory(lower)).toBe(native)
    expect(sourceCheckout(lower,f.project).source).toBe(native)
    expect(()=>verifySourceBinding({project:f.project,directory:lower},native)).not.toThrow()
    const q=questsAPI(f.store,{project:f.project,sessionID:'case-giver',requestID:'case-test'},async()=>{throw Error('no launch')}).create({title:'Case fixture',description:'Test physical casing',steps:[{title:'Inspect'}]})
    const workspace=f.manager.createShared({runID:'case-worker',questID:q.id,directory:lower,project:f.project,store:f.store,files:['code.txt']})
    expect(workspace.path).toBe(native)
    expect(workspace.source).toBe(native)
    f.manager.verify(workspace)
  }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)
