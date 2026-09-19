import {acquireLock,acquireLockAsync,LockBusyError,type HeldLock} from "./locking"
import {workspaceWaitSignal} from './host-observation'
import {QuestWorkspaces} from './workspaces'
import {readQuestLedger} from './index'
import {coordination} from './coordination'
import {QuestError} from './api'
import type {QuestStore} from './store'
import type {Quest,QuestSession} from './types'
const guardedHosts=new WeakSet<object>()
export const researchGuardReady=(host:object)=>guardedHosts.has(host)
export const researchTools=new Set(['read','glob','grep','skill','webfetch','websearch','quests_list','quests_get','quests_update','quests_wait','quests_status','quests_plan','quests_inspect','quests_report','quest_report','usage_status','execute','tool_search'])
export type QuestMembership={quest:Quest;run:QuestSession}
/**
 * Which Quest runs a host session belongs to, without re-deriving the ledger.
 *
 * The guard wraps every tool of every session, and it derived the whole ledger up to three times per
 * tool call: once to find a read-only research scope, once for the membership, and once more inside
 * assertSharedAssignment. Almost every session is not a worker at all, and the answer only changes
 * when a record changes, so it is built once per ledger fingerprint and then read. What a tool call
 * now pays is the stat of each record that the parse cache already needed.
 */
let sessionIndex:{fingerprint:string;index:Map<string,QuestMembership[]>}|undefined
export function questMemberships(store:QuestStore,sessionID:string):QuestMembership[] {
 const {rows,fingerprint}=readQuestLedger(store.projectRoot,{includeArchived:true})
 if(sessionIndex?.fingerprint!==fingerprint){
  const index=new Map<string,QuestMembership[]>()
  for(const {quest} of rows){
   if(!quest)continue
   for(const run of quest.sessions)for(const id of new Set([run.openCodeSessionId,run.sessionID])){
    if(!id)continue
    const held=index.get(id);if(held)held.push({quest,run});else index.set(id,[{quest,run}])
   }
  }
  sessionIndex={fingerprint,index}
 }
 return sessionIndex.index.get(sessionID)??[]
}
/** A resumed session must not write under an assignment whose ownership was released. */
export function assertSharedAssignment(store:QuestStore,sessionID:string,membership?:QuestMembership[]) {
 const run=(membership??questMemberships(store,sessionID))[0]?.run
 if(!run?.runID)return
 const manager=new QuestWorkspaces(store.runtime),workspace=manager.get(run.runID)
 if(workspace?.removed)throw new QuestError('WORKSPACE_RETIRED','This checkout was cleaned after turn-in. Reopen the Quest and start a new run to get an owned workspace.')
 if(workspace?.mode!=='shared')return
 if(workspace.sharedReleased)throw new QuestError('SHARED_ASSIGNMENT_ENDED','This shared assignment ended and released its files. Continue through a new Quest run so ownership is acquired before editing.')
 manager.verify(workspace)
 const result=coordination(store,{directory:workspace.root,sessionID:'quest-run:'+run.runID,host:'opencode'})({action:'update',scopes:workspace.fileScopes,activity:'Shared worker executing'})
 if(!result.acquired)throw new QuestError('SHARED_SCOPE_CONFLICT','Shared file reservation changed; reconcile before editing')
}
export async function installSharedWorkspaceGuard(ctx:any,store:QuestStore) {
 const register=ctx.tool?.transform??ctx.tool?.catalog
 if(typeof register!=='function')throw new Error('Workspace guard requires host tool transform')
 await register((draft:any)=>{
  for(const {id} of draft.list()) {
   if(!draft.get(id))continue
   draft.update(id,(tool:any)=>{const original=tool.execute;if(typeof original!=='function')return;tool.execute=async(input:any,context:any)=>{const membership=context?.sessionID?questMemberships(store,context.sessionID):[];if(context?.sessionID){const run=membership[0]?.run;if((run?.scope as any)?.readOnly===true){const workspace=run?.runID&&new QuestWorkspaces(store.runtime).get(run.runID);if(!workspace||workspace.mode!=='research')throw new QuestError('RESEARCH_BINDING_FAILED','Read-only research workspace is unavailable');new QuestWorkspaces(store.runtime).verify(workspace);if(!researchTools.has(id)&&!(id==='quest_guidance'&&['acknowledge','status'].includes(input?.action)))throw new QuestError('RESEARCH_WRITE_DENIED','Read-only research cannot run '+id+'; record findings through the assigned Quest step')}else if(['edit','write','patch','apply_patch','shell','bash'].includes(id))assertSharedAssignment(store,context.sessionID,membership)}const member=membership[0]&&{q:membership[0].quest,s:membership[0].run};
     if(member&&['edit','write','patch','apply_patch','shell','bash'].includes(id)){
      const runID=member.s.runID;if(member.q.state==='Archived')throw new QuestError('WORKSPACE_RETIRED','This Quest was turned in; reopen it and start a new worker before editing.')
      if(runID){
       let lock:HeldLock|undefined,waiting:ReturnType<typeof workspaceWaitSignal>|undefined
       try{
        try{lock=acquireLock(store.runtime,'workspace-'+runID,{timeoutMs:0})}catch(error){
         if(!(error instanceof LockBusyError))throw error
         waiting=workspaceWaitSignal(ctx.session,context.sessionID)
         lock=await acquireLockAsync(store.runtime,'workspace-'+runID,waiting.signal)
        }
        waiting?.signal.throwIfAborted()
        assertSharedAssignment(store,context.sessionID,membership)
        if(store.read(member.q.id)?.state==='Archived')throw Error('Quest turned in during tool admission')
        return await original(input,context)
       }finally{waiting?.dispose();lock?.release()}
      }
     }
     return original(input,context)}})
  }
 })
 if(ctx.session)guardedHosts.add(ctx.session)
}
