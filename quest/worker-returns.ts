import {verifyGiverBinding} from './user-giver'
import {runtimeQueuePath,devQueueGeneration} from './runtime-queues'
import {existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {acquireLock} from './locking'
import {hostPermissions} from './host-observation'
import {physicalDirectory} from './project'
import {permissionKey,workerSessionID} from './worker-permissions'
import {PermissionReviewer,type PermissionReview} from './permission-reviewer'
import {completionWake,permissionWake} from './giver-wake'
import {readAllQuests} from './index'
import type {QuestStore} from './store'
import type {StartRun,QuestContext} from './api'
import type {QuestHost} from './runtime'

type Notice={questID:string;runID:string;context:QuestContext;agent?:string;model?:unknown;state:'waiting'|'sending'|'accepted'|'unknown';error?:string;settled?:string;permissions?:Record<string,PermissionReview>;
 /** Request id -> when the giver was asked about it. Dedupe is the request, never the review's rotating authority digest. */
 notified?:Record<string,string>}
/** Direct Quest runs have a return address even when no project_route was used. */
export class QuestWorkerReturns {
 private unreadable=new Map<string,string>()
 constructor(readonly store:QuestStore,readonly host:QuestHost,readonly generation=devQueueGeneration()){}
 private directory(){return runtimeQueuePath(this.store.runtime,'worker-returns',this.generation)}
 /**
  * The generation directories and the receipts still worth reading, refreshed from what the
  * filesystem says changed.
  *
  * Delivery has to survive a generation change, so every `worker-returns-<generation>` directory is
  * eligible -- and this installation has kept 42 of them. Listing all of them and locking, reading
  * and parsing all 253 receipts every five seconds is how a queue with 26 undelivered rows cost more
  * than the deliveries: 213 of those receipts were accepted long ago and an accepted receipt is
  * final. A directory is re-listed when its own mtime moves, an accepted receipt is dropped from the
  * worklist, and nothing is assumed about a receipt that is still open.
  */
 private generations?:{mtimeMs:number;directories:string[]}
 private worklist=new Map<string,{mtimeMs:number;names:Set<string>}>()
 private scanDirectories(permissionDirectory?:string){
  if(permissionDirectory)return [this.directory()]
  let mtimeMs:number
  try{mtimeMs=statSync(this.store.runtime).mtimeMs}catch{return []}
  if(this.generations?.mtimeMs!==mtimeMs)this.generations={mtimeMs,directories:readdirSync(this.store.runtime).filter(n=>/^worker-returns(?:-[a-f0-9]{24})?$/.test(n)).map(n=>join(this.store.runtime,n))}
  return this.generations.directories
 }
 private scanReceipts(directory:string){
  let mtimeMs:number
  try{mtimeMs=statSync(directory).mtimeMs}catch{return []}
  const held=this.worklist.get(directory)
  if(held?.mtimeMs===mtimeMs)return [...held.names]
  const names=new Set(readdirSync(directory).filter(n=>/^[a-f0-9]{26}\.json$/.test(n)))
  this.worklist.set(directory,{mtimeMs,names})
  return [...names]
 }
 private settled(directory:string,name:string){this.worklist.get(directory)?.names.delete(name)}
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
  const directories=this.scanDirectories(permissionDirectory)
  const ledger=new Map(readAllQuests(this.store.projectRoot,{includeArchived:true}).flatMap(row=>row.quest?[[row.quest.id,row.quest] as const]:[]))
  const sessions=new Map<string,Promise<any>>()
  // Several receipts belong to one Quest, and nothing in this pass writes to a Quest record, so its
  // authoritative read is shared across the tick rather than repeated per receipt.
  const authoritative=new Map<string,ReturnType<QuestStore['read']>>()
  const readQuest=(id:string)=>{if(!authoritative.has(id))authoritative.set(id,this.store.read(id));return authoritative.get(id)}
  const giverSession=async(sessionID:string)=>{
   let pending=sessions.get(sessionID)
   if(!pending){pending=this.host.get({sessionID}).then(value=>value?.data??value);sessions.set(sessionID,pending)}
   return pending
  }
  for(const directory of directories){
  if(!existsSync(directory))continue
  for(const name of this.scanReceipts(directory)){
    const path=join(directory,name)
    let row:Notice
    // Read before locking. A settled receipt needs no lock and taking one per receipt is what made
    // an already-delivered queue expensive; the authoritative re-read happens under the lock below.
    try{row=JSON.parse(readFileSync(path,'utf8'));this.unreadable.delete(path)}catch(error){
     // A damaged historical receipt is uncertain evidence, not a reason to
     // suppress every independent completion after it. Preserve it for recovery.
     const reason=String(error)
     if(this.unreadable.get(path)!==reason)console.error('[quests] unreadable worker return retained:',path,reason)
     this.unreadable.set(path,reason);continue
    }
    if(row.state==='accepted'){this.settled(directory,name);continue}
   let lock;try{lock=acquireLock(this.store.runtime,'worker-return-'+name.slice(0,-5),{timeoutMs:0})}catch{continue}
   try{
    try{row=JSON.parse(readFileSync(path,'utf8'))}catch{continue}
    if(row.state==='accepted'){this.settled(directory,name);continue}
    // Write only a receipt that changed. A retained error -- a giver whose binding cannot be verified,
    // a model that no longer matches -- was rewritten identically on every tick, which moved the
    // directory's mtime and made every other receipt look new again.
    let written=JSON.stringify(row)
    const save=(value:Notice)=>{const next=JSON.stringify(value);if(next===written)return;written=next;this.save(value,directory)}
    // Disqualify from the Markdown ledger, which the parse cache already holds, and pay for the
    // authoritative read only for a receipt that could still do something. `store.read` replays a
    // Quest's whole journal on top of its record -- one of this installation's journals is 2.2 MB --
    // so reading it for all 27 open receipts cost 797 ms of every five-second tick to conclude that
    // 26 of them were waiting on a worker that had not finished.
    const record=ledger.get(row.questID),recorded=record?.sessions.find(s=>s.runID===row.runID)
    if(!record||!recorded)continue
    const recordedTerminal=['completed','failed','cancelled'].includes(recorded.state)
    if(directory!==this.directory()&&!recordedTerminal)continue
    if(!recordedTerminal&&row.state!=='waiting')continue
    if(!recordedTerminal&&(!['executing','waiting','blocked'].includes(recorded.state)||recorded.harness||recorded.runtime==='claude-code'))continue
    const q=readQuest(row.questID),run=q?.sessions.find(s=>s.runID===row.runID)
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
    // Every open receipt names the same giver session, so this asked the host for the same row once
    // per receipt. One read serves the tick.
    const session=await giverSession(row.context.sessionID)
    try{verifyGiverBinding(this.store,row.context,session)}catch(error){row.error=String(error);save(row);continue}
     if(JSON.stringify(session?.model)!==JSON.stringify(row.model)){row.error='Giver model changed; return retained for inspection';save(row);continue}
    if(!terminal){
     const sessionID=workerSessionID(run);if(!sessionID)continue
     const response=await hostPermissions(this.host,sessionID),pending=response?.data??response
     for(const request of Array.isArray(pending)?pending:[]){
      if(request.sessionID!==sessionID||!request.id)continue
      const key=permissionKey(request);row.permissions??={}
      const review=await new PermissionReviewer(this.store,this.host).review({giverID:row.context.sessionID,questID:q.id,runID:row.runID,requestID:request.id,requestKey:key,previous:row.permissions[key],save:value=>{row.permissions![key]=value;save(row)}})??row.permissions[key]
      if(review&&['escalated','unknown'].includes(review.state)){
       const ask=permissionWake(q,request,review.reason,row.notified)
       if(ask.wake){
        review.notification='sending';save(row)
        try{
         await this.host.prompt({sessionID:row.context.sessionID,id:'msg_questpermission'+request.id,delivery:'queue',text:ask.text,metadata:{questWorkerPermission:true,questID:q.id,runID:row.runID,requestID:request.id}})
         review.notification='accepted';row.notified={...row.notified,[request.id]:new Date().toISOString()}
        }catch(error){review.notification='unknown';row.error=String(error)}
        save(row)
       }
      }
     }
     continue
    }
    // What is worth a giver turn is decided in one place (quest/giver-wake.ts): a turned-in Quest,
    // a superseded attempt, a route failure the runtime already re-dispatched and an outcome the
    // ledger already reflects all settle here without costing a turn. Three of the ten messages
    // queued on this machine were the first kind and most of the rest were the third.
    const wake=completionWake(q,run)
    if(!wake.wake){row.state='accepted';row.settled=wake.settled;save(row);continue}
    row.state='sending';save(row)
    try{
     // Each independent terminal outcome retains its queued giver response.
     // Native prompt reconciles this stable ID before admission, including after
     // promotion. Retrying an uncertain acknowledgement cannot duplicate a turn.
     await this.host.prompt({sessionID:row.context.sessionID,id:'msg_questreturn'+row.runID,delivery:'queue',resume:true,text:wake.text,metadata:{questWorkerReturn:true,questID:q.id,runID:row.runID}})
     row.state='accepted'
     delete row.error
    }catch(error){row.state='unknown';row.error=String(error)}
    save(row)
   }finally{lock.release()}
  }
  }
 }
}
