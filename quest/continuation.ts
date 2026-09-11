import {runtimeQueuePath,continuationFiles,readContinuations} from './runtime-queues'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { acquireLock } from './locking'
import { questsAPI, QuestError, type QuestContext, type RunQuest, type StartRun } from './api'
import { QuestStore } from './store'
import { RouteReservations } from '../models/route-reservations'
import { getAccountUsage } from '../usage/account-api'
import { readAllQuests } from './index'
import { redact } from './privacy'
import type { Quest, QuestStage } from './types'
import {dispatchReservationFile} from '../models/dispatch-planner'
import { verifySourceBinding } from './project'
function verified(q:Quest,s:QuestStage){const command=(q.extensions.routerVerification as Record<string,string>|undefined)?.[s.id]??s.commandID;return !!command&&s.proofs.some(p=>p.command===command&&p.verified===true&&(p.result==='passed'||p.verdict==='PASS'))}
const verificationSnapshot=(q:Quest,ids:string[])=>Object.fromEntries(ids.map(id=>[id,(q.extensions.routerVerification as Record<string,string>|undefined)?.[id]??q.stages.find(s=>s.id===id)?.commandID??null]))

export type ContinuationRunOptions = RunQuest & { maxConcurrent?:number; stepModels?:Record<string,string> }
type Admission = { stepID:string; requestID:string; runID?:string; state:'waiting'|'claiming'|'running'|'unknown'|'stopped'|'done'; attempt:number; refreshes:number; nextAt:number; reason:string }
export type GoalRoute = { routeID:string;accountID:string;providerID:string;modelID:string;reasoning:string;serviceTier:string }
type Intent = { readOnly?:boolean; task?:string; requestFingerprint?:string; maxConcurrent?:number; stepModels?:Record<string,string>; admissions?:Admission[]; id:string; goal?:boolean; worker?:boolean; unknown?:boolean; verification?:Record<string,string|null>; route?:GoalRoute; epoch?:number; eventIDs?:string[]; questID:string; description:string; context:QuestContext; model?:string; files?:string[]; steps:{id:string;title:string;detail?:string;needs:string[]}[]; state:'waiting'|'claiming'|'running'|'stopped'|'done'; runID?:string; attempt:number; refreshes:number; nextAt:number; reason:string }
const active = (state:string)=>['planned','executing','waiting','blocked'].includes(state)
/** Only explicit run.continue requests enter this queue. Never infer authorization from logs. */
export class QuestContinuation {
  readonly file:string
  private liveGoals=new Set<string>()
  constructor(readonly store:QuestStore,readonly start:StartRun,readonly options:{runtimeGeneration?:string;goalMode?:boolean;routeBinding?:(selector:string)=>GoalRoute;workerPrompt?:(context:QuestContext,text:string,id:string,eventID?:string)=>Promise<void>;refresh?:typeof getAccountUsage;now?:()=>number;verifyContext?:(context:QuestContext)=>Promise<void>}={}) {this.file=runtimeQueuePath(store.runtime,'continuations',options.runtimeGeneration,'.json')}
 private now(){return this.options.now?.()??Date.now()}
 private read():Intent[]{return existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):[]}
 private change<T>(fn:(rows:Intent[])=>T):T {const lock=acquireLock(this.store.runtime,'continuations');try{const rows=this.read(),result=fn(rows);mkdirSync(this.store.runtime,{recursive:true});const tmp=this.file+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(rows));renameSync(tmp,this.file);return result}finally{lock.release()}}
 status(questID:string){return readContinuations(this.store.runtime).filter(x=>x.questID===questID).map(row=>({...row,...(row.admissions?{desired:row.maxConcurrent??1,admitted:row.admissions.filter(a=>['claiming','running','unknown'].includes(a.state)).length,waiting:row.steps.filter(s=>!row.admissions!.some(a=>a.stepID===s.id&&['claiming','running','unknown','done','stopped'].includes(a.state))).length}:{} )}))}
  goalStatus(sessionID:string){return this.read().filter(x=>x.goal&&x.context.sessionID===sessionID).map(x=>({...x,live:this.liveGoals.has(x.id),resumeRequired:!this.liveGoals.has(x.id)&&x.state!=='done'}))}
  async resumeGoal(context:QuestContext){
   const row=this.read().findLast(x=>x.goal&&x.context.sessionID===context.sessionID)
   if(!row)throw new QuestError('GOAL_NOT_FOUND','Start an explicitly authorized goal first')
    if(row.context.project.id!==context.project.id)throw new QuestError('PROJECT_MISMATCH','Goal binding changed; return to the authorized destination')
    verifySourceBinding(row.context,context.directory!)
   await this.options.verifyContext?.(context)
   const q=this.store.read(row.questID)
   if(!q||q.sessions.some(s=>['planned','executing','waiting','blocked'].includes(s.state)&&!(row.worker&&(s.openCodeSessionId===context.sessionID||s.sessionID===context.sessionID))))throw new QuestError('ACTIVE_OR_UNKNOWN_RUN','Reconcile the existing run before resuming; no launch was retried')
   if(row.unknown||row.state==='claiming'||row.reason.startsWith('UNKNOWN_LAUNCH'))throw new QuestError('UNKNOWN_LAUNCH','Interrupted admission requires inspection before resume')
   this.change(rows=>{const current=rows.find(x=>x.id===row.id)!;if(current.state!=='done'){current.state='waiting';current.nextAt=0;if(current.worker){current.attempt=0;current.epoch=(current.epoch??0)+1}current.reason='Explicit verified resume'}})
   this.liveGoals.add(row.id);if(row.worker)await this.advanceWorker(row.id,'resume:'+context.requestID);else await this.tick();return this.goalStatus(context.sessionID)
  }
  startWorkerGoal(questID:string,stepIDs:string[],context:QuestContext,model:string,route?:GoalRoute){
   const q=this.store.read(questID),run=q?.sessions.findLast(s=>s.openCodeSessionId===context.sessionID||s.sessionID===context.sessionID)
   if(!q||q.project?.id!==context.project.id||!run||!['executing','waiting'].includes(run.state)||!stepIDs.length||stepIDs.some(id=>!run.deliverables.includes(id)||q.sessions.findLast(s=>s.deliverables.includes(id))!==run))throw new QuestError('WORKER_ASSIGNMENT_DENIED','Only the current active assigned steps may enter a worker goal')
   const id=createHash('sha256').update(questID+':'+context.sessionID+':'+context.requestID).digest('hex').slice(0,26)
   this.change(rows=>{if(rows.some(r=>r.id===id))return;if(rows.some(r=>r.goal&&r.context.sessionID===context.sessionID&&!['stopped','done'].includes(r.state)))throw new QuestError('GOAL_EXISTS','Pause the existing session goal first');rows.push({id,goal:true,worker:true,route,verification:verificationSnapshot(q,stepIDs),questID,description:q.description??q.objective,context,model,steps:q.stages.filter(s=>stepIDs.includes(s.id)).map(s=>({id:s.id,title:s.title,detail:s.detail,needs:s.needs})),state:'running',attempt:0,refreshes:0,nextAt:0,reason:'Pursue only current assigned steps; successful execution events recheck actual results'})})
   this.liveGoals.add(id);return this.goalStatus(context.sessionID)
  }
  async workerEvent(sessionID:string,eventID:string,success:boolean){
   for(const row of this.goalStatus(sessionID).filter(r=>r.worker&&r.live&&r.state==='running')){
    if(!success){this.pauseGoal(row.context);continue}
    await this.advanceWorker(row.id,eventID)
   }
  }
  private async advanceWorker(id:string,eventID:string){
   let claimed:Intent|undefined
   this.change(rows=>{const row=rows.find(r=>r.id===id);if(!row||!row.worker||!this.liveGoals.has(id)||!['running','waiting'].includes(row.state)||row.eventIDs?.includes(eventID))return
    row.eventIDs=[...(row.eventIDs??[]),eventID].slice(-20)
    const q=this.store.read(row.questID),run=q?.sessions.findLast(s=>s.openCodeSessionId===row.context.sessionID||s.sessionID===row.context.sessionID)
    const stop=(reason:string)=>{row.state='stopped';row.reason=reason}
    if(!q||q.project?.id!==row.context.project.id||!run||['failed','cancelled','blocked'].includes(run.state)||row.steps.some(s=>q.sessions.findLast(r=>r.deliverables.includes(s.id))!==run)){stop('Worker assignment/ownership changed or run blocked');return}
    if(q.description!==row.description||row.steps.some(s=>{const a=q.stages.find(x=>x.id===s.id);return !a||a.title!==s.title||a.detail!==s.detail||JSON.stringify(a.needs)!==JSON.stringify(s.needs)})){stop('Authorized step definitions changed');return}
    const steps=q.stages.filter(s=>row.steps.some(r=>r.id===s.id))
    if(row.verification&&JSON.stringify(row.verification)!==JSON.stringify(verificationSnapshot(q,row.steps.map(s=>s.id)))){stop('Verification contract changed; explicitly start a newly authorized goal');return}
    if(steps.some(s=>s.status==='blocked')){stop('Assigned step blocked; inspect its result');return}
    if(steps.some(s=>s.status==='done'&&!verified(q,s))){stop('Assigned result lacks a verified passing proof for its verification contract');return}
    if(steps.every(s=>s.status==='done')){row.state='done';row.reason='Assigned verification passed';return}
    if(row.attempt>=3){stop('Bounded worker goal turn budget exhausted; explicit resume after review required');return}
    row.state='claiming';claimed=structuredClone(row)
   })
   if(!claimed)return
   const row=claimed
   let promptAttempted=false
   try{
    await this.options.verifyContext?.(row.context)
    const usage=await(this.options.refresh??getAccountUsage)({refresh:true})
    const account=usage.accounts.find(a=>a.id===row.route?.accountID)
    if(!account||account.state!=='available'||account.freshness.stale)throw new QuestError('ACCOUNT_HOLD','Worker goal requires its exact reserved account with fresh available quota')
    const proceed=this.change(rows=>{const current=rows.find(r=>r.id===id)!;if(current.state!=='claiming')return false;current.attempt++;return true});if(!proceed)return
    if(!this.options.workerPrompt)throw new QuestError('HOST_CAPABILITY_MISSING','Worker prompt continuation is unavailable')
    promptAttempted=true
    this.change(rows=>{rows.find(r=>r.id===id)!.unknown=true})
    await this.options.workerPrompt(row.context,`Continue only assigned Quest ${row.questID} steps ${row.steps.map(s=>s.id).join(', ')}. Inspect actual checks/results; record verified proof before completion. Do not create Quests or dispatch workers. Stop on user steering, blockers, holds, or budget.`,id+':'+(row.epoch??0)+':'+row.attempt,eventID)
    this.change(rows=>{const current=rows.find(r=>r.id===id)!;current.unknown=false;if(current.state==='claiming'){current.state='running';current.reason='Same-session assigned-step continuation admitted'}})
   }catch(error){this.change(rows=>{const current=rows.find(r=>r.id===id)!;if(current.state!=='stopped'){current.state='stopped';current.reason=(promptAttempted?'UNKNOWN_LAUNCH: ':'')+redact(error instanceof Error?error.message:String(error),1000)}})}
  }
  pauseGoal(context:QuestContext){this.change(rows=>{for(const row of rows.filter(r=>r.goal&&r.context.sessionID===context.sessionID)){if(row.context.project.id!==context.project.id)throw new QuestError('PROJECT_MISMATCH','Goal destination changed');this.liveGoals.delete(row.id);if(row.state!=='done'){row.state='stopped';row.reason='Explicit session goal pause; current ownership retained until resume or cancel'}}});return this.goalStatus(context.sessionID)}
 cancel(questID:string,context:QuestContext){
  questsAPI(this.store,context,this.start).get(questID)
  const lock=acquireLock(this.store.runtime,'continuations')
  try{for(const file of continuationFiles(this.store.runtime)){
   const rows:Intent[]=JSON.parse(readFileSync(file,'utf8'));let changed=false
   for(const row of rows.filter(x=>x.questID===questID&&!['done','stopped'].includes(x.state))){row.state='stopped';row.reason='Continuation cancelled; an already launched worker must be reconciled separately';changed=true}
   if(changed){const tmp=file+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(rows));renameSync(tmp,file)}
  }return this.status(questID)}finally{lock.release()}
 }
 async run(questID:string,input:ContinuationRunOptions,context:QuestContext){
  if(input.readOnly!==undefined&&typeof input.readOnly!=="boolean")throw new QuestError("INVALID_INPUT","readOnly must be a boolean")
  if(input.maxConcurrent!==undefined&&(!Number.isSafeInteger(input.maxConcurrent)||input.maxConcurrent<1))throw new QuestError('INVALID_INPUT','maxConcurrent must be a positive safe integer')
  const q=questsAPI(this.store,context,this.start).get(questID)
  const id=createHash('sha256').update(questID+':'+context.sessionID+':'+context.requestID).digest('hex').slice(0,26)
  const requestFingerprint=createHash('sha256').update(JSON.stringify({readOnly:input.readOnly===true,task:input.task??null,model:input.model??null,files:input.files??null,stepIDs:input.stepIDs??null,maxConcurrent:input.maxConcurrent??1,stepModels:input.stepModels?Object.fromEntries(Object.entries(input.stepModels).sort(([a],[b])=>a.localeCompare(b))):null})).digest('hex')
  const sameRequest=(row:Intent)=>row.requestFingerprint?row.requestFingerprint===requestFingerprint:(row.readOnly===true)===(input.readOnly===true)&&row.model===input.model&&JSON.stringify(row.files??['.'])===JSON.stringify(input.files??['.'])&&(row.maxConcurrent??1)===(input.maxConcurrent??1)&&JSON.stringify(row.stepModels??{})===JSON.stringify(input.stepModels??{})&&JSON.stringify(row.steps.map(s=>s.id))===JSON.stringify(input.stepIDs??row.steps.map(s=>s.id))
  const existing=this.read().find(row=>row.id===id)
  if(existing){if(!sameRequest(existing))throw new QuestError('REQUEST_CONFLICT','This continuation request already authorized different work; use a new request identity');return {continuation:this.status(questID).find(row=>row.id===id)}}
  const ids=input.stepIDs??q.steps.filter(s=>s.state==='pending').map(s=>s.id)
  if(!ids.length||ids.some(id=>!q.steps.some(s=>s.id===id&&s.state==='pending')))throw new QuestError('NO_ELIGIBLE_STEPS','Continuation requires pending authorized steps')
  if(input.stepModels!==undefined&&(!input.stepModels||typeof input.stepModels!=='object'||Array.isArray(input.stepModels)||Object.entries(input.stepModels).some(([id,model])=>!ids.includes(id)||typeof model!=='string'||!model.trim())))throw new QuestError('INVALID_INPUT','stepModels must map authorized step IDs to explicit models')
  if(ids.some(id=>!this.store.read(questID)!.stages.find(s=>s.id===id)?.commandID&&!input.stepModels?.[id])&&!input.model)throw new QuestError('EXPLICIT_MODEL_REQUIRED','Continuation requires an explicit model for worker steps')
  const route=this.options.goalMode&&input.model?this.options.routeBinding?.(input.model):undefined
  this.change(rows=>{const prior=rows.find(x=>x.id===id);if(prior){if(!sameRequest(prior))throw new QuestError('REQUEST_CONFLICT','This continuation request already authorized different work');return;}if(readContinuations(this.store.runtime).some(x=>(x.questID===questID||this.options.goalMode&&x.goal&&x.context.sessionID===context.sessionID)&&!['done','stopped'].includes(x.state)))throw new QuestError('CONTINUATION_EXISTS','Inspect or cancel the existing continuation before replacing its authorization');rows.push({requestFingerprint,...(input.maxConcurrent!==undefined||input.stepModels?{maxConcurrent:input.maxConcurrent??1,stepModels:input.stepModels,admissions:[]}:{}),id,goal:this.options.goalMode===true,route,verification:this.options.goalMode?verificationSnapshot(this.store.read(questID)!,ids):undefined,questID,description:q.description,context,readOnly:input.readOnly,task:input.task,model:input.model,files:input.files,steps:q.steps.filter(s=>ids.includes(s.id)).map(s=>({id:s.id,title:s.title,detail:s.detail,needs:s.needs})),state:'waiting',attempt:0,refreshes:0,nextAt:0,reason:'Explicitly authorized continuation'})})
  if(this.options.goalMode)this.liveGoals.add(id)
  await this.tick();return {continuation:this.status(questID).find(x=>x.id===id)}
 }
  async tick(){for(const intent of this.read().filter(x=>!x.worker&&(x.goal?this.options.goalMode&&this.liveGoals.has(x.id):!this.options.goalMode)&&['waiting','running'].includes(x.state)&&x.nextAt<=this.now()))await (intent.admissions?this.advanceParallel(intent.id):this.advance(intent.id))}
 /** Claims are serialized on disk; refresh and launch never hold the ledger lock. */
 private async advanceParallel(id:string){
  for(let turn=0;turn<16;turn++){
   let claim:{row:Intent;admission:Admission}|undefined
   this.change(rows=>{
    const row=rows.find(x=>x.id===id)
    if(!row||!['waiting','running'].includes(row.state))return
    const q=this.store.read(row.questID)
    if(!q||q.project?.id!==row.context.project.id||q.project.root!==row.context.project.root||q.state==='Archived'||q.description!==row.description||row.steps.some(s=>{const actual=q.stages.find(x=>x.id===s.id);return !actual||actual.title!==s.title||actual.detail!==s.detail||JSON.stringify(actual.needs)!==JSON.stringify(s.needs)})){
     row.state='stopped';row.reason='Quest ownership or authorized step definition changed';return
    }
     const admissions=row.admissions!
     if(row.verification&&JSON.stringify(row.verification)!==JSON.stringify(verificationSnapshot(q,row.steps.map(s=>s.id)))){row.state='stopped';row.reason='Verification contract changed; explicitly start a newly authorized goal';return}
     if(row.goal&&row.steps.some(s=>{const actual=q.stages.find(x=>x.id===s.id);return actual?.status==='done'&&!verified(q,actual)})){row.state='stopped';row.reason='Completed step has no verified passing proof for its contract; inspect results before continuing';return}
    for(const a of admissions){
     const run=q.sessions.find(s=>s.runID===a.runID)
     if(run&&['completed','failed','cancelled'].includes(run.state)&&['running','unknown','claiming'].includes(a.state)){
      a.state=run.state==='completed'&&q.stages.find(s=>s.id===a.stepID)?.status==='done'?'done':'stopped'
      a.reason=a.state==='done'?'Terminal worker completed its step':'Worker terminal outcome did not complete its step'
     }
    }
    if(admissions.every(a=>a.state==='done')&&row.steps.every(s=>q.stages.find(x=>x.id===s.id)?.status==='done')&&!q.sessions.some(s=>active(s.state)&&s.deliverables.some(d=>row.steps.some(x=>x.id===d)))){row.state='done';row.reason='Authorized steps completed with terminal outcomes';return}
    // Count all active runs in this Quest, plus claims not yet represented by a run.
    const occupied=q.sessions.filter(s=>active(s.state)).length+admissions.filter(a=>['claiming','unknown'].includes(a.state)&&!q.sessions.some(s=>s.runID===a.runID)).length
    if(occupied>=(row.maxConcurrent??1)){row.state='running';row.reason='Desired concurrency reached; awaiting terminal outcomes';return}
    const step=row.steps.find(s=>{
     const a=admissions.find(x=>x.stepID===s.id)
     if(a&&(a.state!=='waiting'||a.nextAt>this.now()))return false
     if(a&&/Uncalibrated worker hold:/.test(a.reason)){
      const blockerID=/Uncalibrated worker hold: ([a-zA-Z0-9_-]+)/.exec(a.reason)?.[1]
      const blocker=blockerID?readAllQuests(this.store.projectRoot,{includeArchived:true}).flatMap(x=>x.quest?.sessions??[]).find(x=>x.runID===blockerID):undefined
      if(blocker&&active(blocker.state))return false
     }
     return q.stages.find(x=>x.id===s.id)?.status==='pending'&&!q.sessions.some(x=>active(x.state)&&x.deliverables.includes(s.id))&&s.needs.every(n=>q.stages.find(x=>x.id===n)?.status==='done'&&!q.sessions.some(x=>active(x.state)&&x.deliverables.includes(n))&&(!admissions.some(x=>x.stepID===n)||admissions.some(x=>x.stepID===n&&x.state==='done')))
    })
    if(!step){
     const pending=admissions.some(a=>['waiting','claiming','running','unknown'].includes(a.state))||q.sessions.some(s=>active(s.state))
     row.state=pending?'running':'stopped';row.reason=pending?'Awaiting dependencies, held admissions or worker outcomes':'No eligible authorized steps; inspect incomplete outcomes';return
    }
    let a=admissions.find(x=>x.stepID===step.id)
    if(!a){a={stepID:step.id,requestID:'',state:'waiting',attempt:0,refreshes:0,nextAt:0,reason:'Authorized independent step'};admissions.push(a)}
    a.attempt++;a.requestID='continue:'+id+':step:'+step.id+':'+a.attempt
    a.runID=createHash('sha256').update(row.context.project.id+':'+row.context.sessionID+':'+a.requestID+':run:'+row.questID).digest('hex').slice(0,26)
    a.state='claiming';a.reason='Durable admission reserved; an interrupted launch must be reconciled'
    row.state='running';claim={row:structuredClone(row),admission:structuredClone(a)}
   })
   if(!claim)return
   const {row,admission}=claim
   try{
    await this.options.verifyContext?.(row.context)
     const reservations=new RouteReservations(dispatchReservationFile(this.store.runtime))
    for(const entry of readAllQuests(this.store.projectRoot,{includeArchived:true}))for(const run of entry.quest?.sessions??[]){if(run.runID&&['completed','failed','cancelled'].includes(run.state)&&reservations.get(run.runID)&&reservations.get(run.runID)?.state!=='settled')reservations.settle(run.runID,{state:'settled',completedAt:run.updatedAt})}
    await (this.options.refresh??getAccountUsage)({refresh:true})
    const proceed=this.change(rows=>{
     const current=rows.find(x=>x.id===id)!,a=current.admissions!.find(x=>x.stepID===admission.stepID)!
     if(current.state==='stopped'||a.state!=='claiming'||a.requestID!==admission.requestID)return false
     const q=this.store.read(row.questID)
     if(!q||q.state==='Archived'||q.project?.id!==row.context.project.id||q.project.root!==row.context.project.root||q.description!==row.description||row.steps.some(s=>{const actual=q.stages.find(x=>x.id===s.id);return !actual||actual.title!==s.title||actual.detail!==s.detail||JSON.stringify(actual.needs)!==JSON.stringify(s.needs)})){current.state='stopped';current.reason='Authorization changed during refresh';return false}
     const step=row.steps.find(s=>s.id===admission.stepID)!
     if(step.needs.some(n=>q.stages.find(s=>s.id===n)?.status!=='done'||q.sessions.some(s=>active(s.state)&&s.deliverables.includes(n)))){a.state='stopped';a.reason='Dependency changed during refresh';return false}
     return true
    })
    if(!proceed)continue
    const q=this.store.read(row.questID)!
    const result=await questsAPI(this.store,{...row.context,requestID:admission.requestID},this.start).run(row.questID,{stepIDs:[admission.stepID],files:row.files,readOnly:row.readOnly,task:row.task,...(q.stages.find(s=>s.id===admission.stepID)?.commandID?{}:{model:row.stepModels?.[admission.stepID]??row.model})})
    this.change(rows=>{const current=rows.find(x=>x.id===id)!,a=current.admissions!.find(x=>x.stepID===admission.stepID)!;a.runID=result.runID;a.state='running';a.refreshes=0;a.reason='Confirmed worker/command launch'})
   }catch(error){
    this.change(rows=>{
     const current=rows.find(x=>x.id===id)!,a=current.admissions!.find(x=>x.stepID===admission.stepID)!
     if(current.state==='stopped')return
     const reason=redact(error instanceof Error?error.message:String(error),2000)
     a.reason=reason;a.refreshes++
     const routeHold=error instanceof QuestError&&error.code==='ROUTE_UNAVAILABLE'
     if(routeHold&&/Burn pacing stopped:/.test(reason)){current.state='stopped';current.reason=reason;a.state='stopped';return}
     if(!current.goal&&routeHold&&(/Burn pacing hold:/.test(reason)||/Uncalibrated worker hold:/.test(reason)&&a.refreshes<3)){a.state='waiting';a.nextAt=this.now()+(/Burn pacing hold:/.test(reason)?30000:10000);return}
     a.state=!(error instanceof QuestError)||error.code==='DISPATCH_OUTCOME_UNKNOWN'?'unknown':'stopped'
     current.reason='An admission requires reconciliation; independent active workers are preserved'
    })
   }
  }
 }
 private async advance(id:string){
  let claimed:Intent|undefined
  this.change(rows=>{const row=rows.find(x=>x.id===id);if(!row||!['waiting','running'].includes(row.state)||row.nextAt>this.now())return
   const q=this.store.read(row.questID)
   if(!q||q.project?.id!==row.context.project.id||q.project.root!==row.context.project.root||q.state==='Archived'){row.state='stopped';row.reason='Quest ownership changed or Quest archived';return}
    if(q.description!==row.description||row.steps.some(s=>{const actual=q.stages.find(x=>x.id===s.id);return !actual||actual.title!==s.title||actual.detail!==s.detail||JSON.stringify(actual.needs)!==JSON.stringify(s.needs)})){row.state='stopped';row.reason='Authorized step definition changed; inspect before continuing';return}
    if(row.verification&&JSON.stringify(row.verification)!==JSON.stringify(verificationSnapshot(q,row.steps.map(s=>s.id)))){row.state='stopped';row.reason='Verification contract changed; explicitly start a newly authorized goal';return}
   if(row.state==='waiting'&&row.refreshes>0){
    const blockerID=/Uncalibrated worker hold: ([a-zA-Z0-9_-]+)/.exec(row.reason)?.[1]
    const blocker=blockerID?readAllQuests(this.store.projectRoot,{includeArchived:true}).flatMap(x=>x.quest?.sessions??[]).find(s=>s.runID===blockerID):undefined
    if(blocker&&['planned','waiting','blocked'].includes(blocker.state)){row.state='stopped';row.reason='Blocking launch is unknown or blocked; reconcile before continuing';return}
    if(blocker?.state==='executing'){row.nextAt=this.now()+10000;return}
   }
   const run=q.sessions.find(s=>s.runID===row.runID)
   if(run&&active(run.state))return
   if(run&&(['failed','cancelled'].includes(run.state)||run.deliverables.some(id=>q.stages.find(s=>s.id===id)?.status!=='done'))){row.state='stopped';row.reason='Worker terminal outcome did not complete the assigned steps; inspect its result';return}
    if(row.goal&&row.steps.some(s=>{const actual=q.stages.find(x=>x.id===s.id);return actual?.status==='done'&&!verified(q,actual)})){row.state='stopped';row.reason='Completed step has no verified passing proof for its contract; inspect results before continuing';return}
    if(row.steps.every(s=>q.stages.find(x=>x.id===s.id)?.status==='done')){row.state='done';row.reason='Authorized steps completed';return}
   if(q.sessions.some(s=>active(s.state)))return
   if(!row.steps.some(s=>q.stages.find(x=>x.id===s.id)?.status==='pending'&&s.needs.every(n=>q.stages.find(x=>x.id===n)?.status==='done'))){row.state='stopped';row.reason='No eligible authorized steps';return}
   row.state='claiming';claimed=structuredClone(row)
  })
  if(!claimed)return
  const row=claimed
  try{
   await this.options.verifyContext?.(row.context)
   // Reconcile only observed terminal runs, including another Quest holding this account.
    const reservations=new RouteReservations(dispatchReservationFile(this.store.runtime))
   for(const entry of readAllQuests(this.store.projectRoot,{includeArchived:true}))for(const run of entry.quest?.sessions??[]){if(run.runID&&['completed','failed','cancelled'].includes(run.state)&&reservations.get(run.runID)?.state!=='settled'&&reservations.get(run.runID))reservations.settle(run.runID,{state:'settled',completedAt:run.updatedAt})}
   await (this.options.refresh??getAccountUsage)({refresh:true})
   // Cancellation during the asynchronous refresh wins before dispatch.
   const proceed=this.change(rows=>{const current=rows.find(x=>x.id===id)!;if(current.state!=='claiming')return false;current.attempt++;return true})
   if(!proceed)return
   const q=this.store.read(row.questID)!,step=row.steps.find(s=>q.stages.find(x=>x.id===s.id)?.status==='pending'&&s.needs.every(n=>q.stages.find(x=>x.id===n)?.status==='done'))!
   const requestID='continue:'+id+':'+row.attempt
   const result=await questsAPI(this.store,{...row.context,requestID},this.start).run(row.questID,{stepIDs:[step.id],files:row.files,readOnly:row.readOnly,task:row.task,...(q.stages.find(s=>s.id===step.id)?.commandID?{}:{model:row.model})})
   this.change(rows=>{const current=rows.find(x=>x.id===id)!;current.runID=result.runID;if(current.state!=='stopped'){current.state='running';current.refreshes=0;current.reason='Confirmed worker/command launch'}})
  }catch(error){this.change(rows=>{const current=rows.find(x=>x.id===id)!;if(current.state==='stopped')return;const reason=redact(error instanceof Error?error.message:String(error),2000)
    // Only a known pre-launch account hold is retryable, at most three refreshes.
    if(error instanceof QuestError&&error.code==='ROUTE_UNAVAILABLE'&&/Burn pacing stopped:/.test(reason)){current.state='stopped';current.reason=reason;return}
    if(!current.goal&&error instanceof QuestError&&error.code==='ROUTE_UNAVAILABLE'&&/Burn pacing hold:/.test(reason)){current.state='waiting';current.nextAt=this.now()+30000;current.reason=reason;return}
     const hold=!current.goal&&error instanceof QuestError&&error.code==='ROUTE_UNAVAILABLE'&&/Uncalibrated worker hold:/.test(reason)
    current.refreshes++;current.state=hold&&current.refreshes<3?'waiting':'stopped';current.nextAt=this.now()+10000;current.reason=reason
   })}
 }
}
