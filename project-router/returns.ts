import { createHash } from 'node:crypto'
import { claimRouterRequest } from '../quest/router-public'
import { redact } from './host'
import type { Storage, SessionHost, RouteReceipt } from './routing'

export type ReturnWatch = { key:string; hubSessionID:string; destinationSessionID:string; target:RouteReceipt['target']; dueAt:number; sourceAgent:string; sourceModel:any }
type Notice = { id:string; watch:ReturnWatch; text:string; state:'pending'|'sending'|'accepted'|'unknown'; error?:string }
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')

function returnEvidence(result:any, detail:any) {
 const items=result?.items??[]
 const prose=items.find((item:any)=>item.role==='assistant'&&item.excerpt)?.excerpt
 const tools=items.flatMap((item:any)=>item.tools??[])
 const relevant=tools.filter((tool:any)=>tool.status==='error'||tool.calls?.some((call:any)=>call.status==='error'||call.name==='quest'))
 const lines=[prose?`Destination report: ${prose}`:'No destination summary was recorded.']
 for(const tool of relevant.slice(0,3))lines.push(`Tool result (${tool.calls?.map((c:any)=>c.name+' '+c.status).join(', ')||tool.name}): ${tool.result}`)
 if(detail?.quest)lines.push(`Quest: ${detail.quest}; worker state: ${detail.state}. ${(detail.steps??[]).map((s:any)=>s.title+': '+s.status).join('; ')}`)
 if(detail?.result)lines.push(redact(typeof detail.result==='string'?detail.result:JSON.stringify(detail.result),800))
 if(result?.unavailable)lines.push(result.unavailable)
 return redact(lines.join('\n\n'),4000)
}
/** Durable internal return addresses. Delivery starts a real turn; it does not launch work. */
export class RouteReturns {
 constructor(readonly storage:Storage,readonly host:SessionHost,readonly excerpts:(sessionID:string)=>Promise<unknown>,readonly claim=claimRouterRequest,readonly now=Date.now){}
 async watch(receipt:RouteReceipt,source:{agent:string;model:any}){
  if(!receipt.destinationSessionID)throw Error('Return address requires a verified destination')
  const lock=this.claim('return-index')
  try{
   const row:ReturnWatch={key:receipt.key,hubSessionID:receipt.hubSessionID,destinationSessionID:receipt.destinationSessionID,target:receipt.target,dueAt:this.now()+120000,sourceAgent:source.agent,sourceModel:source.model}
   await this.storage.set('return-watch/'+row.key,row)
   const keys:string[]=await this.storage.get('return-index')??[]
   const active:string[]=[];for(const key of keys){const prior:ReturnWatch=await this.storage.get('return-watch/'+key);if(prior?.hubSessionID===row.hubSessionID&&prior.destinationSessionID===row.destinationSessionID)continue;active.push(key)};await this.storage.set('return-index',[...active,row.key])
  }finally{lock.release()}
 }
 async event(sessionID:string,eventID:string,outcome:string,detail?:unknown){
  for(const key of await this.storage.get('return-index')??[]){
   const watch:ReturnWatch=await this.storage.get('return-watch/'+key)
   if(watch?.destinationSessionID!==sessionID)continue
   let result:unknown
   try{result=await this.excerpts(sessionID)}catch{result={unavailable:'Read project_result for the destination receipt; excerpt retrieval failed'}}
   await this.notify(watch,'event/'+eventID,`Destination turn ${outcome}. This is not proof that delegated work completed. Inspect the attached result, report any launch failure or blocker to the user now, and continue only already-authorized work.\n${returnEvidence(result,detail)}`)
   await this.storage.set('return-observed/'+key,{eventID,at:this.now()})
  }
 }
 async tick(){
  for(const key of await this.storage.get('return-index')??[]){
   const watch:ReturnWatch=await this.storage.get('return-watch/'+key)
   if(!watch||await this.storage.get('return-observed/'+key)||this.now()<watch.dueAt)continue
   await this.notify(watch,'timeout','Launch/outcome unconfirmed: no destination terminal receipt arrived within two minutes. Inspect project_result and the Quest runs. Report the uncertainty to the user; do not launch a duplicate or assume the worker is running.')
  }
 }
 async status(hubSessionID:string){
  const watches=[]
  for(const key of await this.storage.get('return-index')??[]){const watch:ReturnWatch=await this.storage.get('return-watch/'+key);if(watch?.hubSessionID!==hubSessionID)continue;const observed=await this.storage.get('return-observed/'+key);const event=observed?'event/'+observed.eventID:'timeout';const notice:Notice=await this.storage.get('return-notice/'+hash(watch.key+':'+event));watches.push({target:watch.target.name,destinationSessionID:watch.destinationSessionID,observed,notification:notice?.state??'waiting',error:notice?.error})}
  return {watches:JSON.parse(JSON.stringify(watches)),acknowledgment:'accepted means host prompt admission; assistant consumption is not inferred'}
 } private async notify(watch:ReturnWatch,event:string,text:string){
  const id=hash(watch.key+':'+event),key='return-notice/'+id
  let lock:ReturnType<typeof claimRouterRequest>
  try{lock=this.claim('return-notice/'+id)}catch{return}
  try{
   let notice:Notice=await this.storage.get(key)??{id,watch,text,state:'pending'}
   if(notice.state!=='pending')return // Unknown admission is never blindly retried.
   await this.storage.set(key,notice)
   const value=await this.host.get({sessionID:watch.hubSessionID}),hub=value?.data??value
   if(hub.agent!==watch.sourceAgent||['providerID','id','variant'].some(k=>hub.model?.[k]!==watch.sourceModel?.[k])){
    notice.error='Origin agent/model changed; pending return preserved for explicit inspection'
    await this.storage.set(key,notice);return
   }
   notice.state='sending';await this.storage.set(key,notice)
   try{
    await this.host.prompt({sessionID:watch.hubSessionID,id:'msg_'+id.slice(0,26),text:`Delegation update for ${watch.target.name}.\n${text}`,metadata:{projectRouterReturn:true,returnNotice:id,destinationSessionID:watch.destinationSessionID}})
    notice.state='accepted' // Host admission, not a fabricated assistant acknowledgment.
   }catch(error){notice.state='unknown';notice.error=redact(error instanceof Error?error.message:'Unknown wakeup admission')}
   await this.storage.set(key,notice)
  }finally{lock.release()}
 }
}