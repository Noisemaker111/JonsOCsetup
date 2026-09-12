import {QuestStore} from '../store'
import {questRoot} from '../root'
import {userGiverID} from '../user-giver'
import {activeSessionID} from '../../scripts/runtime-contract.mjs'
import {boundedInspection} from '../worker-observation.mjs'
import {permissionReplyInput,permissionSummary,workerSessionID} from '../worker-permissions'
import {readAllQuests} from '../index'
import {redact} from '../privacy'
import type {Quest,QuestSession} from '../types'
const unwrap=(value:any)=>value?.data??value
export async function reviewWorkerPermissions(context:any,questID?:string,runID?:string) {
 const dialog=context.ui.dialog
 try{
  if(!userGiverID()||activeSessionID(context)!==userGiverID())throw Error('Return to your Quest Giver before reviewing worker permissions.')
  if(!context.client.permission?.list||!context.client.permission?.reply)throw Error('This host cannot reply here. Open the worker permission dialog.')
  const rows:{quest:Quest;run:QuestSession;request:any}[]=[]
  for(const {quest} of readAllQuests(questRoot(),{includeArchived:false})){
   if(!quest||(questID&&quest.id!==questID))continue
   for(const run of quest.sessions){
    if(runID&&(run.runID??run.callID)!==runID)continue
    const id=workerSessionID(run)
    if(!id?.startsWith('ses_')||run.harness||run.runtime==='claude-code'||!['executing','waiting','blocked'].includes(run.state))continue
    const pending=unwrap(await boundedInspection(signal=>context.client.permission.list({sessionID:id},{signal})))
    for(const request of pending??[])if(request.sessionID===id)rows.push({quest,run,request})
   }
  }
  if(!rows.length){await dialog.alert({title:'Worker permissions',message:'No pending worker permission requests on this host.'});return}
  const picked=rows.length===1?0:await dialog.select({title:'Pending worker permissions',options:rows.map((row,index)=>({value:index,title:redact(row.quest.title),description:permissionSummary(row.request).action}))})
  if(picked===undefined||picked===null)return
  const row=rows[picked];if(!row)return
  const summary=permissionSummary(row.request),id=workerSessionID(row.run)!
  const choice=await dialog.select({title:redact(row.quest.title)+' · permission required',options:[
   {value:'worker',title:'Open worker · full request and persistent access',description:summary.action+(summary.resources.length?' · '+summary.resources.join(', '):'')},
   {value:'once',title:'Allow once',description:'Resume this pending request only; do not save a permission rule.'},
   {value:'reject',title:'Reject and stop worker',description:'Native rejection also rejects other pending requests in this worker. Keeps saved work.'},
  ]})
  if(choice==='worker'){context.ui.router.navigate({type:'session',sessionID:id});return}
  if(choice!=='once'&&choice!=='reject')return
  const [worker,pending]=await Promise.all([
   boundedInspection(signal=>context.client.session.get({sessionID:id},{signal})),
   boundedInspection(signal=>context.client.permission.list({sessionID:id},{signal})),
  ])
  const input=permissionReplyInput({quest:new QuestStore(questRoot()).read(row.quest.id),runID:row.run.runID??row.run.callID,giverID:userGiverID(),activeID:activeSessionID(context),worker:unwrap(worker),shown:row.request,pending:unwrap(pending),reply:choice})
  await context.client.permission.reply(input)
  context.data?.session?.permission?.invalidate?.(id)
  await context.data?.session?.permission?.sync?.(id)
 }catch(error){await dialog.alert({title:'Worker permission',message:redact(String(error),800)})}
}
