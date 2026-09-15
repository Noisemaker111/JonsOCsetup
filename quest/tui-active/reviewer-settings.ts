import {reviewerSettings,setReviewerSettings,reviewerCandidates} from '../reviewer-settings'
import {activeSessionID} from '../../scripts/runtime-contract.mjs'
import {userGiverID} from '../user-giver'
import {redact} from '../privacy'
import {availableModelIdentities} from '../host-observation'
export async function choosePermissionReviewer(context:any){
 try{
  if(!userGiverID()||activeSessionID(context)!==userGiverID())throw Error('Return to your Quest Giver to change its reviewer')
  const current=reviewerSettings(),dialog=context.ui.dialog
  const choice=await dialog.select({title:'Permission reviewer\n'+(current.model??'Automatic selection: '+current.preference)+'\nUses your accounts, pricing, usage and recorded speed.\nChanges apply to the next review, including this session.',options:[{value:'economy',title:'Automatic · economical capable model'},{value:'cash',title:'Automatic · measured cash per success'},{value:'latency',title:'Automatic · prefer speed'},{value:'quota',title:'Automatic · prefer available quota'},{value:'choose',title:'Choose an exact model and reasoning level'}]})
  if(!choice)return
  if(choice==='choose'){
   const availableModels=await availableModelIdentities(context.client,context.client.integration)
   const plan=await reviewerCandidates({...current,model:undefined},availableModels),allowed=new Set(plan.request.allowedRouteIDs)
   const routes=plan.routes.filter(r=>allowed.has(r.id)&&r.verified)
   let selected=await dialog.select({title:'Choose permission reviewer',options:[{value:'enter',title:'Enter an exact model',description:'provider/model#reasoning or an account-specific route selector'},...routes.map(r=>({value:'route:'+r.id,title:r.providerID+'/'+r.modelID+'#'+r.reasoning,description:(plan.snapshot.accounts.find(a=>a.id===r.accountID)?.provider??'Unknown account')+' · '+(plan.accounts.find(a=>a.id===r.accountID)?.billing??'unknown billing')}))]})
   if(!selected)return
   if(selected==='enter'){
    selected=await dialog.prompt({title:'Permission reviewer model',placeholder:'provider/model#reasoning',value:current.model??''})
    if(typeof selected!=='string'||!selected.trim())return
    selected=selected.trim()
    const exact=await reviewerCandidates({...current,model:selected},availableModels)
    if(!exact.routes.some(r=>r.id===exact.request.explicitRouteID))throw Error('The exact model is unavailable in this connected host; selection was not changed')
   }
   setReviewerSettings({...current,model:selected})
  }else if(['economy','cash','latency','quota'].includes(choice))setReviewerSettings({version:1,preference:choice})
  await dialog.alert({title:'Permission reviewer saved',message:'Your selection applies to the next review and survives restart. An active review will recheck the changed setting before replying.'})
 }catch(error){await context.ui.dialog.alert({title:'Permission reviewer',message:redact(String(error),1000)})}
}
