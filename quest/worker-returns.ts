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
 constructor(readonly store:QuestStore,readonly host:QuestHost,readonly generation=devQueueGeneration()){}
 private directory(){return runtimeQueuePath(this.store.runtime,'worker-returns',this.generation)}
 private save(row:Notice){const path=join(this.directory(),row.runID+'.json');mkdirSync(this.directory(),{recursive:true});const tmp=path+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(row));renameSync(tmp,path)}
 async watch(input:Parameters<StartRun>[0]){
  const parent=await this.host.get({sessionID:input.context.sessionID}),session=parent?.data??parent
  const lock=acquireLock(this.store.runtime,'worker-return-'+input.runID)
  try{if(existsSync(join(this.directory(),input.runID+'.json')))return;this.save({questID:input.quest.id,runID:input.runID,context:input.context,agent:session?.agent,model:session?.model,state:'waiting'})}finally{lock.release()}
 }
 async tick(permissionDirectory?:string){
  if(!existsSync(this.directory()))return
  for(const name of readdirSync(this.directory()).filter(n=>/^[a-f0-9]{26}\.json$/.test(n))){
   let lock;try{lock=acquireLock(this.store.runtime,'worker-return-'+name.slice(0,-5),{timeoutMs:0})}catch{continue}
   try{
    const row:Notice=JSON.parse(readFileSync(join(this.directory(),name),'utf8'));if(row.state!=='waiting')continue
    const q=this.store.read(row.questID),run=q?.sessions.find(s=>s.runID===row.runID)
    if(!q||!run)continue
    const terminal=['completed','failed','cancelled'].includes(run.state)
    // Permission domains belong to a plugin location. Worker locations may review
    // their own active assignment, but never coordinate or deliver board results.
    if(permissionDirectory){
     if(terminal||typeof run.scope?.worktree!=='string'||physicalDirectory(run.scope.worktree)!==permissionDirectory)continue
     const workerID=workerSessionID(run),response=workerID?await this.host.get({sessionID:workerID}):undefined,worker=response?.data??response
     if(worker?.id!==workerID||typeof worker?.location?.directory!=='string'||physicalDirectory(worker.location.directory)!==permissionDirectory)continue
    }
    if(!terminal&&(!['executing','waiting','blocked'].includes(run.state)||run.harness||run.runtime==='claude-code'))continue
    const parent=await this.host.get({sessionID:row.context.sessionID}),session=parent?.data??parent
    try{verifyGiverBinding(this.store,row.context,session)}catch(error){row.error=String(error);this.save(row);continue}
     if(JSON.stringify(session?.model)!==JSON.stringify(row.model)){row.error='Giver model changed; return retained for inspection';this.save(row);continue}
    if(!terminal){
     const sessionID=workerSessionID(run);if(!sessionID)continue
     const response=await hostPermissions(this.host,sessionID),pending=response?.data??response
     for(const request of Array.isArray(pending)?pending:[]){
      if(request.sessionID!==sessionID||!request.id)continue
      const key=permissionKey(request);row.permissions??={}
      const review=await new PermissionReviewer(this.store,this.host).review({giverID:row.context.sessionID,questID:q.id,runID:row.runID,requestID:request.id,requestKey:key,previous:row.permissions[key],save:value=>{row.permissions![key]=value;this.save(row)}})
      if(review&&['escalated','unknown'].includes(review.state)&&!review.notification){
       review.notification='sending';this.save(row)
       try{
        await this.host.prompt({sessionID:row.context.sessionID,id:'msg_questpermission'+key+review.authorizationKey,delivery:'queue',text:'Permission review needs a new decision for '+q.title+'. '+review.reason+'\nThe review is unresolved. Prose cannot approve or reject native access; there is no giver permission-reply tool. Do not search for one or claim a decision without an acknowledged permission record. Report the recorded blocker and ask only for genuinely missing user authorization or context. New user instructions or a clarified assignment trigger a fresh review. The user can also use Review permission. Do not redispatch the worker.',metadata:{questWorkerPermission:true,questID:q.id,runID:row.runID}})
        review.notification='accepted'
       }catch(error){review.notification='unknown';row.error=String(error)}
       this.save(row)
      }
     }
     continue
    }
    row.state='sending';this.save(row)
    try{
     // Each independent terminal outcome retains its queued giver response.
     await this.host.prompt({sessionID:row.context.sessionID,id:'msg_questreturn'+row.runID,delivery:'queue',resume:true,text:questCompletionReturn({quest:q,label:'Automatic Quest worker update',stepIDs:run.deliverables,run}),metadata:{questWorkerReturn:true,questID:q.id,runID:row.runID}})
     row.state='accepted'
    }catch(error){row.state='unknown';row.error=String(error)}
    this.save(row)
   }finally{lock.release()}
  }
 }
}
