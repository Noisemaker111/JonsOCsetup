import {retireReleases} from './release-retirement.mjs'
import {prepareDevRelease, resolveRef, envFor as channelEnv, atomic, run, git as gitIn} from './channel-prepare.mjs'
import {retryFinishedWorktrees} from './worktree-cleanup.mjs'
/** Explicit, isolated OpenCode2 release channels. No host updates, mirror publishing, or stable activation. */
import { existsSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2), action = args.shift(), channel = args.shift()
const option = name => { const at=args.indexOf(name); return at < 0 ? undefined : args[at+1] }
const git=(argv, cwd=source)=>gitIn(cwd,argv)
const common = resolve(source,git(['rev-parse','--git-common-dir']))
const repository = dirname(common), runtimeHome=join(homedir(),'.config','opencode'), registry=join(runtimeHome,'.channels')
function read(path){return JSON.parse(readFileSync(path,'utf8'))}
const envFor=(root,name)=>channelEnv(root,name,registry)
if(!['dev','stable'].includes(channel))throw Error('Choose dev or stable: prepare dev --ref <branch> --model <exact-route>; activate dev --candidate <root> --evidence <report>; start dev|stable; status dev|stable')
if(action==='prepare'){
  if(channel!=='dev')throw Error('Main promotion requires its separately authorized workflow')
  const ref=option('--ref'),model=option('--model');if(!ref||!model)throw Error('Preparation requires a committed ref and exact real model route')
  const target=resolveRef(source,ref)
  const {root,release}=await prepareDevRelease({repository,registry,model,...target})
  const commit=release.commit
  console.log(JSON.stringify({prepared:true,active:false,root,commit,ref,resolved:release.resolved,modelCatalog:release.modelCatalog,next:'Exercise this candidate twice, then activate dev with the real evidence report.'},null,2))
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
  // Activation used to install a workflow skill into ~/.agents. Jon did not know it existed, and a
  // file rewritten by a runtime step is a file whose corrections keep getting lost -- this one was
  // reworded twice before the wording reached the repository. The few rules that mattered are in
  // AGENTS.md, where they are read without a skill having to match, and the mechanics stay in
  // docs/development-workflow.md. Any copy left from an earlier activation is removed here.
  const retiredSkill=join(homedir(),'.agents','skills','opencode-dev-workflow')
  const retiredReceipt=join(registry,'installed-workflow.json')
  if(existsSync(retiredSkill))rmSync(retiredSkill,{recursive:true,force:true})
  if(existsSync(retiredReceipt))rmSync(retiredReceipt,{force:true})
  writeFileSync(join(registry,'start.mjs'),"import {readFileSync} from 'node:fs';import {dirname,join} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';const root=JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'dev.json'),'utf8')).root;process.argv.splice(2,0,'start');await import(pathToFileURL(join(root,'scripts/runtime-channel.mjs')).href);\n")
  atomic(path,{...release,generation:pointer.activeGeneration,evidence:reportPath,previous:previous?{...previous,previous:undefined}:undefined,activatedAt:new Date().toISOString()})
  await run('node',[join(root,'scripts/install-channel-shortcuts.mjs')],root,process.env)
  console.log(JSON.stringify({active:true,channel,root,commit:release.commit,existingSessions:'unchanged',cleanup:{tasks:retryFinishedWorktrees(repository),releases:retireReleases(repository)}},null,2))
}else if(action==='status'){
  console.log(JSON.stringify(channel==='dev'?(existsSync(join(registry,'dev.json'))?read(join(registry,'dev.json')):{active:false}):{channel,root:runtimeHome,activation:read(join(runtimeHome,'plugin-activation.json'))},null,2))
}else if(action==='start'){
  const root=channel==='stable'?runtimeHome:read(join(registry,'dev.json')).root
  const env=envFor(root,channel)
  if(channel==='dev'&&!args.includes('--model')&&!args.includes('--session')&&!args.includes('-s'))args.push('--model',read(join(registry,'dev.json')).model)
  const supervisor=join(source,'scripts/opencode-runtime.mjs')
  // Automation wants the relayed transcript on this process's pipes, so it keeps its own node.
  // An interactive start runs the supervisor here instead: one process between the console and
  // the host, and the console it hands down is the one the user is actually looking at.
  if(args.includes('--json'))await run('node',[supervisor,'--config-root',root,...args],process.cwd(),env)
  else{
   for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key]
   Object.assign(process.env,env)
   process.argv=[process.argv[0],supervisor,'--config-root',root,...args]
   await import(pathToFileURL(supervisor).href)
  }
}else throw Error('Unknown channel action')
