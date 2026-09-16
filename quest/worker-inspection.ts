import {existsSync} from 'node:fs'
import {hostExecution,hostPermissions} from "./host-observation"
import {interruptedPreflight,interruptedBoundDispatch} from './dispatch-intent'
import { observeWorker, observationFailure, boundedInspection } from './worker-observation.mjs'
import { terminalStepUpdates } from './session-lineage'
import { QuestTracker } from './tracker'
import { readAllQuests } from './index'
import type { QuestStore } from './store'
import type { QuestSession } from './types'
const unwrap = (value:any) => value?.data ?? value
/** When this host process began. Admission happens in it, so nothing older is still waiting on it. */
const HOST_STARTED_AT = Date.now() - (typeof process?.uptime === 'function' ? process.uptime() * 1000 : 0)
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
  if(row?.id!==sessionID)return {state:'missing',reason:'Recorded session was not returned by its owning host; the run is over and the step is free to redispatch'}
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
  // A planned run carries no session, no lease and no workspace: it is a pending admission and
  // nothing else. Admission happens inside this process, so one recorded before this process began
  // has no admitter left and waits forever. The preflight receipt above settles the ones that got
  // far enough to leave one; this settles the ones that did not. A run planned for the route that
  // was exhausted sat here 29 hours holding its step, and the giver had already written down the
  // gap: the runtime could not terminalize a sessionless pre-reboot planned run.
  if(run.state==='planned'&&!(run.openCodeSessionId??run.sessionID)&&Date.parse(run.updatedAt)<HOST_STARTED_AT){
   const reason='Planned before this host started and never bound a session, so no admission is still pending for it. Recorded at '+run.updatedAt+'.'
   observations[run.runID??run.callID]={state:'stale',reason}
   store.apply(entry.quest!.id,'session-state',{callID:run.callID,state:'stale',result:reason,evidence:reason,preserveTerminal:true},'quest:unadmitted-plan')
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
  // A recorded workspace that is no longer on disk cannot be resumed, whatever the host says about
  // the session, so settle the run before asking. This is not the same answer as an unreachable
  // host: the directory is gone, and it does not come back. One run had been retried for the life of
  // the host because the release it worked in was retired under it — every attempt to start a
  // process there threw NotFound, 236 times in a four-minute window, while its Quest had all three
  // steps done and could not be turned in because the run still owned them.
  const workspace=currentRun.scope?.worktree??(currentRun as any).worktree
  if(typeof workspace==='string'&&workspace&&!existsSync(workspace)){
   const reason='Recorded workspace is gone, so this run cannot resume or report again: '+workspace
   observations[run.runID??run.callID]={state:'stale',reason}
   store.apply(entry.quest!.id,'session-state',{callID:currentRun.callID,state:'stale',result:reason,evidence:reason,preserveTerminal:true},'quest:missing-workspace')
   continue
  }
  // A run on another harness executes outside this host, so there is no session to ask about and
  // inspectWorker answers `external` by design. Its lease is the liveness signal instead: the
  // dispatcher renews it about once a minute for as long as the worker is alive. Nothing read it
  // back, so two Codex runs whose leases expired three days earlier still held their steps, and one
  // of those Quests had every step done and could not be turned in.
  const lease=currentRun.leaseExpiresAt?Date.parse(currentRun.leaseExpiresAt):NaN
  if((currentRun.harness||currentRun.runtime==='claude-code')&&Number.isFinite(lease)&&lease<Date.now()){
   const reason='External '+(currentRun.harness??currentRun.runtime)+' run stopped renewing its lease, which expired at '+currentRun.leaseExpiresAt+'. Nothing outside this host is holding the step any more.'
   observations[run.runID??run.callID]={state:'stale',reason}
   store.apply(entry.quest!.id,'session-state',{callID:currentRun.callID,state:'stale',result:reason,evidence:reason,preserveTerminal:true},'quest:expired-lease')
   continue
  }
  // A native execution lives inside this host process, so when the host restarts every session it
  // was running stopped with it. The session row survives that restart and so does the worktree,
  // which is why none of the settles above reach these: inspectWorker finds the session present with
  // no terminal outcome, observeWorker answers `unknown`, and nothing settles unknown. Six runs sat
  // recorded executing across a restart, holding their steps, while the board did nothing for twenty
  // minutes. The step goes back to the giver to redispatch; the workspace is left where it is.
  if(!currentRun.harness&&currentRun.runtime!=='claude-code'&&Date.parse(currentRun.updatedAt)<HOST_STARTED_AT&&hostExecution(host,boundID??'')!==true){
   const reason='Execution ended with the host process it was running in; recorded '+currentRun.state+' at '+currentRun.updatedAt+', before this host started. The workspace is untouched and the step can be dispatched again.'
   observations[run.runID??run.callID]={state:'stale',reason}
   store.apply(entry.quest!.id,'session-state',{callID:currentRun.callID,state:'stale',result:reason,evidence:reason,preserveTerminal:true},'quest:execution-lost-with-host')
   continue
  }
  const observation=await inspectWorker(host,currentRun);observations[run.runID??run.callID]=observation
  // One host owns a database, so a session its own store cannot produce is gone rather than merely
  // unseen, and that is terminal evidence. Recording it is what ends the wait: an unsaved absence is
  // re-derived identically on every later sweep, so the step stays owned by a run that can never
  // report and the dead session is re-inspected for the life of the host. An unreachable host is a
  // different answer and keeps its run, because absence was never established.
  if(observation.state==='missing'){
   const reason=observation.reason??'Owning host no longer holds this session'
   store.apply(entry.quest!.id,'session-state',{callID:currentRun.callID,state:'missing',result:reason,evidence:reason,preserveTerminal:true},'quest:missing-session')
   continue
  }
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
