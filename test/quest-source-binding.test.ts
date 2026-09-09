import {expect,test} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,symlinkSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {projectIdentity} from '../quest/project'
import {editingSource,workerLedgerProject} from '../quest/source-binding'
import {QuestStore} from '../quest/store'
import {QuestWorkspaces} from '../quest/workspaces'
import {typedQuestTool} from '../quest/typed-tool'

test('hub binding allocates clean repository work and admits assigned updates back to the hub ledger',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-hub-')),hub=join(root,'hub'),repo=join(root,'repo'),other=join(root,'other')
 for(const path of [hub,repo,other])mkdirSync(path)
 const git=(...args:string[])=>{const p=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});if(p.status)throw Error(p.stderr);return p.stdout}
 try{
  git('init');writeFileSync(join(repo,'doc.md'),'Sentence');git('add','doc.md');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','Base')
  const project=projectIdentity(hub),policy=join(root,'policy.json'),binding={projectRoot:hub,directory:realpathSync.native(repo),root:realpathSync.native(repo),scopePrefix:'config'}
  writeFileSync(policy,JSON.stringify({sourceByProject:{[project.id]:binding}}))
  const context={project,directory:hub},selected=editingSource(context,policy,['config/doc.md'])
  expect(selected.files).toEqual(['doc.md']);expect(selected.project.id).not.toBe(project.id)
  expect(()=>editingSource(context,policy,['data'])).toThrow('outside')
  expect(()=>editingSource(context,policy,['config/../data'])).toThrow('scope')
  writeFileSync(join(repo,'doc.md'),'Unrelated dirty work')
  expect(()=>editingSource(context,policy,['config'])).toThrow('must be clean')
  expect(readFileSync(join(repo,'doc.md'),'utf8')).toBe('Unrelated dirty work')
  writeFileSync(join(repo,'doc.md'),'Sentence')
  const store=new QuestStore(join(root,'ledger')),q=store.create({id:'01j00000000000000000000888',title:'Hub doc',objective:'Polish',project,contractVersion:2,stages:[{id:'edit',title:'Edit',status:'pending',needs:[]}]})
  const manager=new QuestWorkspaces(store.runtime),workspace=manager.create({runID:'mapped-worker',questID:q.id,directory:selected.source,project:selected.project})
  store.apply(q.id,'session-planned',{callID:'mapped-worker',runID:'mapped-worker',parentID:'giver',role:'worker',deliverables:['edit']},'test')
  store.apply(q.id,'session-claimed',{callID:'mapped-worker',runID:'mapped-worker',sessionID:'worker',parentID:'giver',role:'worker',deliverables:['edit']},'test')
  expect(workerLedgerProject(store,'worker',workspace.path,q.id)).toEqual(project)
  expect(()=>workerLedgerProject(store,'worker',other,q.id)).toThrow('binding changed')
  const tool=typedQuestTool(store,{get:async()=>({location:{directory:workspace.path}}),create:async()=>null,prompt:async()=>null},{startRun:async()=>({sessionID:'unused'})})
  writeFileSync(join(workspace.path,'doc.md'),'Sentence.')
  await tool.execute({action:'update',id:q.id,update:{steps:[{id:'edit',state:'done',note:'Verified punctuation diff'}]}},{sessionID:'worker',id:'save'})
  expect((await tool.execute({action:'get',id:q.id},{sessionID:'worker',id:'reload'})).output.steps[0].state).toBe('done')
  expect(store.read(q.id)?.project).toEqual(project)
  expect(readFileSync(join(repo,'doc.md'),'utf8')).toBe('Sentence')
  const alias=join(root,'alias');symlinkSync(other,alias,'junction');writeFileSync(policy,JSON.stringify({sourceByProject:{[project.id]:{...binding,directory:alias}}}))
  expect(()=>editingSource(context,policy,['config'])).toThrow()
 }finally{rmSync(root,{recursive:true,force:true})}
},60000)

test('dev hub edits use the exact clean loaded release and reject changed source receipts',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-dev-source-')),hub=join(root,'hub'),repo=join(root,'repo'),release=join(root,'release'),prior=process.env.OPENCODE_RELEASE_CHANNEL
 for(const p of [hub,repo])mkdirSync(p)
 const git=(...args:string[])=>{const p=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});if(p.status)throw Error(p.stderr);return p.stdout.trim()}
 try{
  git('init');writeFileSync(join(repo,'.gitignore'),'generations/\nchannel-release.json\n');writeFileSync(join(repo,'doc.md'),'Stable');git('add','.gitignore','doc.md');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','Base')
  git('worktree','add','-b','dev',release);writeFileSync(join(release,'doc.md'),'Reviewed dev');spawnSync('git',['-C',release,'add','doc.md']);const commit=spawnSync('git',['-C',release,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','Dev'],{encoding:'utf8',windowsHide:true});if(commit.status)throw Error(commit.stderr)
  const head=spawnSync('git',['-C',release,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).stdout.trim(),generation=join(release,'generations','gen-test');mkdirSync(join(generation,'models'),{recursive:true})
  const project=projectIdentity(hub),policy=join(generation,'models','dispatch-policy.json');writeFileSync(policy,JSON.stringify({sourceByProject:{[project.id]:{projectRoot:hub,directory:repo,root:repo,scopePrefix:'config',loadedDevRelease:true}}}));writeFileSync(join(generation,'.deployment-source.json'),JSON.stringify({commit:head}));writeFileSync(join(release,'channel-release.json'),JSON.stringify({channel:'dev',root:release,commit:head}))
  process.env.OPENCODE_RELEASE_CHANNEL='dev';const selected=editingSource({project,directory:hub},policy,['config/doc.md']);expect(selected.source).toBe(realpathSync.native(release));expect(readFileSync(join(repo,'doc.md'),'utf8')).toBe('Stable')
  writeFileSync(join(release,'doc.md'),'Unreviewed');expect(()=>editingSource({project,directory:hub},policy)).toThrow('must be clean');writeFileSync(join(release,'doc.md'),'Reviewed dev')
  writeFileSync(join(generation,'.deployment-source.json'),JSON.stringify({commit:'wrong'}));expect(()=>editingSource({project,directory:hub},policy)).toThrow('identity changed')
 }finally{if(prior===undefined)delete process.env.OPENCODE_RELEASE_CHANNEL;else process.env.OPENCODE_RELEASE_CHANNEL=prior;rmSync(root,{recursive:true,force:true})}
},30000)
