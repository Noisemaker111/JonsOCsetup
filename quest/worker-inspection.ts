import {hostExecution,hostPermissions} from "./host-observation"
import {interruptedPreflight,interruptedBoundDispatch} from './dispatch-intent'
import { observeWorker, observationFailure, boundedInspection } from './worker-observation.mjs'
import { terminalStepUpdates } from './session-lineage'
import { QuestTracker } from './tracker'
import { readAllQuests } from './index'
import type { QuestStore } from './store'
import type { QuestSession } from './types'
const unwrap = (value:any) => value?.data ?? value
/** Confirm historical workers through the owning host even when no live event survived restart. */
export async function confirmWorkerIdle(host:any,sessionID:string):Promise<boolean> {
 try {
  if(typeof host.active==='function'){
   const active=unwrap(await boundedInspection(signal=>host.active({signal})))
   if(active&&typeof active==='object')return !Object.hasOwn(active,sessionID)
  }
  const observed=hostExecution(host,sessionID)
  if(observed!==undefined)return observed===false
  if(typeof host.wait!=='function')return false
  // Native wait only awaits idle. It never interrupts or resumes the execution.
  await boundedInspection(signal=>host.wait({sessionID},{signal}))
  return hostExecution(host,sessionID)!==true
 }catch{return false}
}
export async function inspectWorker(host:any, run:QuestSession):Promise<any> {
 const sessionID=run.openCodeSessionId??run.openCodeSessionID??run.sessionID
 if(!sessionID) return {state:run.state==='planned'?'launching':run.state==='failed'?'failed':'queued',reason:run.result??'No worker session was confirmed'}
 if(!sessionID.startsWith('ses_')||run.harness||run.runtime==='claude-code')return {state:'external',reason:'External runtime; no native OpenCode session can be confirmed'}
 try {
  const row=unwrap(await boundedInspection(signal=>host.get({sessionID},{signal})))
  if(row?.id!==sessionID)return {state:'missing',reason:'Recorded session was not returned by this host; ownership retained'}
  const active=typeof host.active==='function'?unwrap(await boundedInspection(signal=>host.active({signal}))):undefined
  const messages=typeof host.context==='function'?unwrap(await boundedInspection(()=>host.context({sessionID}))):[]
  const permissions=unwrap(await boundedInspection(()=>hostPermissions(host,sessionID)))
  return observeWorker(row,{active:active===undefined?hostExecution(host,sessionID):Object.hasOwn(active,sessionID),messages:Array.isArray(messages)?messages.slice(-3):[],permissions,expected:run})
 }catch(error){return observationFailure(error)}
}
/** Poll persisted outcomes to recover missed events without turning silence into completion. */
async function reconcile(store:QuestStore,host:any,questID:string) {
 const tracker=new QuestTracker(store,host),observations:Record<string,any>={}
 const quest=store.read(questID)
 for(const entry of quest?[{quest}]:[]){
  // The listing is a Markdown projection; pending journal events can advance its revision.
  // Reconciliation writes must start from the same journal-backed record as QuestStore.apply.
  let current=entry.quest&&store.read(entry.quest.id)
  if(current&&current.state!=='Archived')for(const update of terminalStepUpdates(current)) {
   current=store.apply(current.id,'stage-state',update,'quest:terminal-step-reconcile',{expectedRevision:current.revision})
  }
  for(const run of current?.sessions??[]){
  if(!['planned','executing','waiting','blocked'].includes(run.state))continue
  const interruption=run.state==='planned'&&!(run.openCodeSessionId??run.sessionID)?interruptedPreflight(store.runtime,run.runID??run.callID):undefined
  if(interruption){
   observations[run.runID??run.callID]={state:'failed',reason:interruption}
   store.apply(entry.quest!.id,'session-state',{callID:run.callID,state:'failed',result:interruption,evidence:interruption,preserveTerminal:true},'quest:interrupted-preflight')
   continue
  }
  // A transport error without an identity does not prove worker creation failed.
  // Only the preflight receipt above can settle an interrupted unbound launch.
  if(run.permissionDecisions?.some(d=>d.reply==='reject'&&d.state==='acknowledged'))try{await tracker.settlePermissionRejection(entry.quest!.id,run.runID!,host)}catch(error){observations[run.runID??run.callID]=observationFailure(error);continue}
  const currentRun=store.read(entry.quest!.id)?.sessions.find(s=>s.callID===run.callID)??run
  const boundID=currentRun.openCodeSessionId??currentRun.sessionID
  if(currentRun.state==='planned'&&boundID&&interruptedBoundDispatch(store.runtime,currentRun.runID??currentRun.callID,boundID)){
   try{if(await tracker.settleInterruptedDispatch(entry.quest!.id,currentRun.runID??currentRun.callID,host)){observations[run.runID??run.callID]={state:'failed',reason:'Exited dispatch owner; owning host confirmed an empty idle session'};continue}}catch(error){observations[run.runID??run.callID]=observationFailure(error);continue}
  }
  const observation=await inspectWorker(host,currentRun);observations[run.runID??run.callID]=observation
  if(observation.outcome&&observation.completedAt&&Date.parse(observation.completedAt)>=Date.parse(run.updatedAt))tracker.onHostEvent({type:'session.execution.'+observation.outcome,data:{sessionID:run.openCodeSessionId??run.sessionID,observedAt:observation.completedAt}})
 }
 }
 return observations
}

const clients=new WeakMap<object,Map<string,Promise<Record<string,any>>>>()
export function reconcileWorkers(store:QuestStore,host:any,questID?:string):Promise<Record<string,any>>{
 let polls=clients.get(host)
 if(!polls){polls=new Map();clients.set(host,polls)}
 const key=store.runtime+'\0'+(questID??'*')
 const prior=polls.get(key);if(prior)return prior
 // A board sweep shares each Quest's observation, but an interactive request
 // never waits for unrelated historical workers ahead of it in that sweep.
 const task=questID?reconcile(store,host,questID):(async()=>{
  const observations:Record<string,any>={}
  for(const {quest} of readAllQuests(store.projectRoot,{includeArchived:true}))if(quest)Object.assign(observations,await reconcileWorkers(store,host,quest.id))
  return observations
 })()
 const promise=task.finally(()=>{if(polls.get(key)===promise)polls.delete(key)})
 polls.set(key,promise);return promise
}
