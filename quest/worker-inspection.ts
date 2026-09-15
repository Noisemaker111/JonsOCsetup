import {hostExecution,hostPermissions} from "./host-observation"
import { observeWorker, observationFailure, boundedInspection } from './worker-observation.mjs'
import { terminalStepUpdates } from './session-lineage'
import { QuestTracker } from './tracker'
import { readAllQuests } from './index'
import type { QuestStore } from './store'
import type { QuestSession } from './types'
const unwrap = (value:any) => value?.data ?? value
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
  // A planned run that already reported a dispatch outcome and never bound a worker session has
  // no identity to observe, so it can never leave 'planned'. Left there it holds its step
  // ineligible forever, and the only move the Quest still offers is a duplicate of itself.
  if(run.state==='planned'&&run.result&&!(run.openCodeSessionId??run.sessionID)){
   observations[run.runID??run.callID]={state:'failed',reason:run.result}
   store.apply(entry.quest!.id,'session-state',{callID:run.callID,state:'failed',result:run.result,evidence:'Dispatch reported an outcome without binding a worker session; settled as failed so this step can be dispatched again on this Quest'},'quest:reconcile')
   continue
  }
  if(run.permissionDecisions?.some(d=>d.reply==='reject'&&d.state==='acknowledged'))try{await tracker.settlePermissionRejection(entry.quest!.id,run.runID!,host)}catch(error){observations[run.runID??run.callID]=observationFailure(error);continue}
  const currentRun=store.read(entry.quest!.id)?.sessions.find(s=>s.callID===run.callID)??run
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
