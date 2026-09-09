import {createHash, randomUUID} from 'node:crypto'
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import type {QuestStore} from '../store'

export type RecoveryBinding = {origin:string; repository:string; directory:string; branch:string; head:string; sessionID:string; preparation?:{state:'ready'|'blocked'; source:'clean-checkout'|'explicit-commit'|'tracked-snapshot'; tree?:string; applied?:boolean; applicationStarted?:boolean; dirty:boolean; environment:string; reason?:string}}
// An explicit immutable source is caller authorization, never inferred from a
// conflicting owner's reservation. This option is an internal adapter/fixture
// input, not a user-facing recovery operation.
export type RecoveryOptions = {aliases?:Record<string,string>; runner?:string; sourceCommit?:string; needsEnvironment?:boolean}
const key=(value:string)=>process.platform==='win32'?resolve(value).toLowerCase():resolve(value)
function safeGit(directory:string){
 const config=spawnSync('git',['-C',directory,'config','--name-only','--get-regexp','^filter[.]'],{encoding:'utf8',windowsHide:true,timeout:20000})
 if(config.error||![0,1].includes(config.status??-1))throw Error('Could not inspect repository filter configuration')
 const drivers=[...new Set(config.stdout.trim().split('\n').map(line=>/^filter\.(.+)\.(?:clean|smudge|process|required)$/.exec(line.trim())?.[1]).filter((v):v is string=>!!v))]
 return ['-C',directory,'-c','core.fsmonitor=false','-c','core.hooksPath=',...drivers.flatMap(driver=>['-c',`filter.${driver}.clean=`,'-c',`filter.${driver}.smudge=`,'-c',`filter.${driver}.process=`,'-c',`filter.${driver}.required=false`])]
}
const git=(directory:string,args:string[])=>{
 const r=spawnSync('git',[...safeGit(directory),...args],{encoding:'utf8',windowsHide:true,timeout:20000})
 if(r.status!==0)throw Error('Worktree recovery: '+(r.error?.message??r.stderr.trim()))
 return r.stdout.trim()
}
const save=(file:string,value:unknown)=>{const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value));renameSync(temp,file)}
const contained=(root:string,path:string)=>{const rel=relative(root,path);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\'))}
export function sameDirectory(a:string,b:string){return key(realpathSync(a))===key(realpathSync(b))}
// This personal configuration has an explicitly documented non-Git hub. Never
// guess a repository by scanning children: the hub also contains upstream repos.
export function checkoutAliases(){return {[join(homedir(),'Projects','opencode-hub')]:join(homedir(),'.config','opencode')}}
// Same temporary-index/two-pass mechanism as QuestWorkspaces.applySnapshot,
// narrowed to tracked regular files. hash-object avoids repository clean filters;
// no source index mutation, lifecycle command, or arbitrary untracked-file copy.
function trackedSnapshot(store:QuestStore,repository:string,head:string):string{
 const index=join(store.runtime,'codex','snapshot-'+randomUUID()+'.index')
 const run=(args:string[],input?:string|Buffer)=>{
  const r=spawnSync('git',[...safeGit(repository),...args],{input,env:{...process.env,GIT_INDEX_FILE:index},encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:32*1024*1024})
  if(r.status!==0)throw Error('Recovery snapshot failed: '+(r.error?.message??r.stderr.trim()))
  return r.stdout.trim()
 }
 const untracked=()=>git(repository,['ls-files','--others','--exclude-standard','-z','--','.',':(exclude).worktrees'])
 if(untracked())throw Error('Untracked source inputs are ambiguous. Use Read/Glob/Grep to inspect required task inputs; ask the current owner for an authorized tracked handoff, then retry the original tool call. No untracked files were copied')
 if(git(repository,['ls-files','--unmerged']))throw Error('Unmerged source inputs require conflict resolution before recovery')
 const stamp=()=>git(repository,['rev-parse','HEAD'])+'\n'+git(repository,['ls-files','--stage'])
 const before=stamp()
 const capture=()=>{
  run(['read-tree',head])
  const baseline=new Map<string,{mode:string;hash:string}>()
  for(const row of git(repository,['ls-tree','-r','-z',head]).split('\0').filter(Boolean)){
   const tab=row.indexOf('\t'),[mode,,hash]=row.slice(0,tab).split(' ');baseline.set(row.slice(tab+1),{mode,hash})
  }
  const modes=new Map([...baseline].map(([name,value])=>[name,value.mode]))
  for(const row of git(repository,['ls-files','--stage','-z']).split('\0').filter(Boolean)){const tab=row.indexOf('\t');modes.set(row.slice(tab+1),row.slice(0,6))}
  let updates=''
  for(const [name,sourceMode] of modes){
   const path=resolve(repository,name)
   if(!contained(repository,path))throw Error('Snapshot input escapes checkout')
   let mode='0',hash='0'.repeat(40)
   let stat:ReturnType<typeof lstatSync>|undefined
   try{stat=lstatSync(path)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
   if(stat){
    if(!stat.isFile()||!contained(realpathSync(repository),realpathSync(path)))throw Error('Snapshot input is not an isolated regular file: '+name)
    mode=sourceMode
    if(!['100644','100755'].includes(mode))throw Error('Unsupported snapshot input mode: '+name)
    if(stat.size>32*1024*1024)throw Error('Snapshot input exceeds bounded capture size: '+name)
    const bytes=readFileSync(path)
    hash=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')
    if(hash===baseline.get(name)?.hash&&mode===baseline.get(name)?.mode)continue
    if(/(^|\/)(?:\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|.*\.(?:pem|key|p12))$/i.test(name))throw Error('Sensitive tracked input requires explicit handoff: '+name+'. Read/Glob/Grep remain available; ask the current owner for a sanitized task source before retrying')
    run(['hash-object','-w','--stdin','--no-filters'],bytes)
   }
   updates+=mode+' '+hash+'\t'+name+'\0'
  }
  if(updates)run(['update-index','-z','--index-info'],updates)
  return run(['write-tree'])
 }
 try{
  const tree=capture()
  if(capture()!==tree||stamp()!==before||untracked())throw Error('Source changed during recovery snapshot; retry after edits settle')
  return tree
 }finally{if(existsSync(index))unlinkSync(index)}
}
export function recoverWorkspace(store:QuestStore,origin:string,sessionID:string,options:RecoveryOptions={}):RecoveryBinding{
 const aliases=options.aliases??checkoutAliases()
 const alias=Object.entries(aliases).find(([path])=>existsSync(path)&&sameDirectory(path,origin))?.[1]
 const repository=realpathSync(git(alias??origin,['rev-parse','--show-toplevel']))
 const id=createHash('sha256').update(key(origin)+'\0'+sessionID).digest('hex').slice(0,24)
 const directory=join(repository,'.worktrees','quest-recovery-'+id),branch='quest/recovery-'+id
 const records=join(store.runtime,'codex','workspaces');mkdirSync(records,{recursive:true})
 const receipt=join(records,id+'.json')
 let binding:RecoveryBinding
 if(existsSync(receipt)){
  binding=JSON.parse(readFileSync(receipt,'utf8'))
  if(binding.sessionID!==sessionID||key(binding.origin)!==key(origin)||key(binding.repository)!==key(repository)||key(binding.directory)!==key(directory)||binding.branch!==branch)throw Error('Worktree recovery receipt does not match this session; preserving it')
 }else{
  // A deterministic name is not proof that an existing tree or branch is ours.
  if(existsSync(directory))throw Error('Recovery destination exists without a session receipt; preserving it')
  const head=options.sourceCommit??git(repository,['rev-parse','HEAD'])
  if(!/^[a-f0-9]{40}$/.test(head)||git(repository,['rev-parse',head+'^{commit}'])!==head)throw Error('Recovery source must be an exact commit')
  binding={origin:realpathSync(origin),repository,directory,branch,head,sessionID}
  save(receipt,binding)
 }
 if(!existsSync(directory)){
  const dirty=false
  const explicit=options.sourceCommit===binding.head
  binding.preparation={state:'ready',source:explicit?'explicit-commit':'clean-checkout',dirty,environment:'not inspected'}
  if(!explicit){
   try{const tree=trackedSnapshot(store,repository,binding.head);if(tree!==git(repository,['rev-parse',binding.head+'^{tree}'])){binding.preparation.tree=tree;binding.preparation.source='tracked-snapshot';binding.preparation.dirty=true}}
   catch(error){binding.preparation.state='blocked';binding.preparation.dirty=true;binding.preparation.reason=String(error);save(receipt,binding);throw Error(binding.preparation.reason+'; receipt: '+receipt)}
  }
  if(!explicit&&git(repository,['rev-parse','HEAD'])!==binding.head)throw Error('Recovery source HEAD changed before preparation; preserve receipt for inspection')
  save(receipt,binding)
 }
 if(!existsSync(directory)){
  const parent=dirname(directory);mkdirSync(parent,{recursive:true})
  if(!contained(repository,realpathSync(parent)))throw Error('Recovery worktree parent resolves outside the repository')
  const branchExists=spawnSync('git',['-C',repository,'show-ref','--verify','--quiet','refs/heads/'+branch],{windowsHide:true}).status===0
  if(branchExists)throw Error('Recovery branch exists without its worktree; preserving it for inspection')
   git(repository,['-c','core.hooksPath=','worktree','add','-b',branch,directory,binding.head])
 }
 validateRecoveryBinding(binding)
 if(binding.preparation?.tree&&!binding.preparation.applied){
  // An interrupted application is never replayed onto unknown edits.
  if(binding.preparation.applicationStarted)throw Error('Snapshot application has unknown completion; preserve recovery worktree for inspection')
  binding.preparation.applicationStarted=true;save(receipt,binding)
  const patch=spawnSync('git',['-C',repository,'diff','--binary','--full-index','--no-ext-diff','--no-textconv',binding.head,binding.preparation.tree,'--'],{windowsHide:true,maxBuffer:32*1024*1024})
  if(patch.status!==0)throw Error('Could not read immutable recovery snapshot')
  if(patch.stdout.length){
   const applied=spawnSync('git',[...safeGit(directory),'apply','--index','--whitespace=nowarn','-'],{input:patch.stdout,encoding:'utf8',windowsHide:true,timeout:20000})
   if(applied.status!==0)throw Error('Recovery snapshot application failed; retained worktree: '+applied.stderr)
  }
  binding.preparation.applied=true;save(receipt,binding)
 }
 // Unlike QuestWorkspaces.create, recovery has no authorized project bootstrap
 // argv or dependency snapshot. Do not run repository scripts or share writable
 // node_modules with the owner. Make this constraint durable and visible.
 if(!binding.preparation)throw Error('Legacy recovery has no source/preparation receipt; inspect before reusing it')
 const manifest=join(directory,'package.json')
 const pkg=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):{}
 const dependencies=Object.keys({...pkg.dependencies,...pkg.devDependencies,...pkg.optionalDependencies}).length>0||!!pkg.workspaces
 binding.preparation.environment=dependencies?'requires isolated configured bootstrap':'no package dependencies'
 binding.preparation.state=dependencies&&options.needsEnvironment?'blocked':'ready'
 binding.preparation.reason=dependencies?'Dependency environment is unprepared; file reads/patches are ready, dependency execution requires a supported isolated preparation receipt':undefined
 save(receipt,binding)
 if(binding.preparation.state==='blocked')throw Error(binding.preparation.reason+'; receipt: '+receipt)
 return binding
}
// Validation only: a replay must never recreate or adopt a missing/replaced tree.
export function validateRecoveryBinding(binding:RecoveryBinding):void{
 const {repository,directory,branch}=binding
 if(key(realpathSync(repository))!==key(repository)||key(realpathSync(directory))!==key(directory)||!sameDirectory(directory,git(directory,['rev-parse','--show-toplevel']))||!contained(repository,realpathSync(directory))||git(directory,['symbolic-ref','--short','HEAD'])!==branch)throw Error('Recovery worktree identity changed; refusing to reuse it')
 const originalCommon=realpathSync(resolve(repository,git(repository,['rev-parse','--git-common-dir'])))
 const recoveredCommon=realpathSync(resolve(directory,git(directory,['rev-parse','--git-common-dir'])))
 if(key(originalCommon)!==key(recoveredCommon))throw Error('Recovery worktree belongs to another repository')
}
const WEB_TOOLS=new Set(['WebSearch','WebFetch','web.run','web__run','webrun'])
// These host controls cannot read or mutate a checkout. Keep the list exact:
// arbitrary MCP calls, code execution and delegation still need ownership.
const CHECKOUT_FREE_CONTROLS=new Set([
 'create_goal','get_goal','update_goal',
 'functions.create_goal','functions.get_goal','functions.update_goal',
 'request_user_input','request_user_input_async','functions.request_user_input','functions.request_user_input_async',
 'clock.sleep','clock__sleep','clocksleep','clock__curr_time',
 'collaboration.list_agents','collaborationlist_agents','collaboration.wait_agent','collaborationwait_agent',
 // Native collaboration controls do not execute file operations in the caller.
 // Each child session still passes its own shell/patch calls through this hook.
 ...['spawn_agent','send_message','followup_task','interrupt_agent'].flatMap(name=>[name,'collaboration.'+name,'collaboration'+name]),
])
export function checkoutIndependent(tool:string,input:any):boolean{
 if(CHECKOUT_FREE_CONTROLS.has(tool)||WEB_TOOLS.has(tool)||['Read','Glob','Grep','view_image'].includes(tool))return true
 if(tool!=='Bash'||typeof input?.command!=='string')return false
 // Deliberately tiny literal-only PowerShell read grammar. No expressions,
 // variables, redirection, pipelines, wildcards, invocation operators or scriptblocks.
 // A nonmatching command takes the normal isolated execution path.
 return input.command.trim().split(';').every((part:string)=>{
   if(/^\s*Get-Location\s*$/i.test(part))return true
   const match=/^\s*Get-Content\s+(?:(?:-LiteralPath|-Path)\s+)?(?:'([^'$`*?\[\]\r\n]+)'|"([^"$`*?\[\]\r\n]+)"|([A-Za-z]:[\\/][^\s;'"$`|&<>*?\[\]{}()]+))\s*(?:-(?:TotalCount|Head|Tail)\s+\d+)?\s*$/i.exec(part)
  const path=match&&(match[1]??match[2]??match[3])
  return !!path&&isAbsolute(path)
 })
}
export function recoveryReadInput(binding:RecoveryBinding,tool:string,input:any):any{
 if(tool==='Bash'){
  if(!checkoutIndependent(tool,input))return undefined
  let changed=false
  const command=input.command.split(';').map((part:string)=>{
   if(!/Get-Content/i.test(part)){changed=true;return part}
   return part.replace(/('([^']+)'|"([^"]+)"|[A-Za-z]:[\\/][^\s;]+)/,literal=>{
    const path=/^['"]/.test(literal)?literal.slice(1,-1):literal
    const mapped=recoveryReadInput(binding,'Read',{file_path:path})
    if(!mapped)return literal
    changed=true;return "'"+mapped.file_path.replaceAll("'","''")+"'"
   })
  }).join(';')
  return changed?{...input,command}:undefined
 }
 if(!['Read','Glob','Grep','view_image'].includes(tool))return undefined
 const field=tool==='Read'?'file_path':'path'
 const path=input?.[field]??'.'
 if(typeof path!=='string')throw Error('Invalid recovered read path')
 const base=contained(binding.repository,binding.origin)?binding.origin:binding.repository
 const requested=resolve(base,path)
 if(isAbsolute(path)&&!contained(binding.repository,requested)&&!contained(binding.directory,requested))return undefined
 validateRecoveryBinding(binding)
 const mapped=contained(binding.directory,requested)?requested:resolve(binding.directory,relative(binding.repository,requested))
 if(!contained(binding.directory,mapped))throw Error('Read path escapes recovered task context')
 let ancestor=mapped;while(!existsSync(ancestor)&&ancestor!==dirname(ancestor))ancestor=dirname(ancestor)
 if(!contained(realpathSync(binding.directory),realpathSync(ancestor)))throw Error('Read path resolves outside recovered task context')
 return {...input,[field]:mapped}
}
export function recoveryWorkingDirectory(binding:RecoveryBinding,workdir?:string):string{
 if(workdir!==undefined&&(typeof workdir!=='string'||!workdir.trim()))throw Error('Invalid recovery working directory')
 const requested=resolve(binding.origin,workdir??'.')
 // The configured non-Git hub maps to its repository only at the hub root.
 if(!contained(binding.repository,requested)&&key(requested)===key(binding.origin)&&!contained(binding.repository,binding.origin))return binding.directory
 const recovered=realpathSync(binding.directory),canonical=realpathSync(requested)
 // Hub/config can be a junction into this repository, but a recovered-tree
 // junction must never send execution back into the protected owner checkout.
 if(contained(binding.directory,requested)&&!contained(recovered,canonical))throw Error('Working directory escapes the recovered checkout')
 const source=contained(recovered,canonical)?recovered:realpathSync(binding.repository)
 if(!contained(source,canonical))throw Error('Working directory escapes the recovered checkout')
 const target=resolve(recovered,relative(source,canonical))
 if(!contained(recovered,realpathSync(target)))throw Error('Working directory resolves outside the recovered checkout')
 return target
}
export function recoveryCommand(store:QuestStore,binding:RecoveryBinding,command:string,options:RecoveryOptions={},workdir?:string):{command:string;ticket:string}{
 if(typeof command!=='string')throw Error('Recovery requires the original shell command')
 if(process.platform!=='win32')throw Error('Automatic shell recovery is currently verified only for the Windows PowerShell host')
 const runner=options.runner??join(import.meta.dir,import.meta.path.endsWith('.ts')?'recovery-command.ts':'recovery-command.js')
 if(!existsSync(runner))throw Error('The installed Quest package is missing its recovery command runner')
 const dir=join(store.runtime,'codex','commands');mkdirSync(dir,{recursive:true})
 const directory=recoveryWorkingDirectory(binding,workdir)
 const path=join(dir,randomUUID()+'.json');save(path,{version:1,directory,workspace:binding.directory,binding,workdir,sessionID:binding.sessionID,command,prepare:options.needsEnvironment!==false&&binding.preparation?.environment==='requires isolated configured bootstrap'})
 const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'"
 return {command:'& bun '+quote(runner)+' '+quote(path),ticket:path}
}
export function recoveryPatch(command:string,binding:RecoveryBinding):string{
 const map=(path:string)=>{
  if(!path||path.includes('\0'))throw Error('Invalid patch path')
  let target:string
  if(isAbsolute(path)){
   if(contained(binding.directory,resolve(path)))target=resolve(path)
   else if(contained(binding.repository,resolve(path)))target=resolve(binding.directory,relative(binding.repository,resolve(path)))
   else throw Error('Patch targets a path outside the recovered checkout')
  }else target=resolve(binding.directory,path)
  if(!contained(binding.directory,target))throw Error('Patch escapes the recovered checkout')
  let ancestor=target;while(!existsSync(ancestor)&&ancestor!==dirname(ancestor))ancestor=dirname(ancestor)
  if(!contained(realpathSync(binding.directory),realpathSync(ancestor)))throw Error('Patch path resolves outside the recovered checkout')
  return target.replaceAll('\\','/')
 }
 if(!command.startsWith('*** Begin Patch\n')&&!command.startsWith('*** Begin Patch\r\n'))throw Error('Unsupported patch format for recovery')
 return command.split('\n').map(line=>{
  const m=/^(\*\*\* (?:Add File|Update File|Delete File|Move to): )(.+?)\r?$/.exec(line)
  return m?m[1]+map(m[2]):line
 }).join('\n')
}
