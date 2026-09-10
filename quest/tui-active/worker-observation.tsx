/** @jsxImportSource @opentui/solid */
// Keep reactive hooks in the host-transformed TUI module graph.
import { createSignal, createEffect, onCleanup } from 'solid-js'
import { observeWorker, observationFailure, boundedInspection } from '../worker-observation.mjs'
import type { QuestSession } from '../types'
const unwrap=(v:any)=>v?.data??v
export function useWorkerObservations(context:any,runs:()=>QuestSession[]) {
 const [observations,setObservations]=createSignal<Record<string,any>>({})
 createEffect(()=>{
  const records=runs();let disposed=false,busy=false,requested=false
  let scheduled:ReturnType<typeof setTimeout>|undefined
  const ids=new Set(records.map(run=>run.openCodeSessionId??run.openCodeSessionID??run.sessionID))
  const schedule=()=>{if(disposed||scheduled)return;scheduled=setTimeout(()=>{scheduled=undefined;void refresh()},150)}
  const refresh=async()=>{if(disposed)return;if(busy){requested=true;return}busy=true;try{
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
     let messages:any[]=[],permissions:any[]=[],forms:any[]=[]
     if(context.client.message?.list){const response=unwrap(await boundedInspection(signal=>context.client.message.list({sessionID:id,limit:3,order:'desc'},{signal})));messages=Array.isArray(response)?response:response?.data??[]}
     if(context.client.permission?.list)permissions=unwrap(await boundedInspection(signal=>context.client.permission.list({sessionID:id},{signal})))??[]
     else if(context.data?.session?.permission?.list)permissions=context.data.session.permission.list(id)??[]
     if(context.data?.session?.form?.sync)await boundedInspection(()=>context.data.session.form.sync(id))
     if(context.data?.session?.form?.list)forms=context.data.session.form.list(id)??[]
     result[key]=activeError?observationFailure(activeError):observeWorker(session,{active:active===undefined?undefined:Object.hasOwn(active,id),messages,permissions,forms,expected:run})
    }catch(error){result[key]=observationFailure(error)}
   }))
   if(!disposed)setObservations(result)
  }finally{busy=false;if(requested){requested=false;schedule()}}}
  // Native events trigger bounded reads; polling also reconciles events missed during reconnect.
  const stop=context.data?.listen?.(({details}:any)=>{const id=details?.data?.sessionID??details?.data?.info?.sessionID;if(ids.has(id))schedule()})
  void refresh();const timer=setInterval(()=>void refresh(),4000)
  onCleanup(()=>{disposed=true;clearInterval(timer);if(scheduled)clearTimeout(scheduled);stop?.()})
 })
 return (run:QuestSession)=>observations()[run.runID??run.callID]??{state:'unknown',reason:'Checking owning host…'}
}
