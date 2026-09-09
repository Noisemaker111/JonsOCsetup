import {readUserGiver,saveUserGiver} from './giver-registry.mjs'
import {acquireLock} from './locking'
import {readAllQuests} from './index'
import {physicalDirectory,projectIdentity,verifySourceBinding} from './project'
import {QuestError,type QuestContext} from './api'
import {QuestStore} from './store'
import {questRoot} from './root'
const unwrap=(v:any)=>v?.data??v
const worker=(store:QuestStore,id:string)=>readAllQuests(store.projectRoot,{includeArchived:true}).some(r=>r.quest?.sessions.some(s=>(s.openCodeSessionId??s.sessionID)===id))
export const userGiverID=(store=new QuestStore(questRoot()))=>readUserGiver(store.runtime)?.sessionID as string|undefined
function eligible(store:QuestStore,row:any){if(!row?.id?.startsWith('ses_')||row.parentID||row.parent_id||worker(store,row.id)||row.agent!=='quest-giver')throw new QuestError('GIVER_IDENTITY_INVALID','The user giver must be a verified root Quest Giver, never an execution worker')}
export async function bindUserGiver(store:QuestStore,host:any,sessionID:string){
 const row=unwrap(await host.get({sessionID}));if(row?.id!==sessionID)throw new QuestError('GIVER_IDENTITY_INVALID','Host returned a different giver');eligible(store,row)
 const lock=acquireLock(store.runtime,'user-giver',{timeoutMs:0})
 try{const prior=readUserGiver(store.runtime);if(prior&&prior.sessionID!==sessionID)throw new QuestError('SINGLE_GIVER_REQUIRED','Continue in your existing Quest Giver: '+(prior.sessionID??'creation outcome unknown; inspect before retrying'));saveUserGiver(store.runtime,{...prior,state:'bound',sessionID,directory:physicalDirectory(row.location.directory),model:row.model});return row}finally{lock.release()}
}
export async function ensureUserGiver(store:QuestStore,host:any,currentID?:string,directory=process.cwd()){
 const prior=readUserGiver(store.runtime)
 if(prior){if(prior.state!=='bound')throw new QuestError('GIVER_OUTCOME_UNKNOWN','Giver creation is uncertain; inspect the existing session before retrying');const row=unwrap(await host.get({sessionID:prior.sessionID}));if(row?.id!==prior.sessionID)throw new QuestError('GIVER_IDENTITY_INVALID','Host returned a different giver');eligible(store,row);return row}
 if(currentID){const row=unwrap(await host.get({sessionID:currentID}));if(row?.id!==currentID)throw new QuestError('GIVER_IDENTITY_INVALID','Host returned a different session');if(row?.agent==='quest-giver'&&!worker(store,row.id)&&!row.parentID)return bindUserGiver(store,host,row.id)}
 const ids=[...new Set(readAllQuests(store.projectRoot,{includeArchived:true}).flatMap(r=>r.quest?.integrationOwner?.startsWith('ses_')?[r.quest.integrationOwner]:[]))]
 const candidates:any[]=[]
 for(const id of ids){try{const row=unwrap(await host.get({sessionID:id}));if(row?.id!==id)throw new QuestError('GIVER_IDENTITY_INVALID','Host returned a different recorded giver');eligible(store,row);candidates.push(row)}catch(e){if((e as any)?.status!==404)throw e}}
 if(ids.length&&!candidates.length)throw new QuestError('GIVER_UNREACHABLE','Recorded giver is not reachable on this host; reconnect it instead of creating another')
 if(candidates.length){candidates.sort((a,b)=>(Date.parse(b.time?.updated)||Number(b.time?.updated)||0)-(Date.parse(a.time?.updated)||Number(a.time?.updated)||0));return bindUserGiver(store,host,candidates[0].id)}
 const lock=acquireLock(store.runtime,'user-giver',{timeoutMs:0})
 try{if(readUserGiver(store.runtime))throw new QuestError('GIVER_CREATION_BUSY','Another request is establishing your giver; refresh');saveUserGiver(store.runtime,{state:'launching'});try{const created=unwrap(await host.create({title:'Quest Giver',agent:'quest-giver',location:{directory:physicalDirectory(directory)}})),row=unwrap(await host.get({sessionID:created?.id}));eligible(store,row);saveUserGiver(store.runtime,{state:'bound',sessionID:row.id,directory:physicalDirectory(row.location.directory),model:row.model});return row}catch(error){saveUserGiver(store.runtime,{state:'unknown',reason:String(error)});throw error}}finally{lock.release()}
}
export function adoptQuestGiver(store:QuestStore,id:string){const sessionID=userGiverID(store),q=store.read(id);if(!sessionID||!q||q.integrationOwner===sessionID)return q;return store.apply(id,'patched',{integrationOwner:sessionID,extensions:{...q.extensions,previousGivers:[...new Set([...(q.extensions.previousGivers as string[]??[]),...(q.integrationOwner?[q.integrationOwner]:[])])] }},'quest:user-giver',{expectedRevision:q.revision})}
export function selectUserGiverProject(store:QuestStore,sessionID:string,targets:{directory:string}[],revision:number){
 const lock=acquireLock(store.runtime,'user-giver',{timeoutMs:0});try{const row=readUserGiver(store.runtime);if(row?.sessionID!==sessionID)throw new QuestError('SINGLE_GIVER_REQUIRED','Select the project in your existing Quest Giver');const selected=targets.map(t=>({project:projectIdentity(t.directory),directory:physicalDirectory(t.directory)}));saveUserGiver(store.runtime,{...row,selection:{revision,targets:selected}})}finally{lock.release()}
}
export function giverContext(store:QuestStore,session:any,requestID:string,questID?:string):QuestContext {
 const registered=readUserGiver(store.runtime),origin=physicalDirectory(session.location.directory)
 if(!registered||registered.sessionID!==session.id)return {sessionID:session.id,requestID,directory:origin,project:projectIdentity(origin)}
 eligible(store,session)
 const q=questID?store.read(questID):undefined,selected=registered.selection?.targets??[]
 if(!q&&selected.length>1)throw new QuestError('PROJECT_SELECTION_REQUIRED','Select one project for this Quest; all Quests stay with the same giver')
 const directory=q?physicalDirectory((q.extensions.giverSourceDirectory as string)??q.project!.root):selected[0]?.directory??origin
 const project=projectIdentity(directory);if(q?.project&&project.id!==q.project.id)throw new QuestError('PROJECT_MISMATCH','The recorded Quest source no longer belongs to its project')
 return {sessionID:session.id,requestID,project,directory,giverDirectory:origin}
}
export function verifyGiverBinding(store:QuestStore,context:QuestContext,session:any){
 if(!context.giverDirectory)return verifySourceBinding(context,session?.location?.directory)
 if(userGiverID(store)!==context.sessionID||session?.id!==context.sessionID||physicalDirectory(session.location.directory)!==physicalDirectory(context.giverDirectory))throw new QuestError('GIVER_BINDING_CHANGED','The user giver changed; inspect before dispatch')
 eligible(store,session);verifySourceBinding(context,context.directory!)
}
