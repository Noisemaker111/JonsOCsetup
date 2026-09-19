import {createHash} from 'node:crypto'
import {userGiverID,giverContext,verifyGiverBinding} from './user-giver'
import {QuestTracker} from './tracker'
import type {QuestStore} from './store'
import {assertWorkerIdentity} from './worker-identity'
import {redact,redactSensitive} from './privacy'
import type {Quest,QuestSession} from './types'
export const workerSessionID=(run:QuestSession)=>run.openCodeSessionId??run.openCodeSessionID??run.sessionID
export const permissionSummary=(request:any)=>{
 const action=redact(String(request.action??'permission'),80)
 const resources=['read','external_directory'].includes(action)&&Array.isArray(request.resources)?request.resources.map((value:any)=>redact(String(value),240)):[]
 return {action,resources}
}
/** A UI decision is valid only for the same pending request on the same owned worker. */
export function permissionReplyInput(input:{quest:Quest|undefined;runID:string;giverID:string|undefined;activeID:string|undefined;worker:any;shown:any;pending:any[];reply:'once'|'reject'}) {
 const {quest,runID,giverID,activeID,worker,shown,pending,reply}=input
 if(!giverID||activeID!==giverID)throw Error('Return to your Quest Giver before replying.')
 const run=quest?.sessions.find(run=>(run.runID??run.callID)===runID)
 if(!run||quest?.state==='Archived'||!['executing','waiting','blocked'].includes(run.state)||run.harness||run.runtime==='claude-code')throw Error('Worker ownership changed. Open the worker to inspect it.')
 const id=workerSessionID(run)
 if(!id||worker?.id!==id||shown?.sessionID!==id||!shown?.id)throw Error('Permission does not belong to this worker.')
 assertWorkerIdentity(run,worker)
 const current=pending.find(request=>request.id===shown.id&&request.sessionID===id)
 const identity=(request:any)=>JSON.stringify([request?.action,request?.resources,request?.save,request?.source])
 if(!current||identity(current)!==identity(shown))throw Error('This request changed or was already answered. Review current requests again.')
 if(reply!=='once'&&reply!=='reject')throw Error('Persistent access must be reviewed in the native worker permission dialog.')
 return {sessionID:id,requestID:current.id,reply}
}

export const permissionKey=(request:any)=>createHash('sha256').update(JSON.stringify([request.id,request.sessionID,request.action,request.resources,request.save,request.source])).digest('hex')
const unwrap=(value:any)=>value?.data??value
export class WorkerPermissions {
 constructor(readonly store:QuestStore,readonly host:any,readonly permission:any){}
 private async owned(callerID:string,questID:string,runID:string){
   if(!callerID||userGiverID(this.store)!==callerID)throw Error('Only the registered Quest Giver can decide worker permissions.')
   const caller=unwrap(await this.host.get({sessionID:callerID}))
   verifyGiverBinding(this.store,giverContext(this.store,caller,'permission-review',questID),caller)
  const quest=this.store.read(questID),run=quest?.sessions.find(s=>(s.runID??s.callID)===runID)
  if(!quest||quest.state==='Archived'||!run||!['executing','waiting','blocked'].includes(run.state)||run.harness||run.runtime==='claude-code')throw Error('No active native assignment owns this request.')
  return {quest,run}
 }
 async inspect(callerID:string,questID:string,runID:string){
  const {quest,run}=await this.owned(callerID,questID,runID),sessionID=workerSessionID(run)!
  const [pending,messages]=await Promise.all([this.permission.list({sessionID}),this.host.context({sessionID})])
  return {questID,runID,title:quest.title,description:quest.description||quest.objective,steps:quest.stages.filter(s=>run.deliverables.includes(s.id)).map(s=>({id:s.id,title:s.title,detail:s.detail})),workspace:run.scope?.worktree,requests:unwrap(pending).map((request:any)=>{
   const message=unwrap(messages).find((m:any)=>m.id===request.source?.messageID),part=message?.content?.find((p:any)=>p.type==='tool'&&p.id===request.source?.id),input=part?.state?.input
   // Whether a request can be approved is about what was hidden, never about how long it was.
   // canApprove used to compare the details against redact(details,6000), which both strips secrets
   // and slices at 6000 characters, so any ordinary large action was permanently unapprovable: the
   // reviewer decided "once", the decision was discarded, and it escalated saying the details were
   // "incomplete or redacted" when nothing had been redacted at all. The Quest to rewrite the shared
   // MEMORY.md blocked on exactly that, because the file it had to read is 11,409 characters.
   // The reviewer is also shown the whole sanitized action now, so it decides on what it can see.
   const details=JSON.stringify({tool:part?.name,input}),sanitized=redactSensitive(details)
   return {requestID:request.id,requestKey:permissionKey(request),...permissionSummary(request),source:sanitized,sourceCharacters:sanitized.length,canApprove:!!part?.name&&!!input&&typeof input==='object'&&sanitized===details}
  })}
 }
 async reply(callerID:string,input:{questID:string;runID:string;requestID:string;requestKey:string;reply:'once'|'reject';reason:string},actor:'user'|'reviewer',reviewerModel?:string){
  const {quest,run}=await this.owned(callerID,input.questID,input.runID),sessionID=workerSessionID(run)!
  if(!input.reason?.trim())throw Error('Record the existing authorization or reason for rejection.')
  const pending=unwrap(await this.permission.list({sessionID})),shown=pending.find((p:any)=>p.id===input.requestID)
  if(!shown||permissionKey(shown)!==input.requestKey)throw Error('Request changed or was already answered; inspect it again.')
  if(actor==='reviewer'&&input.reply==='once'){
   const view=await this.inspect(callerID,input.questID,input.runID)
   if(!view.requests.find((r:any)=>r.requestID===input.requestID)?.canApprove)throw Error('Part of this action was redacted as sensitive, so it cannot be approved unseen. Use native review, or reject an unnecessary request.')
  }
  const worker=unwrap(await this.host.get({sessionID})),reply=permissionReplyInput({quest:this.store.read(quest.id),runID:input.runID,giverID:userGiverID(this.store),activeID:callerID,worker,shown,pending,reply:input.reply})
  const decision={requestID:input.requestID,reply:input.reply,actor,...(reviewerModel?{model:reviewerModel}:{}),reason:redact(input.reason,1500),at:new Date().toISOString()}
  const save=(state:'sending'|'acknowledged'|'unknown')=>this.store.apply(quest.id,'session-state',{callID:run.callID,state:this.store.read(quest.id)?.sessions.find(s=>s.callID===run.callID)?.state??run.state,preserveTerminal:true,permissionDecision:{...decision,state}},'quest:permission-decision')
  save('sending')
  try{await this.permission.reply(reply)}catch(error){save('unknown');throw error}
  save('acknowledged')
  let settlementError:string|undefined
  if(input.reply==='reject')try{await new QuestTracker(this.store,this.host).settlePermissionRejection(quest.id,input.runID,this.host)}catch(error){settlementError='Rejection acknowledged; waiting for confirmed worker idle: '+redact(String(error),500)}
  return {acknowledged:true,reply:input.reply,reason:decision.reason,...(settlementError?{settlementError}:{}),workerState:this.store.read(quest.id)?.sessions.find(s=>s.runID===input.runID)?.state}
 }
}
