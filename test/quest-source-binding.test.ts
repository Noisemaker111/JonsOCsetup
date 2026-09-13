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
  const stale=store.read(q.id)!.revision
  store.apply(q.id,'patched',{reason:'Another writer changed the Quest'})
  expect(()=>store.apply(q.id,'session-claimed',{callID:'late',role:'late'},'check',{expectedRevision:stale})).toThrow('changed since it was read')
  writeFileSync(policy,JSON.stringify({sourceByProject:{[project.id]:{...binding,root:hub}}}))
  expect(()=>editingSource({project,directory:hub},policy,undefined,{readOnly:true})).toThrow('identity changed')
  writeFileSync(policy,JSON.stringify({sourceByProject:{}}))
  expect(editingSource({project,directory:hub},policy,undefined,{readOnly:true}).source).toBe(physicalDirectory(hub))
 }finally{rmSync(root,{recursive:true,force:true})}
})
