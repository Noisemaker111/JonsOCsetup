/** Real Luna smoke against installed Codex, with private files and Quest ledger. */
import {spawn,spawnSync} from 'node:child_process'
import {mkdirSync,writeFileSync,readFileSync,existsSync,cpSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {homedir} from 'node:os'
import {createInterface} from 'node:readline'
import {codexExecutable} from '../quest/codex/recovery-command'
const root=join(homedir(),'Projects','opencode-hub','.runtime-tests','luna-runtime-'+Date.now()),repo=join(root,'repo')
mkdirSync(repo,{recursive:true})
writeFileSync(join(repo,'AGENTS.md'),'This is an isolated runtime verification fixture. Read and write only this checkout. Use the installed shell and patch tools. Do not create Quests, spawn agents, use network tools, commit, deploy or change other files.\n')
writeFileSync(join(repo,'input.txt'),'LUNA_RUNTIME_INPUT\n')
for(const args of [['init'],['add','AGENTS.md','input.txt'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Runtime fixture']]){const r=spawnSync('git',args,{cwd:repo,windowsHide:true,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr)}
const executable=codexExecutable(),version=spawnSync(executable,['--version'],{windowsHide:true,encoding:'utf8'}).stdout.trim()
const candidateArg=process.argv.indexOf('--candidate'),candidate=candidateArg>=0?resolve(process.argv[candidateArg+1]):undefined
const env={...process.env,OPENCODE_QUEST_ROOT:join(root,'ledger')};delete env.CODEX_THREAD_ID
const config:string[]=[]
if(candidate){
 const staged=join(root,'candidate');cpSync(candidate,staged,{recursive:true});env.PLUGIN_ROOT=staged
 mkdirSync(join(repo,'.codex'));writeFileSync(join(repo,'.codex/config.toml'),'# private candidate hook fixture\n')
 cpSync(join(staged,'hooks/hooks.json'),join(repo,'.codex/hooks.json'))
 config.push('-c','plugins.opencode-quests@personal.enabled=false','-c','projects={'+JSON.stringify(repo.toLowerCase())+'={trust_level="trusted"},'+JSON.stringify(repo)+'={trust_level="trusted"}}')
 const app=spawn(executable,['app-server',...config],{cwd:repo,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let sequence=0;const pending=new Map<number,(value:any)=>void>();app.stderr.resume()
 createInterface({input:app.stdout}).on('line',line=>{try{const row=JSON.parse(line);pending.get(row.id)?.(row);pending.delete(row.id)}catch{}})
 const rpc=(method:string,params:any)=>new Promise<any>(done=>{const id=++sequence;pending.set(id,done);app.stdin.write(JSON.stringify({id,method,params})+'\n')})
 const timeout=setTimeout(()=>app.kill(),20000)
 try{
  await rpc('initialize',{clientInfo:{name:'luna-runtime-acceptance',version:'1'},capabilities:{experimentalApi:true}});app.stdin.write(JSON.stringify({method:'initialized'})+'\n')
  const cfg=await rpc('config/read',{cwd:repo,includeLayers:true});writeFileSync(join(root,'config-layers.json'),JSON.stringify(cfg.result?.layers?.map((l:any)=>({name:l.name,disabledReason:l.disabledReason})),null,2))
  const response=await rpc('hooks/list',{cwds:[repo]});if(response.error)throw Error(JSON.stringify(response.error));const hooks=response.result.data.flatMap((row:any)=>row.hooks)
  writeFileSync(join(root,'hooks-loaded.json'),JSON.stringify(response.result,null,2));const own=hooks.filter((h:any)=>h.sourcePath?.replaceAll('\\','/').toLowerCase()===join(repo,'.codex/hooks.json').replaceAll('\\','/').toLowerCase());if(own.length!==4)throw Error('Expected four isolated candidate hooks: '+JSON.stringify(response.result))
  config.push('-c','hooks.state={'+own.map((h:any)=>JSON.stringify(h.key)+'={trusted_hash='+JSON.stringify(h.currentHash)+'}').join(',')+'}')
 }finally{clearTimeout(timeout);app.stdin.end();app.kill()}
}
const child=spawn(executable,['exec',...config,'-C',repo,'--json','--color','never','-c','approval_policy="never"','-c','model_reasoning_effort="medium"','--sandbox','workspace-write','-m','gpt-5.6-luna','-'],{cwd:repo,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
child.stdin.end('Verify the actual runtime tools: read input.txt; create output.txt with exactly LUNA_RUNTIME_OK using a patch or write tool; run a PowerShell command that reads output.txt and checks it equals LUNA_RUNTIME_OK. Report the observed command result. Do not claim success before reading the saved file. Stop after these checks.')
let out='',err='';child.stdout.on('data',b=>{out+=b;writeFileSync(join(root,'stdout.jsonl'),out)});child.stderr.on('data',b=>{err+=b;writeFileSync(join(root,'stderr.txt'),err)})
const timer=setTimeout(()=>child.kill(),180000)
try{
 const exit=await new Promise<number|null>((done,reject)=>{child.once('exit',done);child.once('error',reject)})
 writeFileSync(join(root,'stdout.jsonl'),out);writeFileSync(join(root,'stderr.txt'),err)
 const events=out.split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}})
 const commands=events.filter(row=>row.type==='item.completed'&&row.item?.type==='command_execution').map(row=>row.item)
 const hookDir=join(root,'ledger/.opencode/.quest-runtime/codex'),hookReceipts=existsSync(hookDir)?readdirSync(hookDir).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>{const r=JSON.parse(readFileSync(join(hookDir,name),'utf8'));return {events:r.events?.length??0,pending:r.pending?.length??0,ended:r.ended,diagnostics:r.diagnostics}}):[]
 const hooksComplete=!candidate||hookReceipts.some(r=>r.events>0&&r.pending===0&&r.ended===true&&!r.diagnostics)
 const ok=hooksComplete&&exit===0&&existsSync(join(repo,'output.txt'))&&readFileSync(join(repo,'output.txt'),'utf8').trim()==='LUNA_RUNTIME_OK'&&commands.some(c=>c.exit_code===0&&c.aggregated_output?.includes('LUNA_RUNTIME_OK'))&&!/hook failed|hook error|blocked by PreToolUse/i.test(err)
 const report={ok,candidate,hookReceipts,requestedModel:'gpt-5.6-luna',requestedReasoning:'medium',executable,version,exit,commands,errors:err.slice(-1800),root}
 writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok,exit,report:join(root,'report.json'),stderr:err.slice(-700)}));if(!ok)process.exitCode=1
}finally{clearTimeout(timer)}
