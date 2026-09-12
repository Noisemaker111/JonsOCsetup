/**
 * @core-prevents a worker session binding a different agent or model than dispatch reserved, so a Quest records work that a different route actually did
 * @core-observed Dispatch reserves an exact account/model/reasoning route; a host that bound something else would be invisible without this check (2026-09-09).
 */
import {test,expect} from 'bun:test'
import {assertWorkerIdentity} from '../quest/worker-identity'
const run:any={runtime:'native',agentRole:'proxy-sol',providerID:'cliproxyapi',modelID:'gpt-5.6-sol',reasoningEffort:'xhigh'}
const actual={agent:'proxy-sol',model:{providerID:'cliproxyapi',id:'gpt-5.6-sol',variant:'xhigh'}}
test('worker subsequent turns retain exactly the authorized agent, provider, model and reasoning',()=>{
 expect(()=>assertWorkerIdentity(run,actual)).not.toThrow()
 for(const changed of [{...actual,agent:'quest-giver'},{...actual,model:{...actual.model,id:'gpt-5.6-luna'}},{...actual,model:{...actual.model,variant:'medium'}},{...actual,model:{...actual.model,providerID:'openai'}},{}])expect(()=>assertWorkerIdentity(run,changed)).toThrow('No inference was sent')
})

import {connectHostObservation,disconnectHostObservation,recordHostObservation,hostExecution,hostPermissions} from '../quest/host-observation'
import {filterQuests} from '../quest/tui-model'

test('live worker evidence and permissions never cross host clients',async()=>{
 const first={},second={}
 connectHostObservation(first,{list:async()=>[{action:'read'}]});connectHostObservation(second)
 recordHostObservation(first,{type:'session.status',data:{sessionID:'worker',status:{type:'running'}}})
 expect(hostExecution(first,'worker')).toBe(true)
 expect(hostExecution(second,'worker')).toBeUndefined()
 expect(await hostPermissions(second,'worker')).toEqual([])
 disconnectHostObservation(second)
 expect(hostExecution(first,'worker')).toBe(true)
 disconnectHostObservation(first)
 expect(hostExecution(first,'worker')).toBeUndefined()
 connectHostObservation(first)
 expect(hostExecution(first,'worker')).toBeUndefined()
})

test('saved execution state cannot make a Quest active without host evidence',()=>{
 const quest:any={state:'Working',sessions:[{callID:'call',state:'executing'}]}
 expect(filterQuests([quest],'active')).toHaveLength(0)
 expect(filterQuests([quest],'active',()=>({state:'running'}))).toHaveLength(1)
 for(const state of ['unknown','unreachable','blocked','completed'])expect(filterQuests([quest],'active',()=>({state}))).toHaveLength(0)
})

import {enforceSessionModelChange} from '../models/session-lifecycle'
test('host model change guard preserves an executing worker pin',()=>{
 const event={sessionModel:'cliproxyapi/gpt-5.6-sol',sessionVariant:'xhigh',workerStarted:true,input:{model:'cliproxyapi/gpt-5.6-sol',variant:'xhigh'}}
 expect(()=>enforceSessionModelChange(event)).not.toThrow()
 expect(()=>enforceSessionModelChange({...event,input:{...event.input,model:'openai/gpt-6-astra'}})).toThrow('immutable')
 expect(()=>enforceSessionModelChange({...event,input:{...event.input,variant:'medium'}})).toThrow('immutable')
})
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {QuestWorkspaces} from '../quest/workspaces'

