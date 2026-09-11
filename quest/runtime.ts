import {verifyGiverBinding} from './user-giver'
import {researchGuardReady} from "./shared-guard"
import {assertBurnLaunchAllowed} from "../usage/telemetry-api"
import {workspaceSettings} from "./workspace-settings"
import { normalizeArtifact } from "./artifacts"
import { configuredCommand, runKnownCommand } from "./command-runtime"
import { realpathSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { QuestError,type StartRun } from "./api"
import { QuestStore } from "./store"
import { QuestWorkspaces } from "./workspaces"
import { reserveDispatch, dispatchReservationFile } from "../models/dispatch-planner"
import { workspaceRunID } from "./change-view"
import { verifySourceBinding } from "./project"
import { editingSource } from "./source-binding"
export type QuestHost = { create:(input:any)=>Promise<any>;get:(input:any)=>Promise<any>;prompt:(input:any)=>Promise<any> }
const unwrap=(value:any)=>value?.data??value
const samePath=(a:string,b:string)=>process.platform==="win32"?realpathSync(a).toLowerCase()===realpathSync(b).toLowerCase():realpathSync(a)===realpathSync(b)
/** Creates a session at the owned location before any prompt can execute. No parent-location mutation. */
export function startQuestRun(store:QuestStore,host:QuestHost,options:{policyFile:string;settingsFile?:string;reserve?:typeof reserveDispatch;beforePrompt?:typeof assertBurnLaunchAllowed}):StartRun {
 const workspaces=new QuestWorkspaces(store.runtime)
 return async input=>{
  let mode: "worktree"|"shared"
  let directory:string
  try{const owner=unwrap(await host.get({sessionID:input.context.sessionID}));directory=input.context.directory??owner?.location?.directory;if(input.context.giverDirectory)verifyGiverBinding(store,input.context,owner);else if(input.context.directory)verifySourceBinding(input.context,directory);else verifySourceBinding({...input.context,directory},directory)}catch(error){throw new QuestError("SOURCE_BINDING_FAILED",error instanceof Error?error.message:String(error))}
  try{mode=workspaceSettings(options.settingsFile).workspaceMode}catch(error){throw new QuestError("WORKSPACE_SETTINGS_INVALID",error instanceof Error?error.message:String(error))}
  if(input.readOnly&&!researchGuardReady(host))throw new QuestError("RESEARCH_GUARD_UNAVAILABLE","The host has no verified read-only research guard; no worker was started")
  const source=input.readOnly?undefined:editingSource({project:input.context.project,directory},options.policyFile,input.files)
  const allocate=(bootstrap?:string[])=>input.readOnly?workspaces.createResearch({runID:input.runID,questID:input.quest.id,directory,project:input.context.project}):mode==="shared"?workspaces.createShared({runID:input.runID,questID:input.quest.id,directory:source!.source,project:source!.project,files:source!.files,inheritRunIDs:inherited,store}):workspaces.create({runID:input.runID,questID:input.quest.id,directory:source!.source,project:source!.project,inheritRunIDs:inherited,bootstrap})
  const assigned=input.quest.stages.filter(s=>input.stepIDs.includes(s.id))
  if(input.readOnly&&assigned.some(s=>s.commandID))throw new QuestError("RESEARCH_COMMAND_DENIED","Read-only research cannot execute configured commands")
  const dependencyIDs = new Set<string>()
  const visit = (id:string) => { if(dependencyIDs.has(id))return;dependencyIDs.add(id);for(const parent of input.quest.stages.find(s=>s.id===id)?.needs??[])visit(parent) }
  for(const step of assigned)for(const id of step.needs)visit(id)
  const inheritRunIDs:string[]=[]
  for(const id of dependencyIDs){
    const run=[...input.quest.sessions].reverse().find(s=>s.deliverables.includes(id)&&s.runID)
    if(!run)continue // A manually completed step can have no worker changes.
    if(run.state!=="completed")throw new QuestError("DEPENDENCY_RUNNING","Dependency worker must finish before its changes can be snapshotted: "+id)
     if(workspaceRunID(run.runID!))inheritRunIDs.push(run.runID!)
  }
  const retry=[...input.quest.sessions].reverse().find(s=>["failed","cancelled"].includes(s.state)&&s.runID&&s.deliverables.some(id=>input.stepIDs.includes(id)))
   if(retry?.runID&&workspaceRunID(retry.runID)&&workspaces.get(retry.runID))inheritRunIDs.push(retry.runID)
  const inherited=[...new Set(inheritRunIDs)].filter(id=>workspaces.get(id)?.mode!=="research")
  if(assigned.some(s=>s.commandID)) {
   if(input.model)throw new QuestError("EXPLICIT_MODEL_CONFLICT","Configured command steps do not use a model; the explicit model was not substituted")
   if(assigned.some(s=>!s.commandID))throw new QuestError("MIXED_EXECUTION","Run configured command steps separately from model work")
   let workspace:ReturnType<QuestWorkspaces["create"]>
   const sessionID="command_"+input.runID
   try{const policy=JSON.parse(readFileSync(options.policyFile,"utf8")),commands=assigned.map(s=>configuredCommand(options.policyFile,input.context.project.id,s.commandID!));workspace=allocate(policy.bootstrapByProject?.[input.context.project.id])
    if(!input.readOnly)workspaces.assertPreparedSource(workspace)
    store.apply(input.quest.id,"session-claimed",{callID:input.runID,runID:input.runID,sessionID,parentID:input.context.sessionID,agentRole:"command",role:"command",scope:{repo:workspace.root,worktree:workspace.path,branch:workspace.branch,files:workspace.fileScopes??source?.files??input.files??["."],requestedFiles:input.files??["."],readOnly:input.readOnly===true,workspaceMode:workspace.mode??"worktree"}},"quest:command")
    for(const [index,command] of commands.entries()){const step=assigned[index];store.apply(input.quest.id,"stage-state",{stageID:step.id,status:"working"},"quest:command");const result=await runKnownCommand(command,workspace.path,join(store.runtime,"command-logs",input.runID+"-"+index+".log"));const ok=result.exitCode===0&&!result.timedOut;const summary=command.description+": "+(result.timedOut?"timed out":"exit "+result.exitCode)+" in "+result.milliseconds+"ms";store.apply(input.quest.id,"stage-state",{stageID:step.id,status:ok?"done":"blocked",evidence:summary},"quest:command");const q=store.read(input.quest.id)!;store.apply(q.id,"patched",{evidence:{...q.evidence,artifacts:[...q.evidence.artifacts,normalizeArtifact({name:command.description,path:result.logFile,verified:true})]}},"quest:command");if(!ok)throw new QuestError("COMMAND_FAILED",summary)}
     for(const step of assigned)store.apply(input.quest.id,'proof-added',{stageID:step.id,proof:{id:input.runID+':'+step.id,kind:'command',at:new Date().toISOString(),attempt:step.attempt,result:'passed',command:step.commandID,verified:true}},'quest:command')
     workspaces.collect(input.runID);workspaces.releaseShared(input.runID,store,"Configured command finished");store.apply(input.quest.id,"session-state",{callID:input.runID,state:"completed",result:"Configured commands completed; output artifacts recorded"},"quest:command");return {sessionID}
   }catch(e){
    for(const step of assigned){const current=store.read(input.quest.id)?.stages.find(s=>s.id===step.id);if(current?.status==="working")store.apply(input.quest.id,"stage-state",{stageID:step.id,status:"blocked",evidence:e instanceof Error?e.message:String(e)},"quest:command")}
    try{if(workspaces.get(input.runID)){workspaces.collect(input.runID);workspaces.releaseShared(input.runID,store,"Configured command terminated")}}catch{}
    if(e instanceof QuestError)throw e;throw new QuestError("COMMAND_FAILED",e instanceof Error?e.message:String(e))
   }
  }
  let selected:Awaited<ReturnType<typeof reserveDispatch>>
  try{selected=await(options.reserve??reserveDispatch)({runID:input.runID,model:input.model,policyFile:options.policyFile,reservationFile:dispatchReservationFile(store.runtime)})}catch(e){throw new QuestError("ROUTE_UNAVAILABLE",e instanceof Error?e.message:String(e),false,input.runID)}
  let sessionID:string|undefined,promptAttempted=false
  try{
   if(selected.route.serviceTier!=="default")throw new QuestError("SERVICE_TIER_UNAVAILABLE","The configured service tier cannot be represented by this host adapter; no default tier was substituted")
   if(selected.route.harness!=="native")throw new QuestError("HARNESS_UNAVAILABLE","This dispatch adapter requires a configured native route; the requested harness was not substituted")
   const workspace=allocate(selected.bootstrapByProject[input.context.project.id])
   const model={providerID:selected.route.providerID,id:selected.route.modelID,...(selected.route.reasoning!=="unknown"?{variant:selected.route.reasoning}:{})}
   const created=unwrap(await host.create({title:"Worker · "+input.quest.title,agent:selected.route.agent??"general",model,location:{directory:realpathSync.native(workspace.path)}}));sessionID=created?.id
   if(!sessionID)throw new QuestError("DISPATCH_OUTCOME_UNKNOWN","Host did not return a worker session identity; workspace and reservation retained")
   const actual=unwrap(await host.get({sessionID})),directory=actual?.location?.directory
   if(typeof directory!=="string"||!samePath(directory,workspace.path))throw new QuestError("WORKSPACE_BINDING_FAILED","Worker session is not bound to its owned worktree; no prompt was sent")
   if(actual?.model?.providerID!==model.providerID||actual?.model?.id!==model.id||model.variant!==undefined&&actual?.model?.variant!==model.variant)throw new QuestError("ROUTE_BINDING_FAILED","Host did not bind the selected model/variant; no prompt was sent")
   if(selected.route.agent && actual?.agent!==selected.route.agent)throw new QuestError("AGENT_BINDING_FAILED","Host did not bind the selected worker role; no prompt was sent")
   store.apply(input.quest.id,"session-claimed",{callID:input.runID,runID:input.runID,sessionID,parentID:input.context.sessionID,model:input.model??selected.route.providerID+"/"+selected.route.modelID,agentRole:selected.route.agent??"general",providerID:selected.route.providerID,modelID:selected.route.modelID,reasoningEffort:selected.route.reasoning,runtime:"native",scope:{repo:workspace.root,worktree:workspace.path,branch:workspace.branch,files:workspace.fileScopes??source?.files??input.files??["."],requestedFiles:input.files??["."],readOnly:input.readOnly===true,workspaceMode:workspace.mode??"worktree"}},"quest:runtime")
   if(selected.decision?.fallback || selected.route.admission === "configured-choice" && selected.decision)store.apply(input.quest.id,"session-state",{callID:input.runID,state:"executing",routingNote:selected.decision.summary,evidence:selected.decision.summary},"quest:routing")
   const steps=input.quest.stages.filter(s=>input.stepIDs.includes(s.id))
   const prompt=[...(input.readOnly?["This is enforced read-only research. Inspect source and instructions, then record findings and acceptance criteria in assigned Quest step notes. Shell commands, source writes and delegation are unavailable. Native Code Mode execute and assigned Quest updates remain available. Do not report missing editing tools as a blocker for this research assignment."]:[]),input.readOnly?"You are a research worker, not the Quest Giver. Read relevant files and report bounded findings through assigned Quest steps; do not spawn workers or create Quests.":"You are the implementation worker, not the Quest Giver. Before implementation check editing and shell capabilities. Any exposed authorized patch, edit or write tool satisfies editing; a missing alias alone is not a blocker. If unavailable, load help-i-cant-work-right, record the blocker and stop without marking steps done. Implement assigned work, inspect checks and report evidence. Do not spawn workers or create Quests.","Dispatch identity: agent "+(selected.route.agent??"general")+", provider "+selected.route.providerID+", model "+selected.route.modelID+", reasoning "+selected.route.reasoning+". These are the bound launch settings; distinguish them from independently observed host metadata.","Quest "+input.quest.id+": "+input.quest.title,input.quest.description??input.quest.objective,"Assigned steps:",...steps.map(s=>s.id+": "+s.title+(s.detail?"\n"+s.detail:"")),"Workspace: "+workspace.path+". "+(source?.scopePrefix?"Quest and step text name paths under "+source.scopePrefix+"/, but this workspace is rooted at that directory: drop the "+source.scopePrefix+"/ prefix. "+source.scopePrefix+"/models/x.md is models/x.md here. ":"")+(input.readOnly?"Read-only source directory; no editing ownership or bootstrap is required":workspace.mode==="shared"?"Shared checkout. Edit only reserved paths: "+workspace.fileScopes!.join(", ")+". Other workers may edit other files. Preserve their changes. Dependency setup, commits and other Git index/branch operations require exclusive whole-checkout ownership; do not run them while assigned a partial scope.":"Ownership and bootstrap were checked by dispatch")+(workspace.physicalRunID?"; prepared spare, base "+workspace.base.slice(0,12):"")+(input.readOnly?". Read applicable project instructions and relevant source files. Report findings without modifying source or running commands.":". Use relative paths in commands and reports. Read applicable project instructions and only task-relevant documentation; proceed to implementation without repeating repository inventory or dependency installation unless a concrete check fails.")+" Quest is a Code Mode tool: if it is not shown in the partial catalog, call execute with code that returns search({namespace:\"quest\",query:\"quest update get\",limit:1}) to discover its signature, then call execute with code using tools.quest. A catalog entry with none shown is discoverable, not missing. Discover before reporting an unavailable tool. Update these steps with actual results using quest update; keep unfinished work pending or blocked. Preserve user changes. Do not publish, merge or release without existing explicit authorization. Save assigned-step results using only update.steps entries with id, state and note. Put artifact paths and check evidence in note; the giver attaches global artifacts/reward and changes step definitions. Do not include artifacts, reward, detail or other keys in a worker update. After updating, get the Quest and verify the saved step state before claiming completion. If an update fails, no result was saved; correct the input and retry that update within the same assignment."].join("\n\n")
   if(!input.readOnly)workspaces.assertPreparedSource(workspace)
   await (options.beforePrompt??assertBurnLaunchAllowed)(selected.route.accountID)
   promptAttempted=true
   await host.prompt({sessionID,text:prompt})
   for(const step of steps){const current=store.read(input.quest.id)?.stages.find(s=>s.id===step.id);if(current?.status==="pending")store.apply(input.quest.id,"stage-state",{stageID:step.id,status:"working"},"quest:runtime")}
   workspaces.collect(input.runID)
   return {sessionID}
  }catch(e){
   if(!promptAttempted&&!(e instanceof QuestError&&e.code==="DISPATCH_OUTCOME_UNKNOWN"))try{workspaces.releaseShared(input.runID,store,"Known preprompt failure")}catch{}
   selected.ledger.settle(input.runID,{state:promptAttempted||e instanceof QuestError&&e.code==="DISPATCH_OUTCOME_UNKNOWN"?"unknown":"cancelled"})
   if(e instanceof QuestError)throw e
   throw new QuestError(promptAttempted?"DISPATCH_OUTCOME_UNKNOWN":"WORKSPACE_PREPARATION_FAILED",e instanceof Error?e.message:String(e),false,input.runID)
  }
 }
}
