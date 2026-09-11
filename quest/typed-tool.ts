import {cleanupQuests,cleanupStatus,installQuestCleanup} from "./cleanup"
import {bindUserGiver,userGiverID,giverContext,adoptQuestGiver,verifyGiverBinding} from './user-giver'
import { reconcileWorkers, inspectWorker } from "./worker-inspection"
import {configureLearning,collectWorkflowOutcomes} from "./outcome-tracking"
import {workspaceSettings,setWorkspaceMode} from "./workspace-settings"
import { prepareWorkspaceLater } from "./workspace-pool"
import { QuestContinuation } from './continuation'
import { readAllQuests } from './index'
import {QUEST_TOOL_INPUT} from "./tool-schema.mjs"
import { configuredDispatchPolicyFile } from "../models/dispatch-planner"
import { join } from "node:path"
import { questsAPI,QuestError,type StartRun } from "./api"
import { QuestStore } from "./store"
import { projectIdentity, physicalDirectory, verifySourceBinding } from "./project"
import { workerLedgerProject } from "./source-binding"
import { questDispatch } from "./dispatch"
import { QuestWorkspaces } from "./workspaces"
import { questChanges } from "./change-view"
import type { QuestHost } from "./runtime"
import {toolSummary,toolDetail,toolSection} from './tool-projection'
import {activeRuns,awaitQuestChange,observedState,pollDecision,runSummary,unchangedRefusal,waitSteering,DEFAULT_WAIT_SECONDS,MAX_WAIT_SECONDS,type SeenRequest} from './wait'
/**
 * One session's memory of what a given request already told it.
 *
 * Keyed by the exact projection as well as the Quest, so paging through inspect offsets is never
 * mistaken for a repeat. Bounded because a server process outlives many sessions; evicting the
 * oldest entry costs at most one extra get.
 */
