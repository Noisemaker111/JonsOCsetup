import {readUserGiver,saveUserGiver,releaseUserGiver} from './giver-registry.mjs'
import {acquireLock} from './locking'
import {readAllQuests} from './index'
import {physicalDirectory,projectIdentity,verifySourceBinding} from './project'
import {QuestError,type QuestContext} from './api'
import {QuestStore} from './store'
import {questRoot} from './root'
const unwrap=(v:any)=>v?.data??v
const worker=(store:QuestStore,id:string)=>readAllQuests(store.projectRoot,{includeArchived:true}).some(r=>r.quest?.sessions.some(s=>(s.openCodeSessionId??s.sessionID)===id))
export const userGiverID=(store=new QuestStore(questRoot()))=>readUserGiver(store.runtime)?.sessionID as string|undefined
/**
 * What a conversation has to be to hold the giver binding: a root conversation of the user's own,
 * never an execution worker. This is identity, and it does not change while the conversation lives.
 */
function rootConversation(store:QuestStore,row:any){if(!row?.id?.startsWith('ses_')||row.parentID||row.parent_id||worker(store,row.id))throw new QuestError('GIVER_IDENTITY_INVALID','The user giver must be a verified root conversation, never an execution worker')}
/**
 * What elects one. The quest-giver agent is how a conversation becomes the giver; after that the
 * binding is the session, not the agent its composer happens to be set to. Sending one message
 * through another agent rewrites the session's agent, and requiring it here un-elected the bound
 * giver mid-conversation and left the whole board with none.
 */
function eligible(store:QuestStore,row:any){rootConversation(store,row);if(row.agent!=='quest-giver')throw new QuestError('GIVER_IDENTITY_INVALID','A Quest Giver is elected from a conversation opened with the quest-giver agent')}
export async function bindUserGiver(store:QuestStore,host:any,sessionID:string){
 const row=unwrap(await host.get({sessionID}));if(row?.id!==sessionID)throw new QuestError('GIVER_IDENTITY_INVALID','Host returned a different giver');eligible(store,row)
 const lock=acquireLock(store.runtime,'user-giver',{timeoutMs:0})
 try{const prior=readUserGiver(store.runtime);if(prior&&prior.sessionID!==sessionID)throw new QuestError('SINGLE_GIVER_REQUIRED','Continue in your existing Quest Giver: '+(prior.sessionID??'creation outcome unknown; inspect before retrying'));saveUserGiver(store.runtime,{...prior,state:'bound',sessionID,directory:physicalDirectory(row.location.directory),model:row.model});return row}finally{lock.release()}
}
export async function ensureUserGiver(store:QuestStore,host:any,currentID?:string,directory=process.cwd()){
 const prior=readUserGiver(store.runtime)
 if(prior){if(prior.state!=='bound')throw new QuestError('GIVER_OUTCOME_UNKNOWN','Giver creation is uncertain; inspect the existing session before retrying');const row=unwrap(await host.get({sessionID:prior.sessionID}));if(row?.id!==prior.sessionID)throw new QuestError('GIVER_IDENTITY_INVALID','Host returned a different giver');rootConversation(store,row);return row}
 if(currentID){const row=unwrap(await host.get({sessionID:currentID}));if(row?.id!==currentID)throw new QuestError('GIVER_IDENTITY_INVALID','Host returned a different session');if(row?.agent==='quest-giver'&&!worker(store,row.id)&&!row.parentID)return bindUserGiver(store,host,row.id)}
 const ids=[...new Set(readAllQuests(store.projectRoot,{includeArchived:true}).flatMap(r=>r.quest?.integrationOwner?.startsWith('ses_')?[r.quest.integrationOwner]:[]))]
 const candidates:any[]=[]
 // This is a scan for a giver among records of owners, so only a positive answer counts and
 // everything else is passed over. Two things used to end the scan instead of continuing it: a
 // record naming a worker session or a subsession, and a record the host has no session for --
 // the `status === 404` test never matched how this client reports that, so a deleted owner threw
 // a bare object too. Either one made a single line of history the reason the entire board had no
 // giver and nothing on it could be dispatched. Eligibility stays hard where it decides
 // something: the session actually bound, below and in bindUserGiver.
 let reached=0
 for(const id of ids){
  let row:any
  try{row=unwrap(await host.get({sessionID:id}))}catch{continue}
  if(row?.id!==id)continue
  reached++
  try{eligible(store,row)}catch{continue}
  candidates.push(row)
 }
 // Refusing to create a second giver is about one that exists and this host cannot see, so it
 // rests on the only evidence of that: no recorded owner answered at all. When they answer and
 // none of them is a giver, there is nothing to reconnect to and the board needs one.
 if(ids.length&&!reached)throw new QuestError('GIVER_UNREACHABLE','No recorded Quest Giver answered on this host; reconnect it instead of creating another')
 if(candidates.length){candidates.sort((a,b)=>(Date.parse(b.time?.updated)||Number(b.time?.updated)||0)-(Date.parse(a.time?.updated)||Number(a.time?.updated)||0));return bindUserGiver(store,host,candidates[0].id)}
 const lock=acquireLock(store.runtime,'user-giver',{timeoutMs:0})
 try{if(readUserGiver(store.runtime))throw new QuestError('GIVER_CREATION_BUSY','Another request is establishing your giver; refresh');saveUserGiver(store.runtime,{state:'launching'});try{const created=unwrap(await host.create({title:'Quest Giver',agent:'quest-giver',location:{directory:physicalDirectory(directory)}})),row=unwrap(await host.get({sessionID:created?.id}));if(row?.id!==created?.id)throw new QuestError('GIVER_IDENTITY_INVALID','Host returned a different created giver');eligible(store,row);saveUserGiver(store.runtime,{state:'bound',sessionID:row.id,directory:physicalDirectory(row.location.directory),model:row.model});return row}catch(error){saveUserGiver(store.runtime,{state:'unknown',reason:String(error)});throw error}}finally{lock.release()}
}
export function adoptQuestGiver(store:QuestStore,id:string){const sessionID=userGiverID(store),q=store.read(id);if(!sessionID||!q||q.integrationOwner===sessionID)return q;return store.apply(id,'patched',{integrationOwner:sessionID,extensions:{...q.extensions,previousGivers:[...new Set([...(q.extensions.previousGivers as string[]??[]),...(q.integrationOwner?[q.integrationOwner]:[])])] }},'quest:user-giver',{expectedRevision:q.revision})}
export function selectUserGiverProject(store:QuestStore,sessionID:string,targets:{directory:string}[],revision:number){
 const lock=acquireLock(store.runtime,'user-giver',{timeoutMs:0});try{const row=readUserGiver(store.runtime);if(row?.sessionID!==sessionID)throw new QuestError('SINGLE_GIVER_REQUIRED','Select the project in your existing Quest Giver');const selected=targets.map(t=>({project:projectIdentity(t.directory),directory:physicalDirectory(t.directory)}));saveUserGiver(store.runtime,{...row,selection:{revision,targets:selected}})}finally{lock.release()}
}
export function giverContext(store:QuestStore,session:any,requestID:string,questID?:string):QuestContext {
 const registered=readUserGiver(store.runtime),origin=physicalDirectory(session.location.directory)
 if(!registered||registered.sessionID!==session.id)return {sessionID:session.id,requestID,directory:origin,project:projectIdentity(origin)}
 rootConversation(store,session)
 const q=questID?store.read(questID):undefined,selected=registered.selection?.targets??[]
 if(!q&&selected.length>1)throw new QuestError('PROJECT_SELECTION_REQUIRED','Select one project for this Quest; all Quests stay with the same giver')
 const directory=q?physicalDirectory((q.extensions.giverSourceDirectory as string)??q.project!.root):selected[0]?.directory??origin
 const project=projectIdentity(directory);if(q?.project&&project.id!==q.project.id)throw new QuestError('PROJECT_MISMATCH','The recorded Quest source no longer belongs to its project')
 return {sessionID:session.id,requestID,project,directory,giverDirectory:origin}
}
export function verifyGiverBinding(store:QuestStore,context:QuestContext,session:any){
 if(!context.giverDirectory)return verifySourceBinding(context,session?.location?.directory)
 if(userGiverID(store)!==context.sessionID||session?.id!==context.sessionID||physicalDirectory(session.location.directory)!==physicalDirectory(context.giverDirectory))throw new QuestError('GIVER_BINDING_CHANGED','The user giver changed; inspect before dispatch')
 rootConversation(store,session);verifySourceBinding(context,context.directory!)
}

