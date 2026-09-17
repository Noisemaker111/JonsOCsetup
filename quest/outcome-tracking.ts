import {classifyDispatch} from '../models/task-demand'
import {readContinuations} from './runtime-queues'
import {TERMINAL_RUN} from './session-lineage'
import {workspaceSettings} from "./workspace-settings"
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {acquireLock} from './locking'
import {QuestStore} from './store'
import type {StartRun,QuestContext} from './api'
import {QuestError,questsAPI} from './api'
import {readSessionLedgerRows,beginWorkflowRun,observeWorkflowRun,readWorkflowOutcomes,TELEMETRY_FILE,type LedgerRow,type WorkflowRoute} from '../usage/telemetry-api'
export const workflowFile=()=>process.env.OPENCODE_WORKFLOW_OUTCOMES_FILE??TELEMETRY_FILE+'.workflows.json'
type Registration={questID:string;projectID:string;workflowTitle:string;runID:string;stepID:string;taskTags:string[];startedAt:number}
type Config={questID:string;tags:Record<string,string[]>;maxConcurrent:number}
type Tracking={version:1;configs:Config[];runs:Registration[]}
const file=(store:QuestStore)=>join(store.runtime,'workflow-tracking.json')
function read(store:QuestStore):Tracking{return existsSync(file(store))?JSON.parse(readFileSync(file(store),'utf8')):{version:1,configs:[],runs:[]}}
function change<T>(store:QuestStore,fn:(state:Tracking)=>T){const lock=acquireLock(store.runtime,'workflow-tracking');try{const state=read(store);if(state.version!==1||!Array.isArray(state.runs)||!Array.isArray(state.configs))throw Error('Workflow tracking is unreadable');const result=fn(state);mkdirSync(store.runtime,{recursive:true});const tmp=file(store)+'.tmp';writeFileSync(tmp,JSON.stringify(state));renameSync(tmp,file(store));return result}finally{lock.release()}}
export function configureLearning(store:QuestStore,context:QuestContext,questID:string,tags:Record<string,string[]>|undefined,maxConcurrent=1){
 const q=questsAPI(store,context,async()=>{throw Error('No launch')}).get(questID)
 if(tags!==undefined&&(!tags||Array.isArray(tags)||Object.entries(tags).some(([id,values])=>!q.steps.some(s=>s.id===id)||!Array.isArray(values)||!values.length||values.length>8||values.some(t=>typeof t!=='string'||!t.trim()||t.length>80))))throw new QuestError('INVALID_INPUT','taskTags must map existing steps to 1–8 short task categories')
 if(!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1)throw new QuestError("INVALID_INPUT","Invalid concurrency")
 const active=readContinuations(store.runtime).some((r:any)=>r.questID===questID&&!['done','stopped'].includes(r.state));
 change(store,state=>{const prior=state.configs.find(c=>c.questID===questID);if(active&&prior&&tags!==undefined&&JSON.stringify(prior.tags)!==JSON.stringify(tags))throw new QuestError('REQUEST_CONFLICT','Task labels are fixed while a continuation is active');if(prior){prior.tags=tags??prior.tags;prior.maxConcurrent=maxConcurrent}else state.configs.push({questID,tags:tags??{},maxConcurrent})})
}
/** Metadata is registered before launch; execution outcomes are read separately and never judged here. */
export function trackedStart(store:QuestStore,start:StartRun,settingsFile?:string):StartRun{return async input=>{
 const intents=readContinuations(store.runtime);const parallel=intents.some((r:any)=>r.questID===input.quest.id&&(r.maxConcurrent??1)>1&&(!['done','stopped'].includes(r.state)||r.admissions?.some((a:any)=>a.runID===input.runID)));if(parallel&&workspaceSettings(settingsFile).workspaceMode!=="worktree")throw new QuestError("WORKSPACE_MODE_REQUIRED","Parallel continuation requires isolated worktrees at every admission")
 change(store,state=>{if(state.runs.some(r=>r.runID===input.runID))return;const config=state.configs.find(c=>c.questID===input.quest.id);state.runs.push({questID:input.quest.id,projectID:input.context.project.id,workflowTitle:input.quest.title,runID:input.runID,stepID:input.stepIDs.join(','),taskTags:[...new Set(input.stepIDs.flatMap(id=>[classifyDispatch({task:input.task,readOnly:input.readOnly,questKind:input.quest.kind}).task,...(config?.tags[id]??[])]))],startedAt:Date.now()})})
 try{return await start(input)}finally{try{collectWorkflowOutcomes(store)}catch(error){console.error('[quests] workflow measurement failed',error)}}
}}
const keys=['input','cacheRead','cacheWrite','output','reasoning'] as const
const route=(r:LedgerRow):WorkflowRoute=>({accountID:r.accountID??'unknown',providerID:r.route.providerID,modelID:r.route.modelID,reasoning:r.route.reasoning??r.route.variant??'unknown',harness:r.route.harness??'unknown',version:'unknown',planRegime:r.regime??'unknown',serviceTier:r.route.serviceTier??'unknown'})
/**
 * Query only directly-owned native session records; host corroboration and descendants are not added twice.
 *
 * Every registration ever made stayed in `workflow-tracking.json`, and each one opened the 90 MB
 * telemetry sqlite to ask about a session whose outcome had been terminal for days: 258 registrations,
 * 1,273 ms of the host's JS thread, on every five-second sweep and again at the end of every Quest API
 * call. A terminal observation is immutable -- `observeWorkflowRun` refuses to change one -- so a run
 * that carries one has nothing left to measure. It is skipped before any ledger read and its
 * registration is dropped, because the outcomes file already holds its whole identity. What is left to
 * walk is the runs that have not finished.
 */
