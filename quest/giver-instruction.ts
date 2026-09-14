import {createHash,randomUUID} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {acquireLock} from './locking'

type State={pending:Record<string,boolean>;delivered?:{id:string;at:number};unknownAt?:number}
const automatic=(metadata:any)=>metadata?.questWorkerReturn===true||metadata?.questWorkerPermission===true||metadata?.questReview===true||metadata?.projectRouterGoal===true
const key=(sessionID:string)=>createHash('sha256').update(sessionID).digest('hex')
const file=(runtime:string,sessionID:string)=>join(runtime,'giver-instructions',key(sessionID)+'.json')
function read(runtime:string,sessionID:string):State{
 const path=file(runtime,sessionID)
 return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{pending:{}}
}
function change(runtime:string,sessionID:string,update:(state:State)=>void){
 const lock=acquireLock(runtime,'giver-instruction-'+key(sessionID))
 try{
  const state=read(runtime,sessionID);update(state)
  const path=file(runtime,sessionID);mkdirSync(join(runtime,'giver-instructions'),{recursive:true})
  const temporary=path+'.'+randomUUID()+'.tmp';writeFileSync(temporary,JSON.stringify(state));renameSync(temporary,path)
 }finally{lock.release()}
}
/** Persist identities only. Enqueue is not delivery and automated notices are not new instructions. */
export function observeGiverInstruction(runtime:string,event:any){
 const {sessionID,inboxID,item}=event?.data??{}
 if(typeof sessionID!=='string'||typeof inboxID!=='string'||!['session.inbox.enqueued','session.inbox.delivered','session.inbox.cancelled'].includes(event.type))return
 const at=typeof event.created==='number'?event.created:Date.parse(event.created)
 if(!Number.isFinite(at))return
 change(runtime,sessionID,state=>{
  if(event.type==='session.inbox.enqueued'){state.pending[inboxID]=item?.type==='user'&&!automatic(item.payload?.metadata);return}
  if(event.type==='session.inbox.cancelled'){delete state.pending[inboxID];return}
  if(state.delivered?.id===inboxID)return
  const human=state.pending[inboxID];delete state.pending[inboxID]
  if(human===undefined){state.unknownAt=Math.max(state.unknownAt??0,at);return}
  if(human&&(state.delivered?.at??0)<=at)state.delivered={id:inboxID,at}
 })
}
/** Host context is authoritative when present; delivered-event identity survives compaction. */
export function giverInstruction(runtime:string,sessionID:string,messages:any[],assistantIndex:number):string|undefined{
 const assistant=messages[assistantIndex]
 for(let i=assistantIndex-1;i>=0;i--){
  const message=messages[i]
  if(message?.type!=='user'||automatic(message.metadata)||typeof message.id!=='string')continue
  const at=Number(message.time?.created)
  if(Number.isFinite(at))change(runtime,sessionID,state=>{if((state.delivered?.at??0)<=at)state.delivered={id:message.id,at}})
  return message.id
 }
 const state=read(runtime,sessionID),created=Number(assistant?.time?.created)
 if(state.delivered&&state.delivered.at<=created&&(state.unknownAt??0)<=state.delivered.at)return state.delivered.id
}