/**
 * Register the native first conversation even when its first turn is only discussion, and let a
 * deliberately started one take over.
 *
 * `/new` navigates to the home screen (packages/tui/src/app.tsx:697); a session is only created when
 * the first prompt is sent. That session carries the quest-giver agent, this hook fired, the registry
 * still named the previous conversation, and the turn was refused -- so `/new` looked like it did
 * nothing and put you back where you started. Jon reported it twice.
 *
 * Opening a new root conversation with the giver agent is the succession this product already
 * supports: `succeed-giver` releases the binding, and `adoptQuestGiver` re-points a Quest's
 * integration owner at whoever holds it now. Nothing is destroyed -- the registry entry is renamed
 * aside with a timestamp, and the old conversation keeps its history and its Quests.
 *
 * A worker never succeeds anything (excluded above), and a tool call arriving from some other
 * session is still redirected rather than allowed to steal the binding: that path goes through
 * singleUserGiver, not this hook. This is only about a conversation the user has just opened.
 */
export async function installUserGiverContext(store:QuestStore,host:any){
 await host.hook?.('context',async(event:any)=>{
  if(event.agent!=='quest-giver'||worker(store,event.sessionID))return
  let row=await ensureUserGiver(store,host,event.sessionID)
  if(row.id===event.sessionID)return
  const incoming=unwrap(await host.get({sessionID:event.sessionID}))
  if(incoming?.id!==event.sessionID)throw new QuestError('GIVER_IDENTITY_INVALID','Host returned a different session')
  // Only a root conversation of the user's own may take over. Anything else -- a child session that
  // happens to carry the giver agent -- is redirected exactly as it always was, rather than being
  // handed a new error for a case whose behaviour is not changing.
  try{rootConversation(store,incoming)}
  catch{throw new QuestError('SINGLE_GIVER_REQUIRED','Continue in your existing Quest Giver: '+row.id)}
  const previous=releaseUserGiver(store.runtime)
  row=await bindUserGiver(store,host,event.sessionID)
  if(row.id!==event.sessionID)throw new QuestError('SINGLE_GIVER_REQUIRED','Continue in your existing Quest Giver: '+row.id)
  if(Array.isArray(event.system))event.system.push({type:'text',text:`This conversation is now your Quest Giver${previous?`, succeeding ${previous}`:''}. That conversation and its Quests are untouched; workers report here from now on.`})
 })
}
