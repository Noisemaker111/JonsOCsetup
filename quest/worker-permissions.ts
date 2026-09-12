import {assertWorkerIdentity} from './worker-identity'
import {redact} from './privacy'
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
