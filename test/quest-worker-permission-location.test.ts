/**
 * @core-prevents worker permission polling using the giver's location or delivering terminal results from worker locations
 * @core-observed September 14 native permission requests remained pending while the giver-scoped permission list returned none.
 */
import {expect,test} from 'bun:test'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {physicalDirectory,projectIdentity} from '../quest/project'
import {saveUserGiver} from '../quest/giver-registry.mjs'
import {registerHostObservation,hostModelIdentities} from '../quest/host-observation'
import {QuestStore} from '../quest/store'
import {QuestWorkerReturns} from '../quest/worker-returns'

test('reviewer availability belongs to the connected host, never another host account catalog',async()=>{
 const first={},second={},unregistered={}
 registerHostObservation(first,undefined,{model:{list:async()=>({data:[{providerID:'broker',id:'chosen'}]})}})
 registerHostObservation(second,undefined,{model:{list:async()=>[{providerID:'direct',id:'chosen'}]}})
 expect(await hostModelIdentities(first)).toEqual(['broker/chosen'])
 expect(await hostModelIdentities(second)).toEqual(['direct/chosen'])
 await expect(hostModelIdentities(unregistered)).rejects.toThrow('catalog is unavailable')
})

test('only the verified worker location polls its domain; terminal delivery remains with the giver',async()=>{
 const root=physicalDirectory(mkdtempSync(join(tmpdir(),'quest-permission-location-'))),workerDirectory=join(root,'worker'),otherDirectory=join(root,'other')
 mkdirSync(workerDirectory);mkdirSync(otherDirectory)
 const store=new QuestStore(root),project=projectIdentity(root),model={providerID:'provider',id:'model',variant:'max'}
 const giver={id:'ses_giver',agent:'quest-giver',model,location:{directory:root}}
 const worker={id:'ses_worker',agent:'worker',model,location:{directory:workerDirectory}}
 const polls:string[]=[],prompts:any[]=[]
 const host:any={get:async({sessionID}:any)=>sessionID===giver.id?giver:worker,prompt:async(input:any)=>{prompts.push(input)}}
 registerHostObservation(host,{list:async({sessionID}:any)=>{polls.push(sessionID);return []}})
 const runID='a'.repeat(26),context={project,directory:root,giverDirectory:root,sessionID:giver.id,requestID:'start'}
 try{
  saveUserGiver(store.runtime,{state:'bound',sessionID:giver.id,directory:root,model})
  const quest=store.create({id:'b'.repeat(26),title:'Read an authorized external instruction',objective:'Exercise worker-local permission polling',contractVersion:2,project,integrationOwner:giver.id,stages:[{id:'inspect',title:'Inspect',status:'pending',needs:[]}]})
  store.apply(quest.id,'session-claimed',{callID:runID,runID,sessionID:worker.id,parentID:giver.id,role:'worker',runtime:'native',deliverables:['inspect'],scope:{worktree:workerDirectory}},'test')
  const returns=new QuestWorkerReturns(store,host,'location-test')
  await returns.watch({quest,runID,stepIDs:['inspect'],context})
  await returns.tick(physicalDirectory(otherDirectory));expect(polls).toEqual([])
  worker.location.directory=otherDirectory
  await returns.tick(physicalDirectory(workerDirectory));expect(polls).toEqual([])
  worker.location.directory=workerDirectory
  await returns.tick(physicalDirectory(workerDirectory));expect(polls).toEqual([worker.id])
  store.apply(quest.id,'session-state',{callID:runID,state:'failed',result:'Worker failed'},'test')
  await returns.tick(physicalDirectory(workerDirectory));expect(prompts).toHaveLength(0)
  await returns.tick();expect(prompts).toHaveLength(1);expect(prompts[0]).toMatchObject({sessionID:giver.id,resume:true,metadata:{questWorkerReturn:true}})
 }finally{rmSync(root,{recursive:true,force:true})}
})
