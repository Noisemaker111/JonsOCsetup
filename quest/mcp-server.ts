/** Codex uses the same authenticated product API as the installed CLI. */
import {createInterface} from 'node:readline'
import {sessionContext} from './codex/runtime'
import {QuestStore} from './store'
import {questRoot} from './root'
import {createQuestClient} from './client.mjs'
import {questOperations} from './operations.mjs'
import {validateToolSchema} from './codex/validate-schema.mjs'

export function questMCP(options:{client?:Record<string,Function>;sessionStore?:QuestStore}={}){
 const client=options.client??createQuestClient()
 const sessionStore=options.sessionStore??new QuestStore(questRoot())
 return async(message:any)=>{
  if(message.id===undefined)return
  let result:any
  switch(message.method){
   case 'initialize':result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'quest',version:'1.0.0'},instructions:'Use the named Quest operations. CLI quest plan and MCP quest.plan read the same saved plan. Quest storage and dispatch belong to the connected OpenCode service; local checkout hooks coordinate implementation tools independently.'};break
   case 'ping':result={};break
   case 'tools/list':result={tools:Object.entries(questOperations).map(([name,op]:[string,any])=>({name,description:op.description,inputSchema:op.input,outputSchema:op.output,annotations:op.annotations}))};break
   case 'tools/call':{
    try{
     const name=message.params?.name,args=message.params?.arguments??{}
     if(!Object.hasOwn(questOperations,name))throw Object.assign(Error('Unknown Quest operation'),{code:'UNKNOWN_TOOL'})
     validateToolSchema(args,questOperations[name].input)
     sessionContext(sessionStore,message.params?._meta)
     const output=await client[name](args)
     result={content:[{type:'text',text:JSON.stringify(output)}],structuredContent:output}
    }catch(error:any){result={isError:true,content:[{type:'text',text:JSON.stringify({code:error.code??'REQUEST_FAILED',message:error.message??String(error)})}]}}
    break
   }
   default:return {jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}}
  }
  return {jsonrpc:'2.0',id:message.id,result}
 }
}
if(import.meta.main){const dispatch=questMCP();for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){try{const result=await dispatch(JSON.parse(line));if(result)console.log(JSON.stringify(result))}catch{console.log(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}))}}}