test('workspace snapshots preserve tracked ignored files without importing ignored secrets or changing the source index',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-snapshot-')),repo=join(root,'source')
 mkdirSync(repo);const git=(...args:string[])=>{const result=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stderr);return result.stdout}
 try{
  git('init');git('config','core.autocrlf','false');git('config','user.name','Snapshot Test');git('config','user.email','snapshot@example.invalid')
  writeFileSync(join(repo,'.gitignore'),'ignored/\n.claude/\n');mkdirSync(join(repo,'ignored'));writeFileSync(join(repo,'ignored','tracked.txt'),'original\n');writeFileSync(join(repo,'removed.txt'),'remove me\n')
  git('add','.gitignore','removed.txt');git('add','--force','ignored/tracked.txt');git('commit','-m','initial')
  writeFileSync(join(repo,'ignored','tracked.txt'),'updated\n');writeFileSync(join(repo,'ignored','private.txt'),'must stay outside snapshot\n');writeFileSync(join(repo,'new.txt'),'new content\n');git('rm','removed.txt')
  const before=readFileSync(join(repo,'.git','index'))
  const workspace=new QuestWorkspaces(join(root,'runtime')).create({runID:'snapshot-test',questID:'test',directory:repo,skipPrepared:true})
  expect(readFileSync(join(workspace.path,'ignored','tracked.txt'),'utf8')).toBe('updated\n')
  expect(readFileSync(join(workspace.path,'new.txt'),'utf8')).toBe('new content\n')
  expect(existsSync(join(workspace.path,'ignored','private.txt'))).toBe(false)
  expect(existsSync(join(workspace.path,'removed.txt'))).toBe(false)
  expect(readFileSync(join(repo,'.git','index')).equals(before)).toBe(true)
 }finally{
  const target=realpathSync(root),allowed=resolve(tmpdir())
  if(!target.toLowerCase().startsWith((allowed+'\\quest-snapshot-').toLowerCase()))throw Error('Unexpected test cleanup target')
  rmSync(target,{recursive:true,force:true})
 }
})

import {permissionReplyInput,permissionSummary} from '../quest/worker-permissions'
test('giver decisions cannot approve another worker, changed requests, or persistent access',()=>{
 const session={...run,runID:'run',callID:'call',state:'executing',sessionID:'ses_worker'}
 const request={id:'permission',sessionID:'ses_worker',action:'external_directory',resources:['C:/fixture/*'],source:{type:'tool',id:'tool',messageID:'message'}}
 const input:any={quest:{state:'Working',sessions:[session]},runID:'run',giverID:'ses_giver',activeID:'ses_giver',worker:{...actual,id:'ses_worker'},shown:request,pending:[request],reply:'once'}
 expect(permissionReplyInput(input)).toEqual({sessionID:'ses_worker',requestID:'permission',reply:'once'})
 expect(permissionReplyInput({...input,reply:'reject'}).reply).toBe('reject')
 for(const change of [{activeID:'ses_other'},{giverID:undefined},{runID:'other'},{pending:[]},{reply:'always'},{worker:{...input.worker,id:'ses_other'}},{pending:[{...request,resources:['C:/*']}]},{quest:{state:'Archived',sessions:[session]}},{worker:{...input.worker,model:{...actual.model,variant:'medium'}}}])expect(()=>permissionReplyInput({...input,...change})).toThrow()
 expect(permissionSummary({action:'bash',resources:['echo password=private']})).toEqual({action:'bash',resources:[]})
 expect(permissionSummary({action:'read',resources:['secret=private']})).toEqual({action:'read',resources:['[REDACTED]']})
})

import {instructionReadPath} from '../quest/worker-instructions'
test('worker setup reads cover only real instruction files in explicitly assigned roots',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-instruction-')),project=join(root,'project'),worker=join(root,'worker'),other=join(root,'other')
 try{
  for(const dir of [project,worker,other]){mkdirSync(dir);writeFileSync(join(dir,'AGENTS.md'),'fixture');writeFileSync(join(dir,'source.ts'),'private')}
  expect(instructionReadPath(join(project,'AGENTS.md'),worker,[project,worker])).toBe(join(project,'AGENTS.md'))
  expect(instructionReadPath('../project/AGENTS.md',worker,[project])).toBe(join(project,'AGENTS.md'))
  expect(instructionReadPath(join(other,'AGENTS.md'),worker,[project,worker])).toBeUndefined()
  expect(instructionReadPath(join(other,'AGENTS.md'),worker,[project,worker],other)).toBe(join(other,'AGENTS.md'))
  writeFileSync(join(other,'MEMORY.md'),'other project memory')
  expect(instructionReadPath(join(other,'MEMORY.md'),worker,[project,worker],other)).toBeUndefined()
  expect(instructionReadPath(join(project,'source.ts'),worker,[project])).toBeUndefined()
  expect(instructionReadPath(project,worker,[project])).toBeUndefined()
  expect(instructionReadPath(join(project,'MEMORY.md'),worker,[project])).toBeUndefined()
 }finally{
  const target=realpathSync(root),allowed=resolve(tmpdir())
  if(!target.toLowerCase().startsWith((allowed+'\\quest-instruction-').toLowerCase()))throw Error('Unexpected test cleanup target')
  rmSync(target,{recursive:true,force:true})
 }
})
