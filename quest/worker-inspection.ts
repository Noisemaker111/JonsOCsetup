import {hostExecution,hostPermissions} from "./host-observation"
import { observeWorker, observationFailure, boundedInspection } from './worker-observation.mjs'
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
async function reconcile(store:QuestStore,host:any) {
 const tracker=new QuestTracker(store,host),observations:Record<string,any>={}
 for(const entry of readAllQuests(store.projectRoot,{includeArchived:true}))for(const run of entry.quest?.sessions??[]){
  if(!['planned','executing','waiting','blocked'].includes(run.state))continue
  const observation=await inspectWorker(host,run);observations[run.runID??run.callID]=observation
  if(observation.outcome&&observation.completedAt&&Date.parse(observation.completedAt)>=Date.parse(run.updatedAt))tracker.onHostEvent({type:'session.execution.'+observation.outcome,data:{sessionID:run.openCodeSessionId??run.sessionID,observedAt:observation.completedAt}})
 }
 return observations
}

const clients=new WeakMap<object,Map<string,Promise<Record<string,any>>>>()
export function reconcileWorkers(store:QuestStore,host:any){
 let polls=clients.get(host)
 if(!polls){polls=new Map();clients.set(host,polls)}
 const prior=polls.get(store.runtime);if(prior)return prior
 const promise=reconcile(store,host).finally(()=>{if(polls.get(store.runtime)===promise)polls.delete(store.runtime)})
 polls.set(store.runtime,promise);return promise
}
