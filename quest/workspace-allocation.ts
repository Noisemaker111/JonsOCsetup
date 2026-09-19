import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads'
import {QuestWorkspaces, type Workspace} from './workspaces'
import {QuestStore} from './store'

type Allocation = {runtime:string; projectRoot:string} & (
 {mode:'worktree';input:Parameters<QuestWorkspaces['create']>[0]} |
 {mode:'shared';input:Omit<Parameters<QuestWorkspaces['createShared']>[0],'store'>} |
 {mode:'research';input:Parameters<QuestWorkspaces['createResearch']>[0]}
)
/** Git snapshots and dependency installs must not block the host's API and session loop. */
export function allocateWorkspace(input:Allocation):Promise<Workspace> {
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL(import.meta.url),{workerData:input})
  let received=false
  worker.once('message',result=>{received=true;result.error?reject(new Error(result.error)):resolve(result.workspace)})
  worker.once('error',reject)
  worker.once('exit',code=>{if(!received)reject(new Error('Workspace preparation ended without a saved result (exit '+code+')'))})
 })
}
if(!isMainThread){
 const request=workerData as Allocation,manager=new QuestWorkspaces(request.runtime)
 try{
  const workspace=request.mode==='research'?manager.createResearch(request.input):request.mode==='shared'?manager.createShared({...request.input,store:new QuestStore(request.projectRoot)}):manager.create(request.input)
  parentPort!.postMessage({workspace})
 }catch(error){parentPort!.postMessage({error:error instanceof Error?error.message:String(error)})}
 finally{parentPort!.close()}
}
