import {existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {questChanges} from './change-view'
import {QuestWorkspaces} from './workspaces'
import {createInterface} from 'node:readline'
import {QuestStore} from './store'
import {questRoot} from './root'
import {questsAPI,QuestError} from './api'
import {projectIdentity} from './project'
import {coordination} from './coordination'
import {QUEST_TOOL_INPUT} from './tool-schema.mjs'
import {validateToolSchema} from './codex/validate-schema.mjs'
import {consumeTicket} from './codex/runtime'
import {toolSummary,toolDetail,toolSection} from './tool-projection'
const instructions='Quest stores shared titles, descriptions, plans, status and deliverables. Use quest list/get/create/update; hooks handle checkout ownership and host context. Work in this session and keep decisions here. Record actual checks and attach deliverables. Implementation, verification and integration are separate steps. Use inspect for full records and ownership diagnostics. Do not use OpenCode dispatch.'
export function questMCP(options:{store?:QuestStore}={}){
 const store=options.store??new QuestStore(questRoot())
 const schema:any=structuredClone(QUEST_TOOL_INPUT)
 schema.properties.action.enum=['list','get','create','update','inspect']
 delete schema.properties.run

 for(const k of ['preference','workspaceMode','cancelContinuation'])delete schema.properties.update.properties[k]

 return async(message:any)=>{
  if(message.id===undefined)return
  let result:any
  try{
   switch(message.method){
    case 'initialize':result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'quest',version:'1.0.0'},instructions};break
    case 'ping':result={};break
    case 'tools/list':result={tools:[{name:'quest',description:'Create, read and update shared Quests, plans and deliverables. Inspect retrieves full diagnostic records.',inputSchema:schema}]};break
    case 'tools/call':{
     try{
      if(message.params?.name!=='quest')throw new QuestError('UNKNOWN_TOOL','Use quest')
      const {_questTicket,...input}=message.params.arguments??{}
      validateToolSchema(input,schema)
      const context=consumeTicket(store,_questTicket)
      const api=questsAPI(store,{project:projectIdentity(context.directory),sessionID:'codex:'+context.sessionID,requestID:String(message.id)},async()=>{throw new QuestError('UNSUPPORTED_HOST','Work in the current Codex session')})
      let output:any
      switch(input.action){
       case 'list':{const result=api.list(input.query);output={...result,items:result.items.map(row=>toolSummary(store.read(row.id)!)),detail:'Use get for a compact record and inspect.section for full evidence'};break}
       case 'get':api.get(input.id);output=toolDetail(store.read(input.id)!);break
       case 'create':{const saved=api.create(input.create);output={id:saved.id,title:input.create.title,steps:saved.steps};break}
       case 'update':api.update(input.id,input.update);output={ok:true};break
       case 'inspect':{
        if(input.id)api.get(input.id)
        const q=input.id?store.read(input.id):undefined
        if(!input.inspect){output={...(q?{record:toolDetail(q)}:{}),ownership:coordination(store,{...context,host:'codex'})({action:'status'})};break}
        if(!q)throw new QuestError('INVALID_INPUT','Choose a Quest before inspecting its details')
        const section=input.inspect.section
        let value:unknown
        switch(section){
         case 'description':value=q.description;break
         case 'reward':value=q.reward;break
         case 'steps':value=q.stages;break
         case 'runs':value=q.sessions;break
         case 'artifacts':value=q.evidence;break
         case 'changes':value=questChanges(q,new QuestWorkspaces(store.runtime));break
         case 'continuation':{const file=join(store.runtime,'continuations.json');value=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).filter((row:{questID:string})=>row.questID===q.id):[];break}
         default:throw new QuestError('INVALID_INPUT','Unknown inspect section')
        }
        output={id:q.id,project:q.project,...toolSection(value,section,input.inspect.offset,input.inspect.limit)};break
       }
       default:throw new QuestError('INVALID_OPERATION','Use list, get, create, update or inspect')
      }
      result={content:[{type:'text',text:JSON.stringify(output)}]}
     }catch(e){result={isError:true,content:[{type:'text',text:JSON.stringify({code:e instanceof QuestError?e.code:(e as any)?.code??'QUEST_ERROR',message:e instanceof Error?e.message:String(e)})}]}}
     break
    }
    default:return {jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}}
   }
   return {jsonrpc:'2.0',id:message.id,result}
  }catch(e){return {jsonrpc:'2.0',id:message.id,error:{code:-32603,message:String(e)}}}
 }
}
if(import.meta.main){const dispatch=questMCP();for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){try{const result=await dispatch(JSON.parse(line));if(result)console.log(JSON.stringify(result))}catch{console.log(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}))}}}
