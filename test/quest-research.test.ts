import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {QuestStore} from '../quest/store'
import {projectIdentity,physicalDirectory} from '../quest/project'
import {questsAPI} from '../quest/api'
import {startQuestRun} from '../quest/runtime'
import {installSharedWorkspaceGuard} from '../quest/shared-guard'
import {QuestWorkspaces} from '../quest/workspaces'

function fixture(){const root=mkdtempSync(join(tmpdir(),'research-runtime-')),directory=join(root,'hub');mkdirSync(directory);writeFileSync(join(directory,'AGENTS.md'),'Inventory the sites. This hub has no build.');return {root,directory,store:new QuestStore(join(root,'ledger')),project:projectIdentity(directory)}}

test('non-Git research launches with exact binding, reads files, blocks writes and never removes the hub',async()=>{
 const f=fixture();let created:any,executed=0
 const tools=new Map(['read','shell','write','custom-mutation'].map(id=>[id,{id,execute:async()=>{executed++;return id==='read'?readFileSync(join(f.directory,'AGENTS.md'),'utf8'):'unsafe'}}]))
 const host={create:async(input:any)=>{created={...input,id:'research-session'};return created},get:async()=>created,prompt:async()=>{}}
 try{
 await installSharedWorkspaceGuard({session:host,tool:{transform:async(fn:any)=>fn({list:()=>[...tools.values()],get:(id:string)=>tools.get(id),update:(id:string,fn:any)=>fn(tools.get(id))})}},f.store)
 const context={project:f.project,directory:physicalDirectory(f.directory),sessionID:'giver',requestID:'research'}
 const start=startQuestRun(f.store,host,{policyFile:join(f.root,'unused'),beforePrompt:async()=>{},reserve:(async()=>({route:{providerID:'openai',modelID:'gpt-5.6-luna',reasoning:'medium',agent:'luna',harness:'native',serviceTier:'default',accountID:'fixture'},bootstrapByProject:{},ledger:{settle:()=>{}}})) as any})
 const api=questsAPI(f.store,context,start),q=api.create({title:'Hub inventory',description:'Read-only bounded research',steps:[{id:'inspect',title:'Inspect instructions'}]})
 const run=await api.run(q.id,{readOnly:true,model:'openai/gpt-5.6-luna#medium'})
 expect(created.location.directory).toBe(physicalDirectory(f.directory));expect(created.model).toEqual({providerID:'openai',id:'gpt-5.6-luna',variant:'medium'})
 expect(await tools.get('read')!.execute({}, {sessionID:'research-session'})).toContain('no build')
 for(const name of ['shell','write','custom-mutation'])await expect(tools.get(name)!.execute({}, {sessionID:'research-session'})).rejects.toThrow('Read-only research cannot run')
 expect(executed).toBe(1);expect(existsSync(join(f.directory,'.git'))).toBe(false)
 const manager=new QuestWorkspaces(f.store.runtime);expect(manager.collect(run.runID).changes?.files).toEqual([]);expect(manager.cleanup(run.runID).removed).toBe(false);expect(existsSync(f.directory)).toBe(true)
 await expect(api.run(q.id,{readOnly:false,model:'openai/gpt-5.6-luna#medium'})).rejects.toThrow('another access mode')
 }finally{rmSync(f.root,{recursive:true,force:true})}
})

test('research cannot launch without a registered guard or execute configured commands',async()=>{
 const f=fixture();let launches=0
 const host={create:async()=>{launches++;return {}},get:async()=>({location:{directory:f.directory}}),prompt:async()=>{}}
 try{
 const context={project:f.project,directory:physicalDirectory(f.directory),sessionID:'giver',requestID:'guard'}
 const api=questsAPI(f.store,context,startQuestRun(f.store,host,{policyFile:'unused'}));const q=api.create({title:'Guard',description:'Research',steps:[{title:'Read'}]})
 await expect(api.run(q.id,{readOnly:true,model:'openai/gpt-5.6-luna#medium'})).rejects.toThrow('no verified read-only research guard');expect(launches).toBe(0)
 await installSharedWorkspaceGuard({session:host,tool:{catalog:async(fn:any)=>fn({list:()=>[]})}},f.store)
 const commands=questsAPI(f.store,{...context,requestID:'command'},startQuestRun(f.store,host,{policyFile:'unused'})),cq=commands.create({title:'Command',description:'No shell',steps:[{title:'Check',commandID:'write'}]})
 await expect(commands.run(cq.id,{readOnly:true})).rejects.toThrow('cannot execute configured commands');expect(launches).toBe(0)
 }finally{rmSync(f.root,{recursive:true,force:true})}
})

import {typedQuestTool} from '../quest/typed-tool'
test('the public run tool preserves readOnly for direct and persisted continuation dispatch',async()=>{
 for(const continuation of [false,true]){
  const f=fixture();let received:any
  try{
   const host={get:async()=>({location:{directory:f.directory}}),create:async()=>({}),prompt:async()=>{}}
   const tool=typedQuestTool(f.store,host,{startRun:async input=>{received=input;return {sessionID:'bounded-research'}}})
   const context={sessionID:'giver',id:'create'}
   const q=await tool.execute({action:'create',create:{title:'Research',description:'Read a hub',steps:[{id:'read',title:'Inspect'}]}},context)
   await tool.execute({action:'run',id:q.output.id,run:{readOnly:true,continue:continuation,model:'openai/gpt-5.6-luna#medium'}},{...context,id:'run'})
   expect(received.readOnly).toBe(true)
   expect(f.store.read(q.output.id)!.sessions[0].scope?.readOnly).toBe(true)
   if(continuation){const rows=JSON.parse(readFileSync(join(f.store.runtime,'continuations.json'),'utf8'));expect(rows[0].readOnly).toBe(true)}
  }finally{rmSync(f.root,{recursive:true,force:true})}
 }
})
test('research results do not become an implementation source snapshot',()=>{
 const f=fixture();try{
  for(const args of [['init'],['add','AGENTS.md'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']])expect(Bun.spawnSync(['git','-C',f.directory,...args],{windowsHide:true}).exitCode).toBe(0)
  const manager=new QuestWorkspaces(f.store.runtime)
  manager.createResearch({runID:'research',questID:'fixture',directory:f.directory,project:projectIdentity(f.directory)})
  const worker=manager.create({runID:'implementation',questID:'fixture',directory:f.directory,inheritRunIDs:['research']})
  expect(worker.path).not.toBe(f.directory);expect(readFileSync(join(worker.path,'AGENTS.md'),'utf8')).toContain('no build')
 }finally{rmSync(f.root,{recursive:true,force:true})}
})