const SEEN_LIMIT=500
const rememberKey=(sessionID:string,questID:string,inspect:any,runID?:string)=>sessionID+'|'+questID+'|'+(runID??'')+'|'+(inspect?.section?`${inspect.section}:${inspect.offset??0}:${inspect.limit??8000}`:'detail')
export function typedQuestTool(store:QuestStore,host:QuestHost,options:{policyFile?:string;settingsFile?:string;startRun?:StartRun}={}) {
 const {start,returns}=questDispatch(store,host,options)
 const continuation=new QuestContinuation(store,start,{verifyContext:async(context)=>{const result=await host.get({sessionID:context.sessionID});verifyGiverBinding(store,context,result?.data??result)}})
 let polling=false
 const tick=async()=>{if(polling)return;polling=true;try{await reconcileWorkers(store,host);await continuation.tick();await returns.tick();collectWorkflowOutcomes(store)}catch(error){console.error('[quests] inspection/continuation failed',error)}finally{polling=false}}
 installQuestCleanup(store,host)
 const timer=setInterval(()=>void tick(),5000);timer.unref()
 const workspaces=new QuestWorkspaces(store.runtime)
 const enrich=(view:any)=>({...view,workspaceSettings:workspaceSettings(options.settingsFile),workspacePreparation:workspaces.preparationStatus(view.project.id),continuation:continuation.status(view.id),changes:questChanges(store.read(view.id)!,workspaces)})
 const seen=new Map<string,SeenRequest>()
 const remember=(key:string,fingerprint:string,waited=false)=>{seen.delete(key);seen.set(key,{fingerprint,waited});if(seen.size>SEEN_LIMIT)seen.delete(seen.keys().next().value as string)}
 return {name:"quest",options:{pinned:true},output:{type:"object",additionalProperties:true},description:"One persistent user Quest Giver across projects: list, get, create, update, run, wait. Select a project with project_select before creating cross-project work; get/update/run use the Quest’s recorded project without opening another giver. Steps drive progress. For independent dependency-ready steps use run.continue with maxConcurrent (positive integer, isolated worktrees; no fixed subscription account cap when authorized by dispatch policy); stepModels pins exact per-step routes and taskTags labels learning. Run manages worker workspace, route selection and dispatch internally. Set run.readOnly=true for bounded source research, including non-Git hubs; it permits inspection and assigned-step notes, without shell commands or file writes. Set run.task to what the step is - coding, review, planning or utility - so route and reasoning effort are chosen for that work; it never names a model, and omitting it keeps the default coding demand. Use update.workspaceMode (worktree/shared) for the global future-run setting; run.files reserves relative paths in shared mode. Use update for actual step results, artifacts and reward. For live progress use get with inspect.section runs: host observations are separate from saved run states. Never poll a running worker with repeated get: use action=wait (wait.runID, wait.timeoutSeconds, default 120, max 600), which blocks until the Quest actually changes and returns the same view plus live worker observations. Better still, end the turn — a run reaching completed, failed or cancelled wakes this session automatically with an \"Automatic Quest worker update\". A get that would return exactly what this session already has for a Quest with an active run is turned into that wait, and repeating it after the wait is refused. Failures throw with a recovery reason; inspect an uncertain run before retrying.",input:QUEST_TOOL_INPUT,execute:async(input:any,context:any)=>{
  const waitRequest=input.action==='wait'?(input.wait??{}):undefined
  if(waitRequest){if(!input.id)throw new QuestError('INVALID_INPUT','wait needs the Quest id to block on');input={...input,action:'get'}}
  if(["get","run"].includes(input.action))await reconcileWorkers(store,host)
  const requestID=context?.id??context?.callID
  if(!context?.sessionID||!requestID)throw new QuestError("HOST_CONTEXT_REQUIRED","Host must supply a session and tool call identity")
  const session=await host.get({sessionID:context.sessionID}),directory=(session?.data??session)?.location?.directory
   const memberships=readAllQuests(store.projectRoot,{includeArchived:true}).flatMap(row=>row.quest?row.quest.sessions.filter(s=>s.openCodeSessionId===context.sessionID||s.sessionID===context.sessionID).map(s=>({questID:row.quest!.id,stepIDs:['planned','executing','waiting'].includes(s.state)?s.deliverables.filter(id=>row.quest!.sessions.findLast(other=>other.deliverables.includes(id))===s):[]})):[])
   const isWorker=memberships.length>0
   if(isWorker&&(input.action==='run'||input.action==='create'||input.update?.cancelContinuation===true||input.update?.workspaceMode!==undefined))throw new QuestError('WORKER_DELEGATION_DENIED','Workers update assigned work; only givers create Quests or dispatch workers')
   if(isWorker&&input.action==='update'){
    const allowed=new Set(memberships.filter(m=>m.questID===input.id).flatMap(m=>m.stepIDs))
    if(!allowed.size||Object.keys(input.update??{}).some(k=>k!=='steps')||input.update?.steps?.some((s:any)=>!allowed.has(s.id)||Object.keys(s).some(k=>!['id','state','note'].includes(k))||typeof s.note==='string'&&s.note.length>8000))throw new QuestError('WORKER_ASSIGNMENT_DENIED','No Quest changes were saved. Workers may report only current assigned step states using update:{steps:[{id:<assigned step>,state:<state>,note:<evidence>}]}. Remove artifacts, reward, detail and all other keys; put artifact paths in note. Retry the corrected update, then get the Quest to verify it. The giver attaches global artifacts/reward and changes definitions.')
   }
  if(!isWorker&&(session?.data??session)?.agent==='quest-giver'&&!userGiverID(store))await bindUserGiver(store,host,context.sessionID)
  if(!isWorker&&userGiverID(store)&&userGiverID(store)!==context.sessionID&&['create','update','run'].includes(input.action))throw new QuestError('SINGLE_GIVER_REQUIRED','Continue in your one Quest Giver: '+userGiverID(store))
  const trusted=isWorker?{project:workerLedgerProject(store,context.sessionID,directory,input.id)??projectIdentity(directory),directory:physicalDirectory(directory),sessionID:context.sessionID,requestID}:giverContext(store,{...(session?.data??session),id:context.sessionID},requestID,input.id)
  if(!isWorker&&trusted.giverDirectory&&input.id)adoptQuestGiver(store,input.id)
  if(input.action==='run'){
   if((input.run?.maxConcurrent!==undefined||input.run?.stepModels!==undefined)&&input.run?.continue!==true)throw new QuestError('INVALID_INPUT','Parallel options require run.continue')
   if((input.run?.maxConcurrent??1)>1&&workspaceSettings(options.settingsFile).workspaceMode!=='worktree')throw new QuestError('WORKSPACE_MODE_REQUIRED','Parallel continuation requires isolated worktrees')
   configureLearning(store,trusted,input.id,input.run?.taskTags,input.run?.maxConcurrent??1)
  }
  if(input.action==="update"&&input.update?.workspaceMode!==undefined){if(Object.keys(input.update).length!==1)throw new QuestError("INVALID_INPUT","Change workspaceMode separately from Quest content updates");if(input.id)questsAPI(store,trusted,start).get(input.id);const result=setWorkspaceMode(input.update.workspaceMode,options.settingsFile);if(!input.id)return {output:{workspaceSettings:result},content:JSON.stringify({workspaceSettings:result})};input={...input,update:{...input.update}};delete input.update.workspaceMode}
  if(!options.startRun&&!isWorker&&input.action!=="run"&&workspaceSettings(options.settingsFile).workspaceMode==="worktree")prepareWorkspaceLater(store.runtime,trusted.directory,options.policyFile??configuredDispatchPolicyFile())
  if(input.action==='run'&&input.run?.continue===true){const result=await continuation.run(input.id,{readOnly:input.run.readOnly,task:input.run.task,model:input.run.model,stepIDs:input.run.stepIDs,files:input.run.files,maxConcurrent:input.run.maxConcurrent,stepModels:input.run.stepModels},trusted);return {output:result,content:JSON.stringify(result)}}
  if(input.action==='update'&&input.update?.cancelContinuation===true){continuation.cancel(input.id,trusted);input={...input,update:{...input.update}};delete input.update.cancelContinuation}
  const api=questsAPI(store,trusted,start)
  let result:any
   switch(input.action){case "list":result=api.list({...(trusted.giverDirectory?{allProjects:true}:{}),...input.query});break;case "get":result=api.get(input.id);break;case "create":result=api.create(input.create);if(trusted.giverDirectory){const q=store.read(result.id)!;store.apply(q.id,'patched',{extensions:{...q.extensions,giverSourceDirectory:trusted.directory}},'quest:user-giver-source')}break;case "update":result=api.update(input.id,input.update);await cleanupQuests(store,host,input.id);break;case "run":result=await api.run(input.id,input.run?{readOnly:input.run.readOnly,task:input.run.task,model:input.run.model,stepIDs:input.run.stepIDs,files:input.run.files}:undefined);break;default:throw new QuestError("INVALID_OPERATION","Use list, get, create, update, run or wait")}
   /**
    * Waiting, where the giver used to poll.
    *
    * A get that can only return what this session already holds is not answered again: while a run
    * is still active it becomes a bounded block on the saved state changing, and a repeat after
    * that block has already run out is refused with the return path named. Workers are exempt --
    * their own get verifies an update they just saved, so it always has something new to read.
    */
   let waited:any
   if(input.action==='get'&&input.id&&(waitRequest||!isWorker)){
    const runID=waitRequest?.runID
    const key=rememberKey(context.sessionID,input.id,input.inspect,runID)
    const before=store.read(input.id)
    if(before){
     const fingerprint=observedState(before,runID)
     const decision=pollDecision({fingerprint,seen:seen.get(key),activeRuns:activeRuns(before,runID).length,explicitWait:!!waitRequest})
     if(decision==='refuse')throw new QuestError('QUEST_UNCHANGED',unchangedRefusal(before,runID))
     const blocking=decision==='wait'
     let outcome={changed:false,quest:before as any,milliseconds:0}
     if(blocking){
      const seconds=Math.min(Math.max(Math.round(waitRequest?.timeoutSeconds??DEFAULT_WAIT_SECONDS),1),MAX_WAIT_SECONDS)
      let announced=0
      outcome=await awaitQuestChange({read:()=>store.read(input.id),fingerprint,runID,deadline:Date.now()+seconds*1000,reconcile:()=>reconcileWorkers(store,host),
       onWaiting:ms=>{if(ms-announced<10000)return;announced=ms;try{void Promise.resolve(context?.progress?.({questID:input.id,runID,waitingSeconds:Math.round(ms/1000)})).catch(()=>{})}catch{}}})
     }
     const after=outcome.quest??store.read(input.id)
     if(!after)throw new QuestError('QUEST_REMOVED','The Quest was removed while waiting: '+input.id)
     if(outcome.changed)result=api.get(input.id)
     if(blocking||waitRequest)waited={milliseconds:outcome.milliseconds,changed:outcome.changed,
      runs:await Promise.all(activeRuns(after,runID).slice(0,5).map(async run=>({...runSummary(run),observation:await inspectWorker(host,run)}))),
      ...(blocking?outcome.changed?{}:{steering:waitSteering(after,runID,outcome.milliseconds)}:{settled:true,steering:'No active run to wait for; this is the settled saved state.'})}
     remember(key,observedState(after,runID),blocking&&!outcome.changed)
    }
   }
   if(['get','update'].includes(input.action)&&['changes','continuation'].includes(input.inspect?.section))result=enrich(result)
   if(input.action==='list')result={diagnostics:result.diagnostics.slice(0,10),items:result.items.map((item:any)=>toolSummary(store.read(item.id)!)),nextOffset:result.nextOffset,detail:'Use get with inspect.section for bounded full evidence'}
   if(['get','update'].includes(input.action)){
    const q=store.read(input.id)!
    if(input.inspect?.section==='cleanup')await cleanupQuests(store,host,input.id)
    if(input.inspect){const section=input.inspect.section;const values:any={cleanup:cleanupStatus(store,q),description:q.description,reward:q.reward,steps:q.stages,runs:await Promise.all(q.sessions.map(async run=>({...run,observation:await inspectWorker(host,run)}))),artifacts:q.evidence,changes:result.changes,continuation:result.continuation};if(!(section in values))throw new QuestError('INVALID_INPUT','Unknown inspect section');result={id:q.id,project:q.project,...toolSection(values[section],section,input.inspect.offset,input.inspect.limit)}}
    else result={...toolDetail(q),cleanup:cleanupStatus(store,q)}
   }
   if(waited)result={...result,waited}
   collectWorkflowOutcomes(store)
   const content=JSON.stringify(result)
  return {output:JSON.parse(content),content}
 }}
}
