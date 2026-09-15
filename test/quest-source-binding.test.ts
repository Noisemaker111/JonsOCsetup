/**
 * @core-prevents hub research bypassing its reviewed source mapping and workers losing access to their hub-owned Quest
 * @core-observed On September 13 a real research worker started at opencode-hub, requested JonsOCsetup source outside its recorded workspace, and was cancelled by its permission reviewer.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {editingSource,workerLedgerProject} from '../quest/source-binding'
import {projectIdentity,physicalDirectory} from '../quest/project'
import {QuestStore} from '../quest/store'
import {QuestWorkspaces} from '../quest/workspaces'
import {guidanceTool} from '../quest/adaptive-tools'
import {installSharedWorkspaceGuard} from '../quest/shared-guard'

test('research uses the reviewed repository, retains hub ledger identity and rejects a changed binding',()=>{
 const root=physicalDirectory(mkdtempSync(join(tmpdir(),'quest-hub-')))
 try{
  const hub=join(root,'hub'),repo=join(root,'repo');mkdirSync(hub);mkdirSync(repo)
  expect(spawnSync('git',['init',repo],{windowsHide:true}).status).toBe(0)
  const project=projectIdentity(hub),policy=join(root,'policy.json')
  const binding={directory:repo,root:repo,projectRoot:hub,scopePrefix:'config'}
  writeFileSync(policy,JSON.stringify({sourceByProject:{[project.id]:binding}}))
  const selected=editingSource({project,directory:hub},policy,undefined,{readOnly:true})
  expect(selected.source).toBe(physicalDirectory(repo))
  const store=new QuestStore(hub),q=store.create({id:'12345678901234567890123456',title:'Inspect source',objective:'Record findings',project,stages:[]})
  new QuestWorkspaces(store.runtime).createResearch({runID:'research',questID:q.id,directory:selected.source,project:selected.project})
  store.apply(q.id,'session-claimed',{callID:'research',runID:'research',sessionID:'worker'},'check')
  expect(workerLedgerProject(store,'worker',repo,q.id)).toEqual(project)
  expect(workerLedgerProject(store,'worker',repo)).toEqual(project)
  expect(()=>workerLedgerProject(store,'worker',root)).toThrow('binding changed')
  const stale=store.read(q.id)!.revision
  store.apply(q.id,'patched',{reason:'Another writer changed the Quest'})
  expect(()=>store.apply(q.id,'session-claimed',{callID:'late',role:'late'},'check',{expectedRevision:stale})).toThrow('changed since it was read')
  writeFileSync(policy,JSON.stringify({sourceByProject:{[project.id]:{...binding,root:hub}}}))
  expect(()=>editingSource({project,directory:hub},policy,undefined,{readOnly:true})).toThrow('identity changed')
  writeFileSync(policy,JSON.stringify({sourceByProject:{}}))
  expect(editingSource({project,directory:hub},policy,undefined,{readOnly:true}).source).toBe(physicalDirectory(hub))
 }finally{rmSync(root,{recursive:true,force:true})}
})

// September 15: the real self-saving worker resumed in its owned checkout, but
// quest_guidance acknowledgement rejected the checkout as another project.
test('guidance acknowledges through the native tool using the verified worker ledger project',async()=>{
 const root=physicalDirectory(mkdtempSync(join(tmpdir(),'quest-guidance-binding-')))
 try{
  const hub=join(root,'hub'),repo=join(root,'repo');mkdirSync(hub);mkdirSync(repo)
  expect(spawnSync('git',['init',repo],{windowsHide:true}).status).toBe(0)
  const project=projectIdentity(hub),store=new QuestStore(hub)
  const q=store.create({id:'b'.repeat(26),title:'Acknowledge delivered guidance',objective:'Keep worker and ledger identity bound',project,integrationOwner:'giver',stages:[]})
  new QuestWorkspaces(store.runtime).createResearch({runID:'guided',questID:q.id,directory:repo,project:projectIdentity(repo)})
  store.apply(q.id,'session-claimed',{callID:'guided',runID:'guided',sessionID:'worker',parentID:'giver',runtime:'native',state:'executing',model:'provider/model#high',scope:{worktree:repo,readOnly:true}},'check')
  let workerDirectory=repo
  const host={get:async({sessionID}:{sessionID:string})=>({id:sessionID,location:{directory:sessionID==='giver'?hub:workerDirectory},model:{providerID:'provider',id:'model',variant:'high'},agent:'worker'}),prompt:async(input:any)=>({id:input.id,sessionID:input.sessionID})}
  const tool=guidanceTool(store,host as any)
  // Register through the production transform: native verification exposed that
  // the research guard blocked acknowledgement before the binding check ran.
  await installSharedWorkspaceGuard({tool:{transform:async(transform:any)=>transform({list:()=>[{id:'quest_guidance'}],get:()=>tool,update:(_id:string,update:any)=>update(tool)})}},store)
  const sent=(await tool.execute({action:'send',questID:q.id,runID:'guided',text:'Read the existing evidence.'},{sessionID:'giver',id:'send'})).output
  expect(sent.state).toBe('submitted')
  await expect(tool.execute({action:'send',questID:q.id,runID:'guided',text:'Guide someone else'},{sessionID:'worker',id:'send-denied'})).rejects.toThrow('Read-only research cannot run quest_guidance')
  await expect(tool.execute({action:'acknowledge',questID:q.id,guidanceID:sent.id},{sessionID:'stranger',id:'foreign'})).rejects.toThrow()
  workerDirectory=root
  await expect(tool.execute({action:'acknowledge',questID:q.id,guidanceID:sent.id},{sessionID:'worker',id:'moved'})).rejects.toThrow('binding changed')
  workerDirectory=repo
  expect((await tool.execute({action:'acknowledge',questID:q.id,guidanceID:sent.id},{sessionID:'worker',id:'ack'})).output.state).toBe('acknowledged')
  const reopened=guidanceTool(new QuestStore(hub),host as any)
  expect((await reopened.execute({action:'status',questID:q.id},{sessionID:'worker',id:'reopen'})).output.guidance[0].state).toBe('acknowledged')
 }finally{rmSync(root,{recursive:true,force:true})}
})
