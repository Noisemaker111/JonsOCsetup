import { inspectHostExecutable } from '../project-router/executable.mjs'
import {reviewedAgentConfig} from './runtime-contract.mjs'
/** No-cost installed-host catalog and destination binding acceptance. No worker dispatch. */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hostExecutable, runArgv, DiscoveryHost } from '../project-router/host'
import {QuestStore} from '../quest/store'
import {projectIdentity} from '../quest/project'
import {readEvents} from '../quest/journal'
const hostIdentity=inspectHostExecutable()
const root=resolve(import.meta.dir,'..'),dir=join(root,'.visual-e2e','project-router-'+Date.now()),hub=join(dir,'hub'),target=join(dir,'destination')
const runtimeIndex=process.argv.indexOf('--runtime-root'),runtimeRoot=runtimeIndex>=0?resolve(process.argv[runtimeIndex+1]):root
for(const path of [hub,target,join(dir,'fixture-plugin'),join(dir,'ledger')])mkdirSync(path,{recursive:true})
writeFileSync(join(target,'AGENTS.md'),'Isolated destination fixture. Reply DESTINATION_OK; no files or external resources.\n')
for(const args of [['init',target],['-C',target,'add','AGENTS.md'],['-C',target,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']]){const result=await runArgv('git',args);if(result.code!==0)throw new Error('Isolated Git fixture setup failed')}
const store=new QuestStore(join(dir,'ledger')),project=projectIdentity(target),questID='01j00000000000000000000998'
store.create({id:questID,title:'Isolated destination binding',objective:'Verify destination operations',description:'Fixture only',contractVersion:2,project,stages:[{id:'verify',title:'Verify fixture',commandID:'verify',status:'pending',needs:[]}]})
writeFileSync(join(dir,'dispatch-policy.json'),JSON.stringify({version:1,routes:[],request:{allowedRouteIDs:[]},commandsByProject:{[project.id]:{verify:{description:'Isolated harmless check',argv:[process.execPath,'-e','console.log("DESTINATION_COMMAND_OK")'],timeoutMilliseconds:5000}}}}))
writeFileSync(join(dir,'quest-settings.json'),JSON.stringify({version:1,workspaceMode:'shared'}))
const giver=process.argv.includes('--giver')
const selectedConfigRoot=join(dir,'reviewed');mkdirSync(join(selectedConfigRoot,'generations/selected'),{recursive:true});writeFileSync(join(selectedConfigRoot,'generations/selected/plugin-set.json'),'{}');writeFileSync(join(selectedConfigRoot,'generations/selected/opencode.jsonc'),readFileSync(join(runtimeRoot,'opencode.jsonc')))
const reviewedContent=giver?reviewedAgentConfig(selectedConfigRoot,'selected'):undefined
const observations:any[]=[];let destinationSeen=false
const provider=Bun.serve({port:0,async fetch(request){
 const body=await request.json() as any;const messages=body.messages??[],tools=body.tools??[]
 const text=JSON.stringify(messages),isDestination=text.includes('Original user request:')
 const results=messages.filter((m:any)=>m.role==='tool')
 observations.push({tools:tools.map((t:any)=>t.function?.name??t.name),catalog:{select:JSON.stringify(body).includes('project_select'),route:JSON.stringify(body).includes('project_route')},destination:isDestination,results:results.map((r:any)=>r.content)})
 if(isDestination&&results.length)destinationSeen=true
 const code=isDestination?`const q=await tools.quest({action:'get',id:'${questID}'});const updated=await tools.quest({action:'update',id:'${questID}',update:{steps:[{id:'verify',state:'pending',note:'Verified destination tool binding'}]}});const run=await tools.quest({action:'run',id:'${questID}',run:{stepIDs:['verify'],files:['AGENTS.md']}});return {q,updated,run}`:`const discovered=await tools.project_discover({source:"projects",limit:2});const commandCheck=${giver?"{notApplicable:true}":"await tools.fixture_goal_status({})"};let mismatch;try{await tools.quest({action:'get',id:'${questID}'})}catch(e){mismatch=String(e)};const s=await tools.project_select({action:'select',selectors:[${JSON.stringify(target)}]}); const r=await tools.project_route({revision:s.revision,requestKey:'acceptance-one',text:'Read, update and run the existing isolated fixture Quest ${questID}, then reply DESTINATION_OK.'});return {commandCheck,mismatch,selection:s,routing:r}`
 if(!isDestination&&results.length){const deadline=Date.now()+15000;while(!destinationSeen&&Date.now()<deadline)await Bun.sleep(50)}
 const delta=tools.length&&!results.length?{role:'assistant',tool_calls:[{index:0,id:'router-acceptance',type:'function',function:{name:'execute',arguments:JSON.stringify({code})}}]}:{content:isDestination?'DESTINATION_OK':'ROUTER_ACCEPTANCE_DONE'}
 return new Response('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'model',choices:[{index:0,delta,finish_reason:'tool_calls' in delta?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
}})
const url=(p:string)=>JSON.stringify(pathToFileURL(join(runtimeRoot,p)).href)
writeFileSync(join(dir,'fixture-plugin/package.json'),JSON.stringify({name:'router-fixture',version:'1.0.0',main:'index.ts',type:'module'}))
writeFileSync(join(dir,'fixture-plugin/index.ts'),`import {appendFileSync} from 'node:fs';import {define} from '@opencode-ai/plugin/v2/promise';import quests from ${url('quest/server.ts')};import router from ${url('project-router/server.ts')};export default define({id:'router-acceptance',async setup(ctx){await quests.setup(ctx);await ctx.tool.transform(editor=>editor.add({name:'fixture_goal_status',description:'Verify the installed goal status command',input:{type:'object',properties:{},additionalProperties:false},output:{type:'object',additionalProperties:true},execute:async(_input,context)=>{const commands=await ctx.command.list({});await ctx.session.command({sessionID:context.sessionID,command:'goal',text:'status'});const output={goalCommandExecuted:true,commands};return{output,content:JSON.stringify(output)}}}));const dispose=await router.setup(ctx);const abort=new AbortController();void(async()=>{for await(const event of await ctx.event.subscribe({signal:abort.signal})){if(event.type.startsWith('session.execution.'))appendFileSync(${JSON.stringify(join(dir,'event-shapes.jsonl'))},JSON.stringify(event)+'\\n')}})().catch(()=>{});return ()=>{abort.abort();dispose?.()}}})`)
writeFileSync(join(dir,'opencode.jsonc'),JSON.stringify({$schema:'https://opencode.ai/config.json',plugin:['./fixture-plugin'],providers:{fixture:{package:'@opencode-ai/ai/providers/openai-compatible',env:[],settings:{baseURL:`http://127.0.0.1:${provider.port}/v1`,apiKey:'fixture-only'},models:{model:{limit:{context:128000,output:3000},variants:[{id:'medium',settings:{reasoningEffort:'medium'}}]}}}},agents:{'quest-giver':{permissions:[{action:'*',resource:'*',effect:'deny'},{action:'execute',resource:'*',effect:'allow'},{action:'quest',resource:'*',effect:'allow'}]},general:{model:'fixture/model#medium',permissions:[{action:'*',resource:'*',effect:'allow'}]}}}))
const journal=join(dir,'orchestration.jsonl');mkdirSync(journal+'.lock')
const started=Date.now()
try{
 const outcome=await runArgv(hostExecutable(),['run','--standalone','--auto','--agent',giver?'quest-giver':'general','-m','fixture/model#medium','Route to the explicitly authorized isolated destination using project_select and project_route.'],{cwd:hub,timeout:90000,maxBytes:256000,env:{...process.env,...(reviewedContent?{OPENCODE_CONFIG_CONTENT:reviewedContent}:{}),OPENCODE_CONFIG_DIR:dir,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_QUEST_ROOT:join(dir,'ledger'),OPENCODE_DISPATCH_POLICY:join(dir,'dispatch-policy.json'),OPENCODE_QUEST_SETTINGS:join(dir,'quest-settings.json'),OPENCODE_ORCHESTRATION_LEDGER:journal,OPENCODE_DISABLE_AUTOUPDATE:'1'}})
 const actual=store.read(questID)!,serialized=JSON.stringify(observations),checks={exit:outcome.code===0,catalog:observations.some(o=>o.catalog.select&&o.catalog.route),delivered:serialized.includes('delivered'),destination:destinationSeen,questUpdate:readEvents(store.runtime,questID).some(e=>e.type==='patched'&&JSON.stringify(e.payload).includes('Verified destination tool binding')),questRun:actual.stages[0].status==='done'&&actual.sessions.some(s=>s.state==='completed'),mismatch:serialized.includes('does not belong'),nonblocking:Date.now()-started<90000,slash:giver||observations.some(o=>o.results.some(r=>{try{return JSON.parse(r).commandCheck?.goalCommandExecuted===true}catch{return false}}))}
 const report={host:hostIdentity,ok:Object.values(checks).every(Boolean),checks,milliseconds:Date.now()-started,outcome,observations,events:existsSync(join(dir,'event-shapes.jsonl'))?readFileSync(join(dir,'event-shapes.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x)):[],source:root,runtimeRoot,loaded:runtimeRoot===root?'direct source fixture; no selected generation change':'explicit runtime-root fixture; selected state not changed',limitations:['No inference worker dispatch in this fixture','Goal lifecycle shared/worktree acceptance is a separate gate']}
 writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({path:join(dir,'report.json'),ok:report.ok,checks,outcome},null,2));if(!report.ok)process.exitCode=1
}finally{provider.stop()}
