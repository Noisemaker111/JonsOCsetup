/** Scripted local Responses endpoint drives one real Codex tool call; no LLM or
 * provider account is used. Candidate hooks replace the old adapter only in the
 * isolated test process. Hook trust is supplied as per-process hash overrides. */
import {spawn,spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {createInterface} from 'node:readline'
import {QuestStore} from '../quest/store'
import {coordination} from '../quest/coordination'
import {codexExecutable} from '../quest/codex/recovery-command'
const withDependency=process.argv.includes('--with-dependency');
const source=resolve(process.argv[2]??'.candidates/quest-ownership-recovery-v2'),root=mkdtempSync(join(tmpdir(),'ownership-tool-')),candidate=join(root,'candidate'),repo=join(root,'repo');mkdirSync(repo)
// Stage only the packaged fixture in the sandbox-readable test root. The live
// plugin and its trust configuration remain unchanged.
cpSync(source,candidate,{recursive:true})
const git=(...args:string[])=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
git('init');const packageDir=join(repo,'packages','fixture');mkdirSync(packageDir,{recursive:true});writeFileSync(join(packageDir,'result.txt'),'package committed');writeFileSync(join(repo,'result.txt'),'committed');if(withDependency){const locked=Bun.JSONC.parse(readFileSync(resolve(import.meta.dir,'../bun.lock'),'utf8'));const dependencies={picocolors:'1.1.1'};writeFileSync(join(repo,'package.json'),JSON.stringify({name:'recovery-host-fixture',version:'1.0.0',dependencies,scripts:{postinstall:"bun -e \"require('fs').writeFileSync('forbidden-script','ran')\""}}));writeFileSync(join(repo,'bun.lock'),JSON.stringify({lockfileVersion:1,configVersion:0,workspaces:{'':{name:'recovery-host-fixture',version:'1.0.0',dependencies}},packages:{picocolors:locked.packages.picocolors}}))}
git('add','.');git('commit','-m','fixture');writeFileSync(join(repo,'result.txt'),'owner dirty work');writeFileSync(join(packageDir,'result.txt'),'owner package work')
const store=new QuestStore(root),owner={directory:repo,sessionID:'original-owner',host:'opencode'};coordination(store,owner)({action:'join',title:'Original owner',scopes:['.']})
const before=coordination(store,owner)({action:'status'}).participants[0]
mkdirSync(join(repo,'.codex'));writeFileSync(join(repo,'.codex','config.toml'),'# isolated candidate hook fixture\n')
const hookCommand='bun "'+join(candidate,'scripts','hook.js').replaceAll('\\','/')+'"'
writeFileSync(join(repo,'.codex','hooks.json'),JSON.stringify({hooks:Object.fromEntries(['SessionStart','PreToolUse','PostToolUse','SessionEnd'].map(event=>[event,[{hooks:[{type:'command',command:hookCommand,command_windows:hookCommand,timeout:event==='SessionEnd'?3:30}]}]]))}))
git('add','.codex');git('commit','-m','tracked candidate hook fixture');
const base=['-c','plugins.opencode-quests@personal.enabled=false','-c','projects.'+repo.toLowerCase()+'.trust_level="trusted"']
const env={...process.env,OPENCODE_QUEST_ROOT:root};delete env.CODEX_THREAD_ID
async function hookTrust(){
 const p=spawn(codexExecutable(),['app-server',...base],{cwd:repo,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let seq=0;const waiters=new Map<number,(v:any)=>void>()
 createInterface({input:p.stdout}).on('line',line=>{try{const x=JSON.parse(line);waiters.get(x.id)?.(x)}catch{}});p.stderr.resume()
 const rpc=(method:string,params:any)=>new Promise<any>(resolve=>{const id=++seq;waiters.set(id,resolve);p.stdin.write(JSON.stringify({id,method,params})+'\n')})
 const timeout=setTimeout(()=>p.kill(),20000)
 try{await rpc('initialize',{clientInfo:{name:'quest-hook-acceptance',version:'1'},capabilities:{experimentalApi:true}});p.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');const cfg=await rpc('config/read',{cwd:repo,includeLayers:true});writeFileSync(join(root,'effective-config-summary.json'),JSON.stringify({plugins:cfg.result?.config?.plugins,projects:cfg.result?.config?.projects,layers:cfg.result?.layers?.map((l:any)=>({name:l.name,disabledReason:l.disabledReason}))},null,2));const response=await rpc('hooks/list',{cwds:[repo]});if(response.error)throw Error(JSON.stringify(response.error));const hooks=response.result.data.flatMap((row:any)=>row.hooks).filter((h:any)=>h.sourcePath?.replaceAll('\\','/').toLowerCase()===join(repo,'.codex','hooks.json').replaceAll('\\','/').toLowerCase());if(hooks.length!==4)throw Error('Expected four candidate hooks: '+JSON.stringify(response.result));return ['-c','hooks.state={'+hooks.map((h:any)=>JSON.stringify(h.key)+'={trusted_hash='+JSON.stringify(h.currentHash)+'}').join(',')+'}']}finally{clearTimeout(timeout);p.stdin.end();p.kill()}
}
const trust=await hookTrust();let requests=0,issued=0,toolNames:string[]=[]
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 if(req.method!=='POST')return new Response('not found',{status:404})
 const body:any=await req.json();writeFileSync(join(root,'request-shape.json'),JSON.stringify({path:new URL(req.url).pathname,keys:Object.keys(body),model:body.model,tools:body.tools},null,2));requests++;toolNames=(body.tools??[]).map((t:any)=>t.name)
 const id='response_'+requests;let item:any
 if(issued===0){
  const name='exec_command'
  const command="$ErrorActionPreference='Stop'; Set-Content result.txt 'recovered-through-real-tool'; (Get-Location).Path; Get-Content result.txt"+(withDependency?"; & '"+process.execPath.replaceAll("'","''")+"' -e \"console.log(require('picocolors').green('PREPARED_OK'))\"":"")
  const args=name==='exec_command'?{cmd:command,workdir:packageDir,yield_time_ms:1000}:{command,workdir:packageDir}
  item={type:'function_call',id:'fc_original',call_id:'original_operation',name,arguments:JSON.stringify(args)};issued++
 }else item={type:'message',id:'msg_done',role:'assistant',content:[{type:'output_text',text:'Fixture finished.',annotations:[]}],status:'completed'}
 const response={id,object:'response',model:'gpt-6-astra',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}]
 return new Response(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})
}})
const overrides=['features.code_mode=false','features.code_mode_only=false','model_provider="recovery_fixture"','model_providers.recovery_fixture.name="Local deterministic recovery fixture"','model_providers.recovery_fixture.base_url="http://127.0.0.1:'+server.port+'/v1"','model_providers.recovery_fixture.wire_api="responses"','model_providers.recovery_fixture.requires_openai_auth=false','model_providers.recovery_fixture.supports_websockets=false']
const child=spawn(codexExecutable(),['exec',...base,...trust,...overrides.flatMap(s=>['-c',s]),'-C',repo,'--json','--color','never','-c','approval_policy="never"','-s','workspace-write','-m','gpt-6-astra','Run the one fixture command.'],{cwd:repo,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b)
const timer=setTimeout(()=>child.kill(),100000)
try{
 const code=await new Promise<number|null>(resolve=>child.on('exit',resolve))
 const dir='.visual-e2e/ownership-recovery'+(withDependency?'-dependency':'');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'actual-tool-stdout.jsonl'),stdout);writeFileSync(join(dir,'actual-tool-stderr.txt'),stderr)
 const status=coordination(store,owner)({action:'status'}),worktrees=git('worktree','list','--porcelain'),target=worktrees.split('\n').filter(s=>s.startsWith('worktree ')).map(s=>s.slice(9)).find(s=>s.includes('quest-recovery-'))
 const dependencyReady=!withDependency||(stdout.includes('PREPARED_OK')&&!!target&&existsSync(join(target,'node_modules/picocolors'))&&!existsSync(join(target,'forbidden-script')));
 const ok=dependencyReady&&code===0&&issued===1&&!!target&&readFileSync(join(target,'packages','fixture','result.txt'),'utf8').trim()==='recovered-through-real-tool'&&readFileSync(join(target,'result.txt'),'utf8')==='owner dirty work'&&readFileSync(join(packageDir,'result.txt'),'utf8')==='owner package work'&&readFileSync(join(repo,'result.txt'),'utf8')==='owner dirty work'&&JSON.stringify(status.participants.find((p:any)=>p.sessionID===owner.sessionID))===JSON.stringify(before)
 const report={ok,withDependency,dependencyReady,requestedWorkingDirectory:packageDir,recoveredWorkingDirectory:target&&join(target,'packages','fixture'),fixture:root,exitCode:code,scriptedProviderRequests:requests,originalToolCalls:issued,remoteModelCalls:0,toolNames,worktrees,stdoutTail:stdout.slice(-3000),stderrTail:stderr.slice(-1800)};writeFileSync(join(dir,'actual-tool-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!ok)process.exitCode=1
}finally{clearTimeout(timer);child.kill();server.stop(true)}
