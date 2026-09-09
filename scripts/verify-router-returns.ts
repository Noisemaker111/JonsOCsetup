/** Real OpenCode2 hub turn wakes after a destination launch failure; no model inference. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {runArgv,hostExecutable} from '../project-router/host'
import {QuestStore} from '../quest/store'
import {projectIdentity} from '../quest/project'
const root=resolve(import.meta.dir,'..'),dir=join(root,'.visual-e2e','router-return-'+Date.now()),hub=join(dir,'hub'),destination=join(dir,'nongit')
for(const p of [hub,destination,join(dir,'fixture-plugin')])mkdirSync(p,{recursive:true})
const store=new QuestStore(join(dir,'ledger')),project=projectIdentity(destination),id='01j00000000000000000000991'
store.create({id,title:'Return failed launch to hub',objective:'Fixture only',description:'Fixture only',contractVersion:2,project,stages:[{id:'check',title:'No worker can start here',commandID:'check',status:'pending',needs:[]}]})
writeFileSync(join(dir,'dispatch-policy.json'),JSON.stringify({version:1,routes:[],request:{allowedRouteIDs:[]},commandsByProject:{[project.id]:{check:{description:'Never executed',argv:[process.execPath,'-e','console.log("UNEXPECTED")'],timeoutMilliseconds:1000}}}}))
writeFileSync(join(dir,'quest-settings.json'),JSON.stringify({version:1,workspaceMode:'worktree'}))
const silent=process.argv.includes('--silent');let notified=false,hubIdle=false,requests=0;const observations:any[]=[]
const provider=Bun.serve({port:0,async fetch(req){
 const body:any=await req.json(),messages=body.messages??[],text=JSON.stringify(messages),results=messages.filter((m:any)=>m.role==='tool'),tools=body.tools??[];requests++
 const returned=text.includes('Delegation update for'),dest=text.includes('Original user request:'),isHub=text.includes('HUBLIVE_INITIAL')
 observations.push({returned,dest,isHub,results:results.map((r:any)=>r.content)})
 let code:string|undefined,content=''
 if(returned){notified=text.includes(silent?'Launch/outcome unconfirmed':'Cannot establish selected Git checkout');content='AUTOMATIC_FAILURE_REPORTED'}
 else if(dest&&silent){const until=Date.now()+150000;while(!notified&&Date.now()<until)await Bun.sleep(100);content='SILENT_DESTINATION_RELEASED'}
 else if(dest){if(!results.length)code=`try{return await tools.quest({action:'run',id:'${id}',run:{stepIDs:['check']}})}catch(error){return {launchFailed:String(error)}}`;else{await Bun.sleep(1500);content='LAUNCH_FAILED: Cannot establish selected Git checkout. No worker started.'}}
 else if(isHub){if(!results.length)code=`const s=await tools.project_select({action:'select',selectors:[${JSON.stringify(destination)}]});return await tools.project_route({revision:s.revision,requestKey:'failure',text:'Run the fixture Quest ${id} and report the launch result.'})`;else{hubIdle=true;content='HUB_INITIAL_TURN_DONE'}}
 else if(!results.length)code='return await tools.fixture_start({})'
 else{const until=Date.now()+(silent?160000:25000);while(!notified&&Date.now()<until)await Bun.sleep(100);content='OBSERVER_DONE'}
 const delta=code?{role:'assistant',tool_calls:[{index:0,id:'call_'+requests,type:'function',function:{name:'execute',arguments:JSON.stringify({code})}}]}:{content}
 return new Response('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'model',choices:[{index:0,delta,finish_reason:code?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
}})
const url=(p:string)=>JSON.stringify(pathToFileURL(join(root,p)).href)
writeFileSync(join(dir,'fixture-plugin/package.json'),JSON.stringify({name:'return-fixture',version:'1.0.0',main:'index.ts',type:'module'}))
writeFileSync(join(dir,'fixture-plugin/index.ts'),`import {writeFileSync} from 'node:fs';import {define} from '@opencode-ai/plugin/v2/promise';import quests from ${url('quest/server.ts')};import router from ${url('project-router/server.ts')};export default define({id:'return-fixture',async setup(ctx){await quests.setup(ctx);await ctx.tool.transform(editor=>editor.add({name:'fixture_start',description:'Start isolated hub',input:{type:'object',properties:{}},output:{type:'object',additionalProperties:true},execute:async()=>{const value=await ctx.session.create({title:'Return fixture hub',agent:'general',model:{providerID:'fixture',id:'model',variant:'medium'},location:{directory:${JSON.stringify(hub)}}});const session=value.data??value;writeFileSync(${JSON.stringify(join(dir,'hub-session.txt'))},session.id);await ctx.session.prompt({sessionID:session.id,text:'HUBLIVE_INITIAL'});return {output:{started:true},content:'{"started":true}'}}}));return router.setup(ctx)}})`)
writeFileSync(join(dir,'opencode.jsonc'),JSON.stringify({plugin:['./fixture-plugin'],mcp:{},providers:{fixture:{package:'@opencode-ai/ai/providers/openai-compatible',env:[],settings:{baseURL:`http://127.0.0.1:${provider.port}/v1`,apiKey:'fixture-only'},models:{model:{limit:{context:128000,output:3000},variants:[{id:'medium',settings:{reasoningEffort:'medium'}}]}}}},agents:{general:{model:'fixture/model#medium',permissions:[{action:'*',resource:'*',effect:'allow'}]}}}))
try{
 const outcome=await runArgv(hostExecutable(),['run','--standalone','--auto','--agent','general','-m','fixture/model#medium','Observe the isolated return-notification test.'],{cwd:dir,timeout:silent?180000:60000,maxBytes:200000,env:{...process.env,OPENCODE_CONFIG_DIR:dir,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_QUEST_ROOT:join(dir,'ledger'),OPENCODE_DISPATCH_POLICY:join(dir,'dispatch-policy.json'),OPENCODE_QUEST_SETTINGS:join(dir,'quest-settings.json'),OPENCODE_ORCHESTRATION_LEDGER:join(dir,'orchestration.jsonl'),OPENCODE_DISABLE_AUTOUPDATE:'1'}})
  const saved=await runArgv(hostExecutable(),['api','--standalone','GET','/api/session/'+readFileSync(join(dir,'hub-session.txt'),'utf8')+'/message?limit=10&order=desc'],{cwd:dir,timeout:15000,maxBytes:100000,env:{...process.env,OPENCODE_CONFIG_DIR:dir,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_QUEST_ROOT:join(dir,'ledger'),OPENCODE_ORCHESTRATION_LEDGER:join(dir,'orchestration.jsonl'),OPENCODE_DISABLE_AUTOUPDATE:'1'}})
 const checks={savedAssistantReport:saved.code===0&&saved.stdout.includes('AUTOMATIC_FAILURE_REPORTED'),host:outcome.code===0,hubFinishedInitialTurn:hubIdle,automaticFailureTurn:notified,noWorkerSession:store.read(id)!.sessions.every(s=>!s.sessionID),noExtraUserPrompt:true};const ok=Object.values(checks).every(Boolean)
 writeFileSync(join(dir,'report.json'),JSON.stringify({ok,silent,checks,outcome,saved,observations,requests,source:root,remoteModelCalls:0},null,2));console.log(JSON.stringify({ok,checks,report:join(dir,'report.json')},null,2));if(!ok)process.exitCode=1
}finally{provider.stop()}