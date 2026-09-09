import { createSignal, createEffect, onCleanup } from 'solid-js'
import { observeWorker, observationFailure, boundedInspection } from './worker-observation.mjs'
import type { QuestSession } from './types'
const unwrap=(v:any)=>v?.data??v
export function useWorkerObservations(context:any,runs:()=>QuestSession[]) {
 const [observations,setObservations]=createSignal<Record<string,any>>({})
 createEffect(()=>{
  const records=runs();let disposed=false,busy=false
  const refresh=async()=>{if(busy)return;busy=true;try{
   let active:any,activeError:any
   try{if(context.client?.session?.active)active=unwrap(await boundedInspection(signal=>context.client.session.active({signal})))}catch(e){activeError=e}
   const result:Record<string,any>={}
   await Promise.all(records.map(async run=>{
    const id=run.openCodeSessionId??run.openCodeSessionID??run.sessionID,key=run.runID??run.callID
    if(!id){result[key]={state:run.state==='failed'?'failed':run.state==='planned'?'launching':'queued',reason:run.result??'No session confirmed'};return}
    if(!id.startsWith('ses_')||run.harness||run.runtime==='claude-code'){result[key]={state:'external',reason:'External runtime; native navigation unavailable'};return}
    try{
     const session=unwrap(await boundedInspection(signal=>context.client.session.get({sessionID:id},{signal})))
     if(session?.id!==id)throw {status:404}
     let messages:any[]=[],permissions:any[]=[]
     if(context.client.message?.list){const response=unwrap(await boundedInspection(signal=>context.client.message.list({sessionID:id,limit:3,order:'desc'},{signal})));messages=Array.isArray(response)?response:response?.data??[]}
     if(context.client.permission?.list)permissions=unwrap(await boundedInspection(signal=>context.client.permission.list({sessionID:id},{signal})))??[]
     else if(context.data?.session?.permission?.list)permissions=context.data.session.permission.list(id)??[]
     result[key]=activeError?observationFailure(activeError):observeWorker(session,{active:active===undefined?undefined:Object.hasOwn(active,id),messages,permissions})
    }catch(error){result[key]=observationFailure(error)}
   }))
   if(!disposed)setObservations(result)
  }finally{busy=false}}
  void refresh();const timer=setInterval(()=>void refresh(),4000);onCleanup(()=>{disposed=true;clearInterval(timer)})
 })
 return (run:QuestSession)=>observations()[run.runID??run.callID]??{state:'unknown',reason:'Checking owning host…'}
}
