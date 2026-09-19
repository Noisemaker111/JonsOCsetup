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
/** Observation states that mean this run is over, whoever established it. */
export const SETTLED_OBSERVATION = new Set(['completed','failed','interrupted','cancelled','missing','stale'])
/** Recorded run states the sweep still owns. */
const OWNED_RUN = ['planned','executing','waiting','blocked']
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
/**
 * What one run looks like to its owning host.
 *
 * `active` is the host's own map of executing sessions. It is the same answer for every run, so the
 * sweep reads it once and hands it in; only a single interactive inspection fetches its own.
 *
 * `messages` is off by default and that is the point. Liveness is `host.active` plus the session
 * row: `time.idle` and `idle_outcome` are written by the host's execution projector and `time.updated`
 * is deliberately not advanced by a terminal, so the row alone says whether the execution ended. The
 * message history said nothing extra and cost the whole thread -- `session.context` has no limit
 * parameter, so every one of the fifteen recorded runs loaded its session's entire history every five
 * seconds, and the host log filled with `InterruptError: All fibers interrupted` from the five-second
 * abort that gave up on them. An interactive read of one run still asks for it.
 */
export async function inspectWorker(host:any, run:QuestSession, options:{active?:Record<string,unknown>;messages?:boolean}={}):Promise<any> {
 const sessionID=run.openCodeSessionId??run.openCodeSessionID??run.sessionID
 if(!sessionID) return {state:run.state==='planned'?'launching':run.state==='failed'?'failed':'queued',reason:run.result??'No worker session was confirmed'}
 if(!sessionID.startsWith('ses_')||run.harness||run.runtime==='claude-code')return {state:'external',reason:'External runtime; no native OpenCode session can be confirmed'}
 try {
  const row=unwrap(await boundedInspection(signal=>host.get({sessionID},{signal})))
  if(row?.id!==sessionID)return {state:'missing',reason:'Recorded session was not returned by its owning host; the run is over and the step is free to redispatch'}
  const active=options.active??(typeof host.active==='function'?unwrap(await boundedInspection(signal=>host.active({signal}))):undefined)
  const messages=options.messages&&typeof host.context==='function'?unwrap(await boundedInspection(signal=>host.context({sessionID},{signal}))):[]
  const permissions=unwrap(await boundedInspection(()=>hostPermissions(host,sessionID)))
  return observeWorker(row,{active:active===undefined?hostExecution(host,sessionID):Object.hasOwn(active,sessionID),messages:Array.isArray(messages)?messages.slice(-3):[],permissions,expected:run})
 }catch(error){return observationFailure(error)}
}
/** Everything one sweep shares across the Quests it walks. */
type Sweep={active?:Record<string,unknown>}
/**
 * What this sweep already concluded about a Quest, and from what.
 *
 * The board sweep re-derived every Quest every five seconds whether or not anything about it had
 * moved. Reconciliation is a pure function of the record and what the host says is executing, so the
 * same inputs produce the same writes; the fingerprint is those inputs. A record that changes, a
 * session that starts or stops executing, a workspace that disappears or a lease that falls due all
 * change it, and the Quest is reconciled again on the very next tick.
 */
const observed=new WeakMap<object,Map<string,string>>()
function questFingerprint(quest:any,sweep:Sweep,now:number){
 const parts=[String(quest.revision)]
 for(const run of quest.sessions as QuestSession[]){
  if(!OWNED_RUN.includes(run.state))continue
  const id=run.openCodeSessionId??run.sessionID??''
  const workspace=run.scope?.worktree??(run as any).worktree
  const lease=run.leaseExpiresAt?Date.parse(run.leaseExpiresAt):NaN
  parts.push([run.callID,run.state,run.updatedAt,id,sweep.active?String(Object.hasOwn(sweep.active,id)):'?',
   typeof workspace==='string'&&workspace?String(existsSync(workspace)):'-',
   Number.isFinite(lease)?String(lease<now):'-'].join(''))
 }
 return parts.join('')
}
/** Poll persisted outcomes to recover missed events without turning silence into completion. */
async function reconcile(store:QuestStore,host:any,questID:string,sweep:Sweep={}) {
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
  if(!OWNED_RUN.includes(run.state))continue
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
  const observation=await inspectWorker(host,currentRun,{active:sweep.active});observations[run.runID??run.callID]=observation
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
  // quest:idle-host-outcome — the recorded run says executing; the host says this session is not in
  // its active map and its row carries a persisted outcome older than the record. Both statements
  // cannot be true, and the host's is the one backed by an execution event. Without this the set of
  // runs the board calls active only ever grew: all fifteen "Working" Quests carried an `executing`
  // run written by prompt admission, the host had long since finished most of them, and nothing
  // above settles an already-idle session whose outcome predates the last ledger write.
  else if(observation.outcome&&observation.state!=='running'&&['executing','waiting'].includes(currentRun.state)){
   const reason='Owning host reports this session idle with a persisted '+observation.outcome+' outcome recorded at '+(observation.completedAt??'an earlier time')+', so the recorded execution is over.'
   observations[run.runID??run.callID]={...observation,reason}
   store.apply(entry.quest!.id,'session-state',{callID:currentRun.callID,state:observation.outcome==='succeeded'?'completed':observation.outcome==='failed'?'failed':'cancelled',result:reason,evidence:reason,preserveTerminal:true},'quest:idle-host-outcome')
  }
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
 const task=questID?reconcile(store,host,questID):sweepAll(store,host)
 const promise=task.finally(()=>{if(polls.get(key)===promise)polls.delete(key)})
 polls.set(key,promise);return promise
}
/**
 * One board sweep.
 *
 * Archived records are excluded: turn-in is the end of the work, their runs are terminal, and
 * reading them here walked 88 of this installation's 110 records on every five-second tick to
 * conclude nothing. Cleanup, which is the operation that does care about an archived Quest's
 * workspace, reads the archived view itself and is driven by filesystem events, not by this timer.
 */
async function sweepAll(store:QuestStore,host:any){
 const sweep:Sweep={}
 if(typeof host.active==='function')try{const value=unwrap(await boundedInspection(signal=>host.active({signal})));if(value&&typeof value==='object'&&!Array.isArray(value))sweep.active=value}catch{}
 let memo=observed.get(host);if(!memo){memo=new Map();observed.set(host,memo)}
 const now=Date.now(),observations:Record<string,any>={},live=new Set<string>()
 for(const {quest} of readAllQuests(store.projectRoot)){
  if(!quest||quest.state==='Archived')continue
  const key=store.runtime+'\0'+quest.id,fingerprint=questFingerprint(quest,sweep,now)
  live.add(key)
  if(memo.get(key)===fingerprint)continue
  Object.assign(observations,await reconcile(store,host,quest.id,sweep))
  // Recorded after the reconcile, from the record it produced: a settle that changed the Quest
  // leaves a different fingerprint, so the next tick re-reads it rather than trusting this one.
  const after=store.read(quest.id)
  memo.set(key,after?questFingerprint(after,sweep,now):fingerprint)
 }
 // A Quest that was archived or removed stops being remembered, so the memo tracks the board.
 for(const key of [...memo.keys()])if(key.startsWith(store.runtime+'\0')&&!live.has(key))memo.delete(key)
 return observations
}
