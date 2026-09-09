import {configureLearning,trackedStart,collectWorkflowOutcomes} from "./outcome-tracking"
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
import { QuestWorkspaces } from "./workspaces"
import { questChanges } from "./change-view"
import { startQuestRun,type QuestHost } from "./runtime"
import {toolSummary,toolDetail,toolSection} from './tool-projection'
export function typedQuestTool(store:QuestStore,host:QuestHost,options:{policyFile?:string;settingsFile?:string;startRun?:StartRun}={}) {
 const baseStart=options.startRun??startQuestRun(store,host,{policyFile:options.policyFile??configuredDispatchPolicyFile(),settingsFile:options.settingsFile})
 const start=trackedStart(store,baseStart,options.settingsFile)
 const continuation=new QuestContinuation(store,start,{verifyContext:async(context)=>{const result=await host.get({sessionID:context.sessionID});verifySourceBinding(context,(result?.data??result)?.location?.directory)}})
 const timer=setInterval(()=>void continuation.tick().then(()=>collectWorkflowOutcomes(store)).catch(error=>console.error('[quests] continuation failed',error)),5000);timer.unref()
 const workspaces=new QuestWorkspaces(store.runtime)
 const enrich=(view:any)=>({...view,workspaceSettings:workspaceSettings(options.settingsFile),workspacePreparation:workspaces.preparationStatus(view.project.id),continuation:continuation.status(view.id),changes:questChanges(store.read(view.id)!,workspaces)})
 return {name:"quest",output:{type:"object",additionalProperties:true},description:"Durable project work: list, get, create, update, run. Steps drive progress. For independent dependency-ready steps use run.continue with maxConcurrent (1â€“16, isolated worktrees); stepModels pins exact per-step routes and taskTags labels learning. Run manages worker workspace, route selection and dispatch internally. Set run.readOnly=true for bounded source research, including non-Git hubs; it permits inspection and assigned-step notes, without shell commands or file writes. Use update.workspaceMode (worktree/shared) for the global future-run setting; run.files reserves relative paths in shared mode. Use update for actual step results, artifacts and reward. Failures throw with a recovery reason; inspect an uncertain run before retrying.",input:QUEST_TOOL_INPUT,execute:async(input:any,context:any)=>{
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
  const trusted={project:workerLedgerProject(store,context.sessionID,directory,input.id)??projectIdentity(directory),directory:physicalDirectory(directory),sessionID:context.sessionID,requestID}
  if(input.action==='run'){
   if((input.run?.maxConcurrent!==undefined||input.run?.stepModels!==undefined)&&input.run?.continue!==true)throw new QuestError('INVALID_INPUT','Parallel options require run.continue')
   if((input.run?.maxConcurrent??1)>1&&workspaceSettings(options.settingsFile).workspaceMode!=='worktree')throw new QuestError('WORKSPACE_MODE_REQUIRED','Parallel continuation requires isolated worktrees')
   configureLearning(store,trusted,input.id,input.run?.taskTags,input.run?.maxConcurrent??1)
  }
  if(input.action==="update"&&input.update?.workspaceMode!==undefined){if(Object.keys(input.update).length!==1)throw new QuestError("INVALID_INPUT","Change workspaceMode separately from Quest content updates");if(input.id)questsAPI(store,trusted,start).get(input.id);const result=setWorkspaceMode(input.update.workspaceMode,options.settingsFile);if(!input.id)return {output:{workspaceSettings:result},content:JSON.stringify({workspaceSettings:result})};input={...input,update:{...input.update}};delete input.update.workspaceMode}
  if(!options.startRun&&!isWorker&&input.action!=="run"&&workspaceSettings(options.settingsFile).workspaceMode==="worktree")prepareWorkspaceLater(store.runtime,trusted.directory,options.policyFile??configuredDispatchPolicyFile())
  if(input.action==='run'&&input.run?.continue===true){const result=await continuation.run(input.id,{readOnly:input.run.readOnly,model:input.run.model,stepIDs:input.run.stepIDs,files:input.run.files,maxConcurrent:input.run.maxConcurrent,stepModels:input.run.stepModels},trusted);return {output:result,content:JSON.stringify(result)}}
  if(input.action==='update'&&input.update?.cancelContinuation===true){continuation.cancel(input.id,trusted);input={...input,update:{...input.update}};delete input.update.cancelContinuation}
  const api=questsAPI(store,trusted,start)
  let result:any
   switch(input.action){case "list":result=api.list(input.query);break;case "get":result=api.get(input.id);break;case "create":result=api.create(input.create);break;case "update":result=api.update(input.id,input.update);break;case "run":result=await api.run(input.id,input.run?{readOnly:input.run.readOnly,model:input.run.model,stepIDs:input.run.stepIDs,files:input.run.files}:undefined);break;default:throw new QuestError("INVALID_OPERATION","Use list, get, create, update or run")}
   if(['get','update'].includes(input.action)&&['changes','continuation'].includes(input.inspect?.section))result=enrich(result)
   if(input.action==='list')result={diagnostics:result.diagnostics.slice(0,10),items:result.items.map((item:any)=>toolSummary(store.read(item.id)!)),nextOffset:result.nextOffset,detail:'Use get with inspect.section for bounded full evidence'}
   if(['get','update'].includes(input.action)){
    const q=store.read(input.id)!
    if(input.inspect){const section=input.inspect.section;const values:any={description:q.description,reward:q.reward,steps:q.stages,runs:q.sessions,artifacts:q.evidence,changes:result.changes,continuation:result.continuation};if(!(section in values))throw new QuestError('INVALID_INPUT','Unknown inspect section');result={id:q.id,project:q.project,...toolSection(values[section],section,input.inspect.offset,input.inspect.limit)}}
    else result=toolDetail(q)
   }
   collectWorkflowOutcomes(store)
   const content=JSON.stringify(result)
  return {output:JSON.parse(content),content}
 }}
}
