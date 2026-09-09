import {coordination,COORDINATION_INPUT,COORDINATION_DESCRIPTION} from './coordination'
import {readAllQuests} from './index'
import {QuestWorkspaces} from './workspaces'
import {QuestError} from './api'
import type {QuestStore} from './store'
import type {QuestHost} from './runtime'
export function nativeWorkspaceTool(store:QuestStore,host:QuestHost) {
 return {name:'quest_workspace',description:COORDINATION_DESCRIPTION,input:COORDINATION_INPUT,output:{type:'object',additionalProperties:true},execute:async(input:any,context:any)=>{
  if(!context?.sessionID)throw new QuestError('HOST_CONTEXT_REQUIRED','Host session identity is required')
  const response=await host.get({sessionID:context.sessionID}),directory=(response?.data??response)?.location?.directory
  const run=readAllQuests(store.projectRoot,{includeArchived:true}).flatMap(x=>x.quest?.sessions??[]).find(s=>s.openCodeSessionId===context.sessionID||s.sessionID===context.sessionID)
  const workspace=run?.runID?new QuestWorkspaces(store.runtime).get(run.runID):undefined
  if(run && input.action!=='status' && (workspace?.mode!=='shared'||input.action!=='update'||input.scopes!==undefined||input.questID!==undefined||input.title!==undefined))throw new QuestError('WORKER_SCOPE_CHANGE_DENIED','Workers inspect reservations and refresh activity. Givers assign file scopes; observed terminal outcomes release shared ownership.')
  const sessionID=workspace?.mode==='shared'?'quest-run:'+run!.runID:context.sessionID
  const output=coordination(store,{directory,sessionID,host:'opencode'})(input)
  return {output,content:JSON.stringify(output)}
 }}
}
