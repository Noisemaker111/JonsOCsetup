import {verifyGiverBinding} from './user-giver'
import {runtimeQueuePath,devQueueGeneration} from './runtime-queues'
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {acquireLock} from './locking'
import {hostPermissions} from './host-observation'
import {physicalDirectory} from './project'
import {permissionKey,workerSessionID} from './worker-permissions'
import {PermissionReviewer,type PermissionReview} from './permission-reviewer'
import {questCompletionReturn} from './completion-return'
import type {QuestStore} from './store'
import type {StartRun,QuestContext} from './api'
import type {QuestHost} from './runtime'

type Notice={questID:string;runID:string;context:QuestContext;agent?:string;model?:unknown;state:'waiting'|'sending'|'accepted'|'unknown';error?:string;permissions?:Record<string,PermissionReview>}
/** Direct Quest runs have a return address even when no project_route was used. */
export class QuestWorkerReturns {
 private unreadable=new Map<string,string>()
 constructor(readonly store:QuestStore,readonly host:QuestHost,readonly generation=devQueueGeneration()){}
 private directory(){return runtimeQueuePath(this.store.runtime,'worker-returns',this.generation)}
 private save(row:Notice,directory=this.directory()){const path=join(directory,row.runID+'.json');mkdirSync(directory,{recursive:true});const tmp=path+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(row));renameSync(tmp,path)}
 async watch(input:Parameters<StartRun>[0]){
  const parent=await this.host.get({sessionID:input.context.sessionID}),session=parent?.data??parent
  const lock=acquireLock(this.store.runtime,'worker-return-'+input.runID)
  try{if(existsSync(join(this.directory(),input.runID+'.json')))return;this.save({questID:input.quest.id,runID:input.runID,context:input.context,agent:session?.agent,model:session?.model,state:'waiting'})}finally{lock.release()}
 }
 async tick(permissionDirectory?:string){
  if(!existsSync(this.store.runtime))return
  // Completed outcomes survive a host generation change. Their stable native
  // message IDs and shared locks allow delivery without adopting worker execution.
  const directories=permissionDirectory?[this.directory()]:readdirSync(this.store.runtime).filter(n=>/^worker-returns(?:-[a-f0-9]{24})?$/.test(n)).map(n=>join(this.store.runtime,n))
  for(const directory of directories){
  if(!existsSync(directory))continue
  const save=(row:Notice)=>this.save(row,directory)
  for(const name of readdirSync(directory).filter(n=>/^[a-f0-9]{26}\.json$/.test(n))){
   let lock;try{lock=acquireLock(this.store.runtime,'worker-return-'+name.slice(0,-5),{timeoutMs:0})}catch{continue}
   try{
    const path=join(directory,name)
    let row:Notice
    try{row=JSON.parse(readFileSync(path,'utf8'));this.unreadable.delete(path)}catch(error){
     // A damaged historical receipt is uncertain evidence, not a reason to
     // suppress every independent completion after it. Preserve it for recovery.
     const reason=String(error)
     if(this.unreadable.get(path)!==reason)console.error('[quests] unreadable worker return retained:',path,reason)
     this.unreadable.set(path,reason);continue
    }
    if(row.state==='accepted')continue
    const q=this.store.read(row.questID),run=q?.sessions.find(s=>s.runID===row.runID)
    if(!q||!run)continue
    const terminal=['completed','failed','cancelled'].includes(run.state)
    if(directory!==this.directory()&&!terminal)continue
    if(!terminal&&row.state!=='waiting')continue
    // Permission domains belong to a plugin location. Worker locations may review
    // their own active assignment, but never coordinate or deliver board results.
    if(permissionDirectory){
     if(terminal||typeof run.scope?.worktree!=='string'||physicalDirectory(run.scope.worktree)!==permissionDirectory)continue
     const workerID=workerSessionID(run),response=workerID?await this.host.get({sessionID:workerID}):undefined,worker=response?.data??response
     if(worker?.id!==workerID||typeof worker?.location?.directory!=='string'||physicalDirectory(worker.location.directory)!==permissionDirectory)continue
    }
    if(!terminal&&(!['executing','waiting','blocked'].includes(run.state)||run.harness||run.runtime==='claude-code'))continue
    const parent=await this.host.get({sessionID:row.context.sessionID}),session=parent?.data??parent
    try{verifyGiverBinding(this.store,row.context,session)}catch(error){row.error=String(error);save(row);continue}
     if(JSON.stringify(session?.model)!==JSON.stringify(row.model)){row.error='Giver model changed; return retained for inspection';save(row);continue}
    if(!terminal){
     const sessionID=workerSessionID(run);if(!sessionID)continue
     const response=await hostPermissions(this.host,sessionID),pending=response?.data??response
     for(const request of Array.isArray(pending)?pending:[]){
      if(request.sessionID!==sessionID||!request.id)continue
      const key=permissionKey(request);row.permissions??={}
      const review=await new PermissionReviewer(this.store,this.host).review({giverID:row.context.sessionID,questID:q.id,runID:row.runID,requestID:request.id,requestKey:key,previous:row.permissions[key],save:value=>{row.permissions![key]=value;save(row)}})??row.permissions[key]
      if(review&&['escalated','unknown'].includes(review.state)&&review.notification!=='accepted'){
       review.notification='sending';save(row)
       try{
        await this.host.prompt({sessionID:row.context.sessionID,id:'msg_questpermission'+key+review.authorizationKey,delivery:'queue',text:'Permission review needs a new decision for '+q.title+'. '+review.reason+'\nThe review is unresolved. Prose cannot approve or reject native access; there is no giver permission-reply tool. Do not search for one or claim a decision without an acknowledged permission record. Report the recorded blocker and ask only for genuinely missing user authorization or context. New user instructions or a clarified assignment trigger a fresh review. The user can also use Review permission. Do not redispatch the worker.',metadata:{questWorkerPermission:true,questID:q.id,runID:row.runID}})
        review.notification='accepted'
       }catch(error){review.notification='unknown';row.error=String(error)}
       save(row)
      }
     }
     continue
    }
    row.state='sending';save(row)
    try{
     // Each independent terminal outcome retains its queued giver response.
     // Native prompt reconciles this stable ID before admission, including after
     // promotion. Retrying an uncertain acknowledgement cannot duplicate a turn.
     await this.host.prompt({sessionID:row.context.sessionID,id:'msg_questreturn'+row.runID,delivery:'queue',resume:true,text:questCompletionReturn({quest:q,label:'Automatic Quest worker update',stepIDs:run.deliverables,run}),metadata:{questWorkerReturn:true,questID:q.id,runID:row.runID}})
     row.state='accepted'
     delete row.error
    }catch(error){row.state='unknown';row.error=String(error)}
    save(row)
   }finally{lock.release()}
  }
  }
 }
}
