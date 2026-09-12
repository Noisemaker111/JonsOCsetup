import {reviewerSettings,setReviewerSettings,reviewerCandidates} from '../reviewer-settings'
import {activeSessionID} from '../../scripts/runtime-contract.mjs'
import {userGiverID} from '../user-giver'
import {redact} from '../privacy'
export async function choosePermissionReviewer(context:any){
 try{
  if(!userGiverID()||activeSessionID(context)!==userGiverID())throw Error('Return to your Quest Giver to change its reviewer')
  const current=reviewerSettings(),dialog=context.ui.dialog
  const choice=await dialog.select({title:'Permission reviewer\n'+(current.model??'Automatic selection: '+current.preference)+'\nUses your accounts, pricing, usage and recorded speed.\nChanges apply to the next review, including this session.',options:[{value:'cash',title:'Automatic · prefer lower cost'},{value:'latency',title:'Automatic · prefer speed'},{value:'quota',title:'Automatic · prefer available quota'},{value:'choose',title:'Choose an exact model and reasoning level'}]})
  if(!choice)return
  if(choice==='choose'){
   const plan=await reviewerCandidates({...current,model:undefined}),allowed=new Set(plan.request.allowedRouteIDs)
   const routes=plan.routes.filter(r=>allowed.has(r.id))
   const selected=await dialog.select({title:'Choose permission reviewer',options:routes.map(r=>({value:'route:'+r.id,title:r.providerID+'/'+r.modelID+'#'+r.reasoning,description:(plan.snapshot.accounts.find(a=>a.id===r.accountID)?.provider??'Unknown account')+' · '+(plan.accounts.find(a=>a.id===r.accountID)?.billing??'unknown billing')}))})
   if(!selected)return
   setReviewerSettings({...current,model:selected})
  }else if(['cash','latency','quota'].includes(choice))setReviewerSettings({version:1,preference:choice})
  await dialog.alert({title:'Permission reviewer saved',message:'Your selection applies to the next review and survives restart. An active review will recheck the changed setting before replying.'})
 }catch(error){await context.ui.dialog.alert({title:'Permission reviewer',message:redact(String(error),1000)})}
}
