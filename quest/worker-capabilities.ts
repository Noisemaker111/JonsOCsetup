import {userGiverID} from './user-giver'
import {assertWorkerIdentity,assertWorkerRequestIdentity} from './worker-identity'
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {readAllQuests} from './index'
import {QuestError} from './api'
import {researchTools} from './shared-guard'
import type {QuestStore} from './store'
const names=(tools:any[]):string[]=>tools.flatMap(t=>typeof t?.function?.name==='string'?[t.function.name]:Array.isArray(t?.tools)?names(t.tools):typeof t?.name==='string'?[t.name]:[])
/** Record only capability names, never prompts, request headers, or credentials. */
export async function installWorkerCapabilities(ctx:any,store:QuestStore){
 const run=(id:string)=>readAllQuests(store.projectRoot,{includeArchived:true}).flatMap(r=>r.quest?.sessions??[]).find(r=>(r.sessionID??r.openCodeSessionId)===id)
 const save=(id:string,value:any)=>{const row=run(id),giver=userGiverID(store)===id;if(!row?.runID&&!giver)return;const dir=join(store.runtime,giver?'giver-capabilities':'worker-capabilities'),file=join(dir,(row?.runID??id)+'.json');mkdirSync(dir,{recursive:true});const prior=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};const temporary=file+'.'+process.pid+'.tmp';writeFileSync(temporary,JSON.stringify({...prior,...value,sessionID:id,observedAt:new Date().toISOString()}));renameSync(temporary,file)}
 await ctx.session.hook('context',(event:any)=>{
  const assignment=run(event.sessionID);if(!assignment){
   if(event.agent==='quest-giver'){
    // New dispatch belongs to the typed Quest API; the legacy transport cannot accept it.
    delete event.tools?.subagent
    if(event.tools?.execute)event.tools.execute.description='Manage Quests and select projects with this native tool. Call execute with '+JSON.stringify({code:'return await search({query:"project_select",limit:1})'})+'. Then use the exact discovered signatures inside another execute call. Discover the quests MCP namespace for its API methods.\n'+(event.tools.execute.description??'')
    save(event.sessionID,{modelTools:Object.keys(event.tools??{})})
   }
   return
  }
  assertWorkerIdentity(assignment,event)
  if((assignment.scope as any)?.readOnly===true)for(const name of Object.keys(event.tools??{}))if(!researchTools.has(name))delete event.tools[name]
  if(event.tools?.execute){
   const example=JSON.stringify({code:'return await tools.quests.get({id:"<assigned Quest ID>"})'})
   event.tools.execute.description='Save and verify assigned Quest results with this callable native tool. Call execute with '+example+'. To save, call tools.quests.update({id,steps:[{id:stepID,state:"done",note:actualFinding}]}) inside code, then get to verify. tools.quests methods are called inside execute, not as a separate top-level tool.\n'+(event.tools.execute.description??'')
  }
  const tools=Object.keys(event.tools??{});save(event.sessionID,{modelTools:tools})
  if(!tools.includes('execute'))throw new QuestError('WORKER_TOOLS_UNAVAILABLE','Worker cannot save assigned Quest results: the host exposed neither Code Mode execute nor quest. Parent must repair tool readiness before another dispatch.')
 })
 await ctx.session.hook('http.request',async(event:any)=>{
  const assignment=run(event.sessionID);if(!assignment&&userGiverID(store)!==event.sessionID)return
  if(assignment){
   const session=event.agent==='compaction'?await ctx.session.get({sessionID:event.sessionID}):undefined
   assertWorkerRequestIdentity(assignment,event,session?.data??session)
  }
  try{const body=await event.request.clone().json();if(Array.isArray(body.tools))save(event.sessionID,{outboundTools:names(body.tools),requestKind:event.kind??'unknown'})}catch(error){console.error('[quests] worker capability observation failed',String(error))}
 })
}
