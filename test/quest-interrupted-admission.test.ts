/**
 * @core-prevents an exited preflight owner permanently blocking the same Quest while preserving uncertain worker creation
 * @core-observed After the September 15 reboot a sessionless planned measurement run survived continuation cancellation and blocked every retry.
 */
import{test,expect}from'bun:test'
import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join,resolve}from'node:path'
import{spawnSync}from'node:child_process'
import{QuestStore}from'../quest/store'
import{reconcileWorkers}from'../quest/worker-inspection'
import{questsAPI}from'../quest/api'
import{projectIdentity}from'../quest/project'

test('an actual exited launch process is reconciled only before creation, preserving saved evidence and retry lineage',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-interrupted-admission-'))
 try{
  const fixture=resolve('test/fixtures/interrupted-admission.ts')
  const host={get:async()=>{throw Error('No confirmed session to inspect')}}
  for(const phase of ['preflight','creating']){
   const projectRoot=join(root,phase);mkdirSync(projectRoot)
   expect(spawnSync('git',['init',projectRoot],{windowsHide:true}).status).toBe(0)
   const store=new QuestStore(projectRoot)
   const child=spawnSync(process.execPath,[fixture,projectRoot,phase],{windowsHide:true,encoding:'utf8'})
   expect(child.stderr).toBe('');expect(child.status).toBe(0)
   const {id}=JSON.parse(readFileSync(join(projectRoot,phase+'.json'),'utf8'))
   const before=new QuestStore(projectRoot).read(id)!,run=before.sessions[0]
   expect(run.state).toBe('planned');expect(run.sessionID).toBeUndefined()
   await reconcileWorkers(store,host,id)
   const after=new QuestStore(projectRoot).read(id)!
   expect(after.sessions[0].state).toBe(phase==='preflight'?'failed':'planned')
   if(phase==='preflight'){
    expect(after.sessions[0].result).toContain('before any worker creation')
    const retry=questsAPI(store,{project:projectIdentity(projectRoot),sessionID:'giver',requestID:'retry'},async()=>({sessionID:'ses_retry'}))
    await retry.run(id,{readOnly:true,task:'utility'})
    const saved=new QuestStore(projectRoot).read(id)!
    expect(saved.sessions).toHaveLength(2);expect(saved.sessions[1].resumedFrom).toBe(run.callID)
   }
  }
 }finally{rmSync(root,{recursive:true,force:true})}
},30000)