export function collectWorkflowOutcomes(store:QuestStore,options:{file?:string;now?:number;rows?:(sessionID:string)=>LedgerRow[]}={}){
 const target=options.file??workflowFile(),now=options.now??Date.now(),known=new Map(readWorkflowOutcomes(target).runs.map(r=>[r.runID,r])),quests=new Map<string,ReturnType<QuestStore['read']>>(),diagnostics:string[]=[];let observed=0
 const settled=new Set<string>()
 for(const meta of read(store).runs){try{
  const recorded=known.get(meta.runID)?.observation
  if(recorded&&recorded.state!=='running'){settled.add(meta.runID);continue}
  if(!quests.has(meta.questID))quests.set(meta.questID,store.read(meta.questID));const q=quests.get(meta.questID),run=q?.sessions.find(s=>s.runID===meta.runID),sessionID=run?.openCodeSessionId??run?.sessionID
  if(!q||!run||!sessionID)continue
  const raw=options.rows?options.rows(sessionID):readSessionLedgerRows(sessionID,meta.startedAt-1000,now)
  const records=[...new Map(raw.filter(r=>r.source==='opencode'&&r.sessionID===sessionID&&r.startedAt>=meta.startedAt-1000).map(r=>[r.id,r])).values()]
  if(records.some(r=>!Number.isFinite(r.at)||!Number.isFinite(r.startedAt)||r.at>now||r.at<r.startedAt)||!Number.isFinite(Date.parse(run.updatedAt))||Date.parse(run.updatedAt)>now)throw Error('Invalid or future observation timestamp')
  const prior=known.get(meta.runID),first=records[0]
  // A run the reconciler settled as `stale` or `missing` is over; the workflow record has no such
  // verdict, so it is recorded as cancelled rather than left running. Without this its registration
  // never settled, and every collection reopened the telemetry ledger for it for the life of the
  // installation -- 79 of this machine's 258 registrations were in exactly that state.
  const ended=TERMINAL_RUN.has(run.state)?(['completed','failed','cancelled'].includes(run.state)?run.state as 'completed'|'failed'|'cancelled':'cancelled'):undefined
  if(!first&&!ended)continue
  const identity=prior?.route??(first?route(first):{accountID:'unknown',providerID:run.providerID??'unknown',modelID:run.modelID??'unknown',reasoning:run.reasoningEffort??'unknown',harness:run.runtime??'unknown',version:'unknown',serviceTier:'unknown'})
  const mismatch=prior?.observation?.routeConsistent===false||records.some(r=>{const actual=route(r);return Object.keys(identity).some(k=>actual[k as keyof WorkflowRoute]!==identity[k as keyof WorkflowRoute])})
  if(mismatch)diagnostics.push('Changed or mixed route in '+meta.runID+'; token attribution withheld')
  if(!prior)beginWorkflowRun(target,{...meta,workflowID:meta.questID,sessionID,route:identity})
  const terminal=!!ended&&records.every(r=>r.state!=='running')
  const completedAt=prior?.observation?.completedAt??Math.max(meta.startedAt,Date.parse(run.updatedAt),...records.map(r=>r.at))
  const tokens=Object.fromEntries(keys.map(k=>[k,!mismatch&&records.length&&records.every(r=>r.tokens[k]!==null&&Number.isSafeInteger(r.tokens[k])&&r.tokens[k]!>=0)?records.reduce((n,r)=>n+r.tokens[k]!,0):null])) as any
  // A previously settled record must not be reopened by a late running telemetry row.
  if(prior?.observation?.state!=='running'&&prior?.observation&&!terminal)continue
  if(prior?.observation&&now<=prior.observation.observedAt)continue
  const previous=prior?.observation;if(previous&&previous.state===(terminal?ended:'running')&&previous.completedAt===(terminal?completedAt:undefined)&&previous.routeConsistent===!mismatch&&keys.every(k=>previous.tokens[k]===tokens[k]))continue
  observeWorkflowRun(target,{runID:meta.runID,observedAt:now,state:terminal?ended!:'running',...(terminal?{completedAt}:{}),routeConsistent:!mismatch,tokens,reviewMilliseconds:prior?.observation?.reviewMilliseconds??null,integrationMilliseconds:prior?.observation?.integrationMilliseconds??null});observed++
  if(terminal)settled.add(meta.runID)
 }catch(error){diagnostics.push(meta.runID+': '+(error instanceof Error?error.message:String(error)))}}
 // The outcomes file is the record; the tracking file is the worklist. Dropping a finished run keeps
 // the worklist the length of the work actually outstanding instead of the length of this
 // installation's history.
 if(settled.size)change(store,state=>{state.runs=state.runs.filter(r=>!settled.has(r.runID))})
 return {observed,diagnostics,settled:settled.size}
}
