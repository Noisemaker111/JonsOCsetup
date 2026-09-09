import {QuestWorkspaces} from './workspaces'
import {readAllQuests} from './index'
import {coordination} from './coordination'
import {QuestError} from './api'
import type {QuestStore} from './store'
const guardedHosts=new WeakSet<object>()
export const researchGuardReady=(host:object)=>guardedHosts.has(host)
const researchTools=new Set(['read','glob','grep','skill','webfetch','websearch','quest','usage_status','execute','tool_search'])
/** A resumed session must not write under an assignment whose ownership was released. */
export function assertSharedAssignment(store:QuestStore,sessionID:string) {
 const run=readAllQuests(store.projectRoot,{includeArchived:true}).flatMap(x=>x.quest?.sessions??[]).find(s=>s.openCodeSessionId===sessionID||s.sessionID===sessionID)
 if(!run?.runID)return
 const manager=new QuestWorkspaces(store.runtime),workspace=manager.get(run.runID)
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
   draft.update(id,(tool:any)=>{const original=tool.execute;if(typeof original!=='function')return;tool.execute=async(input:any,context:any)=>{if(context?.sessionID){const run=readAllQuests(store.projectRoot,{includeArchived:true}).flatMap(row=>row.quest?.sessions??[]).find(run=>run.openCodeSessionId===context.sessionID||run.sessionID===context.sessionID);if((run?.scope as any)?.readOnly===true){const workspace=run?.runID&&new QuestWorkspaces(store.runtime).get(run.runID);if(!workspace||workspace.mode!=='research')throw new QuestError('RESEARCH_BINDING_FAILED','Read-only research workspace is unavailable');new QuestWorkspaces(store.runtime).verify(workspace);if(!researchTools.has(id))throw new QuestError('RESEARCH_WRITE_DENIED','Read-only research cannot run '+id+'; record findings through the assigned Quest step')}else if(['edit','write','patch','apply_patch','shell','bash'].includes(id))assertSharedAssignment(store,context.sessionID)}return original(input,context)}})
  }
 })
 if(ctx.session)guardedHosts.add(ctx.session)
}
