/** Real-host acceptance: a failed hook must reach both UI and model. No remote inference. */
import {spawn,spawnSync} from 'node:child_process'
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {tmpdir} from 'node:os'
import {createInterface} from 'node:readline'
import {codexExecutable} from '../quest/codex/recovery-command'

const root=resolve(tmpdir(),'hidden-hook-'+Date.now()),candidate=resolve(process.argv[2]??'.candidates/hook-diagnostics')
const pre=process.argv.includes('--pre'),event=pre?'PreToolUse':'PostToolUse'
mkdirSync(join(root,'.codex'),{recursive:true});mkdirSync(join(root,'scripts'))
const git=spawnSync('git',['init',root],{windowsHide:true,encoding:'utf8',timeout:15000})
if(git.status!==0)throw Error(git.stderr||String(git.error))
writeFileSync(join(root,'scripts/hook.js'),"require('fs').writeFileSync("+JSON.stringify(join(root,'hook-ran.txt'))+",'ran');console.error('HOOK_DIAGNOSTIC_SENTINEL');process.exit(1)")
const handler=JSON.parse(readFileSync(join(candidate,'hooks/hooks.json'),'utf8')).hooks[event][0].hooks[0]
writeFileSync(join(root,'.codex/hooks.json'),JSON.stringify({hooks:{[event]:[{hooks:[handler]}]}}))
writeFileSync(join(root,'.codex/config.toml'),'# isolated hook diagnostic\n')
const base=['-c','plugins.opencode-quests@personal.enabled=false','-c','projects.'+root.toLowerCase()+'.trust_level="trusted"']
const env={...process.env,PLUGIN_ROOT:root};delete env.CODEX_THREAD_ID
function host(settings:string[]=[]){
 const child=spawn(codexExecutable(),['app-server',...base,...settings.flatMap(x=>['-c',x])],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
 const notifications:any[]=[],pending=new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
 let seq=0,stderr=''
 createInterface({input:child.stdout}).on('line',line=>{try{
  const x=JSON.parse(line),wait=pending.get(x.id)
  if(wait){clearTimeout(wait.timer);pending.delete(x.id);x.error?wait.reject(Error(JSON.stringify(x.error))):wait.resolve(x.result)}
  else if(x.method)notifications.push(x)
 }catch{}})
 child.stderr.on('data',b=>stderr=(stderr+b).slice(-4000))
 const request=(method:string,params:any)=>new Promise<any>((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'))},20000)
  pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n')
 })
 const close=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Host closed'))}pending.clear();child.stdin.end();child.kill()}
 const initialize=async()=>{await request('initialize',{clientInfo:{name:'hook-reporting-acceptance',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n')}
 return {request,initialize,close,notifications,stderr:()=>stderr}
}
let hooks:any[]=[]
const discovery=host()
try{await discovery.initialize();hooks=(await discovery.request('hooks/list',{cwds:[root]})).data.flatMap((x:any)=>x.hooks)}finally{discovery.close()}
if(hooks.length!==1)throw Error('Expected one fixture hook')
let calls=0
const bodies:any[]=[]
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 if(req.method!=='POST')return new Response('not found',{status:404})
 bodies.push(await req.json())
 const item=calls++===0?{type:'function_call',id:'fc_probe',call_id:'probe',name:'exec_command',arguments:JSON.stringify({cmd:"Set-Content -LiteralPath '"+join(root,'tool-ran.txt').replaceAll("'","''")+"' -Value done; Write-Output 'TOOL_SUCCEEDED'",workdir:root})}:{type:'message',id:'done',role:'assistant',content:[{type:'output_text',text:'Diagnostic done.',annotations:[]}],status:'completed'}
 const response={id:'r'+calls,object:'response',model:'gpt-6-astra',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}]
 return new Response(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})
}})
const settings=['features.code_mode=false','features.code_mode_only=false','hooks.state={'+hooks.map(h=>JSON.stringify(h.key)+'={trusted_hash='+JSON.stringify(h.currentHash)+'}').join(',')+'}',
 'model_provider="fixture"','model_providers.fixture.name="Local hook diagnostic"','model_providers.fixture.base_url="http://127.0.0.1:'+server.port+'/v1"',
 'model_providers.fixture.wire_api="responses"','model_providers.fixture.requires_openai_auth=false','model_providers.fixture.supports_websockets=false']
const runtime=host(settings)
try{
 await runtime.initialize()
 const started=await runtime.request('thread/start',{cwd:root,model:'gpt-6-astra',approvalPolicy:'never',sandbox:'workspace-write',ephemeral:true})
 await runtime.request('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'Run the harmless diagnostic command.'}]})
 const deadline=Date.now()+45000
 while(Date.now()<deadline&&!runtime.notifications.some(x=>x.method==='turn/completed'))await Bun.sleep(200)
 const hookEvents=runtime.notifications.filter(x=>x.method?.startsWith('hook/'))
 const toolSucceeded=existsSync(join(root,'tool-ran.txt'))&&bodies.flatMap(b=>b.input??[]).some(x=>x.type==='function_call_output'&&String(x.output).includes('TOOL_SUCCEEDED'))
 const report={hookExecuted:existsSync(join(root,'hook-ran.txt')),hookEvents,modelSawSentinel:JSON.stringify(bodies).includes('HOOK_DIAGNOSTIC_SENTINEL'),toolSucceeded,modelInputs:bodies.map(b=>b.input),stderr:runtime.stderr()}
 const ok=report.hookExecuted&&report.modelSawSentinel&&toolSucceeded===!pre&&hookEvents.some(x=>x.method==='hook/completed'&&x.params.run.status===(pre?'blocked':'completed')&&JSON.stringify(x.params.run.entries).includes('HOOK_DIAGNOSTIC_SENTINEL'))
 writeFileSync(join(root,'app-report.json'),JSON.stringify({ok,...report},null,2))
 console.log(JSON.stringify({ok,event,root,toolSucceeded,modelSawSentinel:report.modelSawSentinel,hookEvents},null,2))
 if(!ok)process.exitCode=1
}finally{server.stop();runtime.close()}
