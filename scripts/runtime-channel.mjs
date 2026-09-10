/** Explicit, isolated OpenCode2 release channels. No host updates, mirror publishing, or stable activation. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2), action = args.shift(), channel = args.shift()
const option = name => { const at=args.indexOf(name); return at < 0 ? undefined : args[at+1] }
function git(argv, cwd=source) { const p=spawnSync('git',['-C',cwd,...argv],{encoding:'utf8',windowsHide:true,timeout:30000});if(p.status!==0)throw Error(p.stderr||String(p.error));return p.stdout.trim() }
const common = resolve(source,git(['rev-parse','--git-common-dir']))
const repository = dirname(common), runtimeHome=join(homedir(),'.config','opencode'), registry=join(runtimeHome,'.channels')
function read(path){return JSON.parse(readFileSync(path,'utf8'))}
function atomic(path,value){mkdirSync(dirname(path),{recursive:true});const tmp=path+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');renameSync(tmp,path)}
function envFor(root, name) {
  const state=join(registry,'state',name);mkdirSync(state,{recursive:true})
  const env={...process.env,OPENCODE_CONFIG_DIR:root,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_RELEASE_CHANNEL:name}
  // Broker authentication remains with its existing local service. Session DB, Quests,
  // ownership and telemetry are separate from everyday stable work.
  if(name==='dev')Object.assign(env,{XDG_STATE_HOME:join(state,'xdg'),OPENCODE_DB:join(state,'host.db'),OPENCODE_QUEST_ROOT:join(state,'quests'),OPENCODE_ORCHESTRATION_LEDGER:join(state,'orchestration.jsonl'),OPENCODE_TELEMETRY_FILE:join(state,'requests.jsonl')})
  for(const key of ['OPENCODE_PLUGIN_GENERATION','OPENCODE_RUNTIME_RECEIPT','OPENCODE_RUNTIME_CONTROL','OPENCODE_RUNTIME_TOKEN'])delete env[key]
  return env
}
async function run(exe,argv,cwd,env){const child=spawn(exe,argv,{cwd,env,stdio:'inherit',windowsHide:true});const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',done)});if(code!==0)throw Error(`${exe} exited ${code}`)}
if(!['dev','stable'].includes(channel))throw Error('Choose dev or stable: prepare dev --ref <branch> --model <exact-route>; activate dev --candidate <root> --evidence <report>; start dev|stable; status dev|stable')
if(action==='prepare'){
  if(channel!=='dev')throw Error('Stable preparation requires the separate human-merged agents-to-master release')
  const ref=option('--ref'),model=option('--model');if(!ref||!model)throw Error('Preparation requires a committed ref and exact real model route')
  const commit=git(['rev-parse','--verify',ref+'^{commit}']),root=join(registry,'releases','dev-'+commit.slice(0,12)+'-'+Date.now())
  mkdirSync(dirname(root),{recursive:true});git(['worktree','add','--detach',root,commit])
  // Frozen lockfile restores the environment once, before dispatching any work.
  await run('bun',['install','--frozen-lockfile'],root,process.env)
  const env=envFor(root,'dev')
  await run('bun',[join(root,'scripts/prepare-channel.ts'),'--model',model],root,env)
  atomic(join(root,'channel-release.json'),{schema:1,channel,commit,root,model,preparedAt:new Date().toISOString()})
  console.log(JSON.stringify({prepared:true,active:false,root,commit,next:'Exercise this candidate twice, then activate dev with the real evidence report.'},null,2))
}else if(action==='activate'){
  if(channel!=='dev')throw Error('Stable activation is never an implicit dev action')
  const root=realpathSync(option('--candidate')??''),reportPath=resolve(option('--evidence')??'')
  if(!root.toLowerCase().startsWith((join(registry,'releases')+'\\').toLowerCase())&&!root.startsWith(join(registry,'releases')+'/'))throw Error('Candidate must be an owned channel release')
  const release=read(join(root,'channel-release.json')),pointer=read(join(root,'plugin-activation.json')),report=read(reportPath)
  if(release.channel!=='dev'||git(['rev-parse','HEAD'],root)!==release.commit)throw Error('Candidate identity changed')
  git(['fetch','origin','agents'])
  git(['merge-base','--is-ancestor',release.commit,'origin/agents'])
  if(git(['rev-parse',release.commit+'^{tree}'])!==git(['rev-parse','origin/agents^{tree}']))throw Error('Prepare the current merged agents tree before activation')
  if(!report.ok||report.root!==root||report.sourceCommit!==release.commit||report.runs?.length!==2||report.runs.some(r=>!r.ok||!r.automaticReturn||!r.screenshots?.length))throw Error('Two real automatic-return runs with captures are required for this release')
  if(pointer.evidence?.ok!==true||pointer.evidence.sourceCommit!==release.commit)throw Error('Candidate validation does not match source')
  const path=join(registry,'dev.json'),previous=existsSync(path)?read(path):undefined
  const skillPath=join(homedir(),'.agents','skills','opencode-dev-workflow','SKILL.md')
  const skill=readFileSync(join(root,'skills/opencode-dev-workflow/SKILL.md'),'utf8')
  const skillReceipt=join(registry,'installed-workflow.json'),hash=value=>createHash('sha256').update(value).digest('hex')
  if(existsSync(skillPath)&&readFileSync(skillPath,'utf8')!==skill&&(!existsSync(skillReceipt)||read(skillReceipt).hash!==hash(readFileSync(skillPath,'utf8'))))throw Error('Existing workflow skill has independent changes; preserved')
  mkdirSync(dirname(skillPath),{recursive:true});writeFileSync(skillPath,skill)
  atomic(skillReceipt,{path:skillPath,hash:hash(skill),sourceCommit:release.commit})
  writeFileSync(join(registry,'start.mjs'),"import {readFileSync} from 'node:fs';import {dirname,join} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';const root=JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'dev.json'),'utf8')).root;process.argv.splice(2,0,'start');await import(pathToFileURL(join(root,'scripts/runtime-channel.mjs')).href);\n")
  atomic(path,{...release,generation:pointer.activeGeneration,evidence:reportPath,previous,activatedAt:new Date().toISOString()})
  console.log(JSON.stringify({active:true,channel,root,commit:release.commit,existingSessions:'unchanged'},null,2))
}else if(action==='status'){
  console.log(JSON.stringify(channel==='dev'?(existsSync(join(registry,'dev.json'))?read(join(registry,'dev.json')):{active:false}):{channel,root:runtimeHome,activation:read(join(runtimeHome,'plugin-activation.json'))},null,2))
}else if(action==='start'){
  const root=channel==='stable'?runtimeHome:read(join(registry,'dev.json')).root
  const env=envFor(root,channel)
  if(channel==='dev'&&!args.includes('--model'))args.push('--model',read(join(registry,'dev.json')).model)
  await run('node',[join(source,'scripts/opencode-runtime.mjs'),'--config-root',root,...args],process.cwd(),env)
}else throw Error('Unknown channel action')
