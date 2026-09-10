import {assertWorkerIdentity} from './worker-identity'
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
 const save=(id:string,value:any)=>{const row=run(id);if(!row?.runID)return;const dir=join(store.runtime,'worker-capabilities'),file=join(dir,row.runID+'.json');mkdirSync(dir,{recursive:true});const prior=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};const temporary=file+'.'+process.pid+'.tmp';writeFileSync(temporary,JSON.stringify({...prior,...value,sessionID:id,observedAt:new Date().toISOString()}));renameSync(temporary,file)}
 await ctx.session.hook('context',(event:any)=>{
  const assignment=run(event.sessionID);if(!assignment)return
  assertWorkerIdentity(assignment,event)
  if((assignment.scope as any)?.readOnly===true)for(const name of Object.keys(event.tools??{}))if(!researchTools.has(name))delete event.tools[name]
  if(event.tools?.execute){
   const example=JSON.stringify({code:'return await tools.quest({action:"get",id:"<assigned Quest ID>"})'})
   event.tools.execute.description='Save and verify assigned Quest results with this callable native tool. Call execute with '+example+'. To save, call tools.quest({action:"update",id,update:{steps:[{id:stepID,state:"done",note:actualFinding}]}}) inside code, then get to verify. tools.quest is called inside execute, not as a separate top-level tool.\n'+(event.tools.execute.description??'')
  }
  const tools=Object.keys(event.tools??{});save(event.sessionID,{modelTools:tools})
  if(!tools.includes('execute')&&!tools.includes('quest'))throw new QuestError('WORKER_TOOLS_UNAVAILABLE','Worker cannot save assigned Quest results: the host exposed neither Code Mode execute nor quest. Parent must repair tool readiness before another dispatch.')
 })
 await ctx.session.hook('http.request',async(event:any)=>{
  const assignment=run(event.sessionID);if(!assignment)return
  assertWorkerIdentity(assignment,event)
  try{const body=await event.request.clone().json();if(Array.isArray(body.tools))save(event.sessionID,{outboundTools:names(body.tools),requestKind:event.kind??'unknown'})}catch(error){console.error('[quests] worker capability observation failed',String(error))}
 })
}
