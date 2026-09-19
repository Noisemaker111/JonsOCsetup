import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {workspaceSettingsFile} from './workspace-settings'
import {acquireLock} from './locking'
import {digest} from './privacy'
import {dispatchPlanInput,configuredDispatchPolicyFile,dispatchReservationFile} from '../models/dispatch-planner'
import {RouteReservations} from '../models/route-reservations'
export type ReviewerSettings={version:1;model?:string;preference:'economy'|'cash'|'latency'|'quota'}
export const reviewerSettingsFile=()=>join(dirname(workspaceSettingsFile()),'permission-reviewer.json')
export function reviewerSettings(file=reviewerSettingsFile()):ReviewerSettings{
 const value=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:1,preference:'economy'}
 if(value.version!==1||!['economy','cash','latency','quota'].includes(value.preference)||value.model!==undefined&&(typeof value.model!=='string'||!value.model.trim()))throw Error('Invalid permission reviewer settings; preserve and repair the user selection')
 return value
}
export function setReviewerSettings(value:ReviewerSettings,file=reviewerSettingsFile()){
 if(value.version!==1||!['economy','cash','latency','quota'].includes(value.preference)||value.model!==undefined&&!value.model.trim())throw Error('Invalid reviewer selection')
 const lock=acquireLock(dirname(file),'reviewer-settings')
 try{mkdirSync(dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');renameSync(tmp,file);return reviewerSettings(file)}finally{lock.release()}
}
export const reviewerSettingsKey=(settings:ReviewerSettings)=>digest(JSON.stringify(settings))
export async function reviewerCandidates(settings=reviewerSettings(),availableModels?:string[]){
 const plan=await dispatchPlanInput({task:'utility',model:settings.model,policyFile:configuredDispatchPolicyFile()})
 const routes=plan.routes.filter(r=>r.harness==='native'&&r.serviceTier==='default'&&(!availableModels||availableModels.includes(r.providerID+'/'+r.modelID)))
 const request={...plan.request,primaryRouteID:undefined,fallback:undefined,preference:settings.preference==='quota'?'capacity' as const:settings.preference}
 return {...plan,routes,request}
}
export async function reservePermissionReview(runtime:string,runID:string,settings:ReviewerSettings,pin:{model:string;selector?:string;accountID:string}|undefined,availableModels:string[]){
 let plan:Awaited<ReturnType<typeof reviewerCandidates>>
 try{plan=await reviewerCandidates({...settings,model:pin?.selector??pin?.model??settings.model},availableModels)}
 catch(error){
  // Older pins stored a generated explicit-choice route ID that exists only in
  // that planning call. Resolve the same model again, retaining its account pin.
  // Ambiguous, prohibited or unavailable model choices still fail closed.
  if(!pin?.selector||pin.selector===pin.model||!String(error).includes('AUTHORIZED_ROUTE_UNAVAILABLE:'))throw error
  plan=await reviewerCandidates({...settings,model:pin.model},availableModels)
 }
 if(pin)plan.routes=plan.routes.filter(r=>r.accountID===pin.accountID)
 const ledger=new RouteReservations(dispatchReservationFile(runtime)),result=ledger.reserve(runID,plan)
 if(!result.reservation)throw Error(result.decision?.summary??'No user-authorized available reviewer route')
 const route=plan.routes.find(r=>r.id===result.reservation!.routeID)
 if(!route)throw Error('Pinned reviewer route is unavailable; no substitute selected')
 return {route,ledger,decision:result.decision}
}
