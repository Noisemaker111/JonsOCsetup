import { consumeQuestStarts, requestQuestStart, requestQuestReview } from './start-request'
import { devQueueGeneration } from './runtime-queues'
import { questOperations, coordinatorInput } from './operations.mjs'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import { readUserGiver } from './giver-registry.mjs'
import {cleanupQuests,cleanupStatus,installQuestCleanup} from "./cleanup"
import {bindUserGiver,userGiverID,giverContext,adoptQuestGiver,verifyGiverBinding} from './user-giver'
import { reconcileWorkers, inspectWorker } from "./worker-inspection"
import {configureLearning,collectWorkflowOutcomes} from "./outcome-tracking"
import {workspaceSettings} from "./workspace-settings"
import { QuestContinuation } from './continuation'
import { readAllQuests } from './index'
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
import {toolSummary,toolDetail,toolSection,toolStatus,toolPlan} from './tool-projection'
import {activeRuns,awaitQuestChange,observedState,runSummary,waitSteering,DEFAULT_WAIT_SECONDS,MAX_WAIT_SECONDS} from './wait'
import {giverInstruction} from './giver-instruction'
const validator=new AjvJsonSchemaValidator()
const validators=new Map(Object.entries(questOperations).map(([name,op])=>[name,validator.getValidator(op.input)]))
const unwrap=(value:any)=>value?.data??value
async function originatingUserTurn(store:QuestStore,host:QuestHost,sessionID:string,messageID:unknown):Promise<string>{
 if(typeof host.context!=='function')throw new QuestError('GIVER_TURN_REQUIRED','No Quest was created. The host did not provide the message history needed to identify this giver instruction.')
 let messages:any
 try{messages=unwrap(await host.context({sessionID}))}catch(error){throw new QuestError('GIVER_TURN_REQUIRED','No Quest was created. The giver instruction boundary could not be read: '+String(error))}
 if(!Array.isArray(messages))throw new QuestError('GIVER_TURN_REQUIRED','No Quest was created. The host returned no message history for this giver instruction.')
 const type=(message:any)=>message?.type
 // The supported native MCP transport supplies sessionID, but no messageID. Its
 // call runs inside the session's current assistant; queued prompts are not yet
 // in persisted context. Use that assistant, never a model-provided argument.
 const index=typeof messageID==='string'?messages.findIndex(message=>message?.id===messageID):messages.findLastIndex(message=>type(message)==='assistant')
 if(index<0)throw new QuestError('GIVER_TURN_REQUIRED','No Quest was created. The current assistant message is absent from the persisted giver history.')
 const instruction=giverInstruction(store.runtime,sessionID,messages,index)
 if(instruction)return instruction
 throw new QuestError('GIVER_TURN_REQUIRED','No Quest was created. Neither the current host context nor delivered inbox evidence identifies the originating giver instruction. Inspect the host event connection before retrying.')
}
export function createQuestService(store:QuestStore,host:QuestHost,options:{policyFile?:string;settingsFile?:string;startRun?:StartRun;directory?:string;onDispose?:(dispose:()=>void)=>void}={}) {
 const {start,returns}=questDispatch(store,host,options)
 const continuation=new QuestContinuation(store,start,{verifyContext:async(context)=>{const result=await host.get({sessionID:context.sessionID});verifyGiverBinding(store,context,result?.data??result)}})
 const poll=(name:string,run:()=>Promise<unknown>)=>{
  let running=false
  return async()=>{
   if(running)return
   running=true
   try{await run()}catch(error){console.error('[quests] '+name+' failed',error)}finally{running=false}
  }
 }
 // Inspection of unrelated historical sessions cannot hold new admissions, continuation or delivery.
 // Each operation retains its own exclusion so a slow call is never duplicated by the next timer.
 const polls=[
  poll('start admission',()=>consumeQuestStarts(store,host,continuation)),
  poll('inspection',async()=>{await reconcileWorkers(store,host);collectWorkflowOutcomes(store)}),
  poll('continuation',()=>continuation.tick()),
  poll('return delivery',()=>returns.tick()),
 ]
 let disposeCleanup:(()=>void)|undefined
 const directory=options.directory?physicalDirectory(options.directory):undefined
 const workerPermissions=poll('worker permission review',()=>returns.tick(directory))
 const timer=setInterval(()=>{
  // Worker locations also load this plugin. Only the registered giver's location
  // coordinates the board; workers retain their tools and local host observations.
  if(directory&&readUserGiver(store.runtime)?.directory!==directory){void workerPermissions();return}
  disposeCleanup??=installQuestCleanup(store,host)
  for(const poll of polls)void poll()
 },5000);timer.unref()
 options.onDispose?.(()=>{clearInterval(timer);disposeCleanup?.()})
 const workspaces=new QuestWorkspaces(store.runtime)
 return {call:async(method:string,args:unknown,context:any)=>{
  const validate=validators.get(method)
  if(!validate)throw new QuestError('INVALID_OPERATION','Unknown Quest operation: '+method)
  const checked=validate(args)
  if(!checked.valid)throw new QuestError('INVALID_INPUT',checked.errorMessage)
  let input:any=coordinatorInput(method,checked.data)

  const waitRequest=input.action==='wait'?(input.wait??{}):undefined
  if(waitRequest){if(!input.id)throw new QuestError('INVALID_INPUT','wait needs the Quest id to block on');input={...input,action:'get'}}
  if(input.action==='run'||waitRequest||input.inspect?.section==='runs')await reconcileWorkers(store,host,input.id)
  const requestID=context?.id??context?.callID
  if(!context?.sessionID||!requestID)throw new QuestError("HOST_CONTEXT_REQUIRED","Host must supply a session and tool call identity")
  const session=await host.get({sessionID:context.sessionID}),directory=(session?.data??session)?.location?.directory
   const memberships=readAllQuests(store.projectRoot,{includeArchived:true}).flatMap(row=>row.quest?row.quest.sessions.filter(s=>s.openCodeSessionId===context.sessionID||s.sessionID===context.sessionID).map(s=>({questID:row.quest!.id,stepIDs:['planned','executing','waiting'].includes(s.state)?s.deliverables.filter(id=>row.quest!.sessions.findLast(other=>other.deliverables.includes(id))===s):[]})):[])
   const isWorker=memberships.length>0
   if(isWorker&&(input.action==='run'||input.action==='start'||input.action==='create'||input.update?.cancelContinuation===true))throw new QuestError('WORKER_DELEGATION_DENIED','Workers update assigned work; only givers create Quests or dispatch workers')
   if(isWorker&&input.action==='update'){
    const allowed=new Set(memberships.filter(m=>m.questID===input.id).flatMap(m=>m.stepIDs))
    if(!allowed.size||Object.keys(input.update??{}).some(k=>k!=='steps')||input.update?.steps?.some((s:any)=>!allowed.has(s.id)||Object.keys(s).some(k=>!['id','state','note'].includes(k))))throw new QuestError('WORKER_ASSIGNMENT_DENIED','No Quest changes were saved. Workers may report only current assigned step states using report with id, stepID, state and note. Remove artifacts, reward, detail and all other keys; put artifact paths in note. Retry the corrected update, then get the Quest to verify it. The giver attaches global artifacts/reward and changes definitions.')
   }
  if(!isWorker&&(session?.data??session)?.agent==='quest-giver'&&!userGiverID(store))await bindUserGiver(store,host,context.sessionID)
  if(!isWorker&&userGiverID(store)&&userGiverID(store)!==context.sessionID&&['create','update','run','start'].includes(input.action))throw new QuestError('SINGLE_GIVER_REQUIRED','Continue in your one Quest Giver: '+userGiverID(store))
  const turnID=!isWorker&&input.action==='create'&&(context.native===true||typeof context.messageID==='string')?await originatingUserTurn(store,host,context.sessionID,context.messageID):undefined
  const trusted=isWorker?{project:workerLedgerProject(store,context.sessionID,directory)??projectIdentity(directory),directory:physicalDirectory(directory),sessionID:context.sessionID,requestID}:giverContext(store,{...(session?.data??session),id:context.sessionID},requestID,input.id,input.action==='create',turnID)
  if(!isWorker&&trusted.giverDirectory&&input.id)adoptQuestGiver(store,input.id)
  if(input.action==='start'){questsAPI(store,trusted,start).get(input.id);return requestQuestStart(store,input.id,devQueueGeneration())}
  if(input.action==='run'){
   if((input.run?.maxConcurrent!==undefined||input.run?.stepModels!==undefined)&&input.run?.continue!==true)throw new QuestError('INVALID_INPUT','Parallel options require run.continue')
   if((input.run?.maxConcurrent??1)>1&&workspaceSettings(options.settingsFile).workspaceMode!=='worktree')throw new QuestError('WORKSPACE_MODE_REQUIRED','Parallel continuation requires isolated worktrees')
   configureLearning(store,trusted,input.id,input.run?.taskTags,input.run?.maxConcurrent??1)
  }
  if(input.action==='run'&&input.run?.continue===true){const result=await continuation.run(input.id,{readOnly:input.run.readOnly,task:input.run.task,model:input.run.model,stepIDs:input.run.stepIDs,files:input.run.files,maxConcurrent:input.run.maxConcurrent,stepModels:input.run.stepModels},trusted);return result}
  if(input.action==='update'&&input.update?.cancelContinuation===true){continuation.cancel(input.id,trusted);input={...input,update:{...input.update}};delete input.update.cancelContinuation}
  const api=questsAPI(store,trusted,start)
  const listView=input.query?.view
  if(input.query)delete input.query.view
  let result:any
   switch(input.action){case "list":result=api.list({...(trusted.giverDirectory?{allProjects:true}:{}),...input.query});break;case "get":result=api.get(input.id);break;case "create":result=api.create(input.create);if(trusted.giverDirectory){const q=store.read(result.id)!;store.apply(q.id,'patched',{extensions:{...q.extensions,giverSourceDirectory:trusted.directory}},'quest:user-giver-source')}break;case "update":result=api.update(input.id,input.update);await cleanupQuests(store,host,input.id);break;case "run":result=await api.run(input.id,input.run?{readOnly:input.run.readOnly,task:input.run.task,model:input.run.model,stepIDs:input.run.stepIDs,files:input.run.files}:undefined);break;default:throw new QuestError("INVALID_OPERATION","Use list, get, create, update, run or wait")}
   // Reads are snapshots. Only the explicit wait operation blocks on worker progress.
   let waited:any
   if(waitRequest&&input.id){
    const runID=waitRequest?.runID
    const before=store.read(input.id)
    if(before){
     const fingerprint=observedState(before,runID)
     const blocking=activeRuns(before,runID).length>0
     let outcome={changed:false,quest:before as any,milliseconds:0}
     if(blocking){
      const seconds=Math.min(Math.max(Math.round(waitRequest?.timeoutSeconds??DEFAULT_WAIT_SECONDS),1),MAX_WAIT_SECONDS)
      let announced=0
      outcome=await awaitQuestChange({read:()=>store.read(input.id),fingerprint,runID,deadline:Date.now()+seconds*1000,reconcile:()=>reconcileWorkers(store,host,input.id),
       onWaiting:ms=>{if(ms-announced<10000)return;announced=ms;try{void Promise.resolve(context?.progress?.({questID:input.id,runID,waitingSeconds:Math.round(ms/1000)})).catch(()=>{})}catch{}}})
     }
     const after=outcome.quest??store.read(input.id)
     if(!after)throw new QuestError('QUEST_REMOVED','The Quest was removed while waiting: '+input.id)
     if(outcome.changed)result=api.get(input.id)
     if(blocking||waitRequest)waited={milliseconds:outcome.milliseconds,changed:outcome.changed,
      runs:await Promise.all(activeRuns(after,runID).slice(0,5).map(async run=>({...runSummary(run),observation:await inspectWorker(host,run)}))),
      ...(blocking?outcome.changed?{}:{steering:waitSteering(after,runID,outcome.milliseconds)}:{settled:true,steering:'No active run to wait for; this is the settled saved state.'})}
    }
   }
   if(input.action==='list')result={diagnostics:result.diagnostics.slice(0,10),items:result.items.map((item:any)=>listView==='plan'?toolPlan(store.read(item.id)!,continuation.status(item.id)):toolSummary(store.read(item.id)!)),total:result.total,nextOffset:result.nextOffset}
   if(['get','update'].includes(input.action)){
    const q=store.read(input.id)!
    if(input.inspect){
     const section=input.inspect.section
     const values:Record<string,()=>unknown>={cleanup:()=>cleanupStatus(store,q),description:()=>q.description,reward:()=>q.reward,steps:()=>q.stages,runs:()=>q.sessions,artifacts:()=>q.evidence,changes:()=>questChanges(q,workspaces),continuation:()=>continuation.status(q.id)}
     if(!values[section])throw new QuestError('INVALID_INPUT','Unknown inspect section')
     const page=toolSection(values[section](),section,input.inspect.offset,input.inspect.limit)
     if(section==='runs'&&Array.isArray(page.data))page.data=await Promise.all(page.data.map(async(run:any)=>({...run,observation:['planned','executing','waiting','blocked'].includes(run.state)?await inspectWorker(host,run):undefined})))
     result={id:q.id,project:q.project,...page}
    }else if(method==='status'||method==='archive'||method==='reopen')result=toolStatus(q)
    else if(method==='plan')result=toolPlan(q,continuation.status(q.id))
    else if(method==='report')result={...toolSummary(q),steps:q.stages.filter(s=>s.id===(args as any).stepID).map(s=>({id:s.id,state:s.status,note:s.note}))}
    else result=toolDetail(q,continuation.status(q.id))
   }
   if(waited)result={...result,waited}
   collectWorkflowOutcomes(store)
   if(input.action==='update'&&!isWorker&&context.external===true)requestQuestReview(store,input.id,devQueueGeneration(),input.update?.steps?.findLast((step:any)=>step.state==='done')?.id)
   return JSON.parse(JSON.stringify(result))
 }}
}
