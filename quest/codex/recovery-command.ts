/** Execute a claimed recovery command through the installed host's restricted
 * command/exec boundary. No model, shell elevation or host configuration changes. */
import {spawn} from 'node:child_process'
import {existsSync, readFileSync, renameSync, realpathSync, writeFileSync, mkdtempSync, lstatSync, mkdirSync, opendirSync, openSync, closeSync, fstatSync, readSync, writeSync, constants} from 'node:fs'
import {createHash} from 'node:crypto'
import {homedir} from 'node:os'
import {isAbsolute,join,relative,dirname,resolve} from 'node:path'
import {createInterface} from 'node:readline'
import {recoveryWorkingDirectory,validateRecoveryBinding} from './recovery-workspace'
// Bun's known extracted registry layout only. Read matching package slots; never
// follow its package aliases, or grant the installer writes to it.
function cachePath(path:string){
 path=resolve(path)
 for(let part=path;;part=dirname(part)){
  if(lstatSync(part).isSymbolicLink()||realpathSync(part)!==part)throw Error('Private cache source contains a symlink/junction or noncanonical path')
  if(dirname(part)===part)break
 }
 return lstatSync(path)
}
export function lockedPackageApplies(entry:any,platform=process.platform,arch=process.arch){
 const accepts=(constraint:unknown,value:string)=>{
  if(constraint===undefined)return true
  const values=Array.isArray(constraint)?constraint:[constraint]
  if(values.some(v=>typeof v!=='string'))throw Error('Invalid locked platform constraint')
  if(values.includes('!'+value))return false
  const positive=values.filter(v=>!v.startsWith('!'))
  return !positive.length||positive.includes('any')||positive.includes(value)
 }
 return accepts(entry[2]?.os,platform)&&accepts(entry[2]?.cpu,arch)
}
function provisionCache(destination:string,entries:any[],source:string){
 const budget={files:0,bytes:0},packages:string[]=[],deadline=Date.now()+30000
 const read=(path:string)=>{
  const stat=cachePath(path)
  if(!stat.isFile()||stat.size>32*1024*1024)throw Error('Private cache requires regular package files of at most 32 MiB')
  const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
  try{
   const opened=fstatSync(fd)
   if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw Error('Private cache source changed while opening')
   const bytes=Buffer.alloc(stat.size);let offset=0
   while(offset<bytes.length){const size=readSync(fd,bytes,offset,bytes.length-offset,null);if(!size)throw Error('Private cache source shortened');offset+=size}
   const after=fstatSync(fd);cachePath(path)
   if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('Private cache source changed while reading')
   return bytes
  }finally{closeSync(fd)}
 }
 const copy=(from:string,to:string,depth=0)=>{
  if(Date.now()>deadline)throw Error('Private cache exceeded 30 second provisioning budget; inspect partial cache before retrying')
  if(depth>32)throw Error('Private cache exceeds supported package directory depth')
  budget.files++
  const stat=cachePath(from)
  if(stat.isDirectory()){
   mkdirSync(to);const dir=opendirSync(from)
   try{for(let entry=dir.readSync();entry;entry=dir.readSync()){
    if(entry.name.length>200||/[\\:]/.test(entry.name)||/^(?:\.env(?:\..*)?|\.git|\.npmrc|\.bunfig\.toml|bunfig\.toml|\.netrc|\.ssh|\.aws|\.credentials|.*\.(?:pem|key|pfx))$/i.test(entry.name))throw Error('Private cache package contains an unsupported sensitive filename')
    copy(join(from,entry.name),join(to,entry.name),depth+1)
   }}finally{dir.closeSync()}
  }else{
   if(!stat.isFile())throw Error('Private cache source must be a regular package file')
   const sourceFD=openSync(from,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
   let targetFD:number|undefined
   try{
    const opened=fstatSync(sourceFD)
    if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw Error('Private cache source changed while opening')
    targetFD=openSync(to,'wx',stat.mode&0o777)
    const buffer=Buffer.alloc(64*1024);let copied=0
    for(;;){const count=readSync(sourceFD,buffer,0,buffer.length,null);if(!count)break;let offset=0;while(offset<count)offset+=writeSync(targetFD,buffer,offset,count-offset);copied+=count}
    const after=fstatSync(sourceFD);cachePath(from)
    if(copied!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('Private cache source changed while copying')
    budget.bytes+=copied
   }finally{closeSync(sourceFD);if(targetFD!==undefined)closeSync(targetFD)}
  }
 }
 if(entries.length>256)throw Error('Private cache exceeds 256 locked packages; owner handoff required')
 for(const entry of entries){
  if(!lockedPackageApplies(entry))continue
  if(packages.includes(entry[0]))continue
  const at=entry[0].lastIndexOf('@'),name=entry[0].slice(0,at),version=entry[0].slice(at+1)
  let slot=name+'@'+version+'@@@1',from=join(source,slot)
  // Bun hashes prerelease/build suffixes. Inspect only this package's matching
  // version prefix and require exact package metadata; aliases and patches stay excluded.
  if(!existsSync(from)&&/[-+]/.test(version)){
   const parent=name.startsWith('@')?join(source,name.split('/')[0]):source
   const base=name.split('/').at(-1)!+'@'+version.split(/[-+]/)[0]+'-'
   if(existsSync(parent)){
    cachePath(parent);const entries=opendirSync(parent)
    try{for(let item=entries.readSync();item;item=entries.readSync()){
     if(!item.name.startsWith(base)||!/^.*-[a-f0-9]+@@@1$/.test(item.name))continue
     const candidate=join(parent,item.name)
     const metadata=JSON.parse(read(join(candidate,'package.json')).toString())
     if(metadata.name===name&&metadata.version===version){slot=(name.startsWith('@')?name.split('/')[0]+'/':'')+item.name;from=candidate;break}
    }}finally{entries.closeSync()}
   }
  }
  const to=join(destination,slot)
  if(!existsSync(from))throw Error('Private cache missing exact locked package '+entry[0]+'; populate the trusted cache separately or hand off')
  const metadata=JSON.parse(read(join(from,'package.json')).toString())
  if(metadata.name!==name||metadata.version!==version)throw Error('Private cache package name/version mismatch for '+entry[0])
  if(name.startsWith('@'))mkdirSync(dirname(to),{recursive:true})
  copy(from,to);packages.push(entry[0])
 }
 return {directory:destination,packages,...budget}
}
function preparationOutput(value:unknown){
 return String(value??'').replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[redacted]@').replace(/((?:authorization|token|password|secret|api[_-]?key)\s*[:=]\s*)(?:Bearer\s+)?[^\s"']+/gi,'$1[redacted]').slice(0,4096)
}
function lockedIntegrity(value:unknown){
 if(typeof value!=='string')return false
 const match=/^sha(256|384|512)-([A-Za-z0-9+/]+={0,2})$/.exec(value)
 if(!match)return false
 const bytes=Buffer.from(match[2],'base64')
 return bytes.length===Number(match[1])/8&&bytes.toString('base64')===match[2]
}
// Fixed recipe, executed through the same network-disabled command/exec boundary
// as the pending command. No arbitrary configured bootstrap or lifecycle argv.
export async function prepareRecoveredEnvironment(workspace:string,receipt:string,execute=executeRecoveredCommand,sourceCache=process.env.BUN_INSTALL_CACHE_DIR??join(process.env.BUN_INSTALL??join(homedir(),'.bun'),'install','cache')){
 const manifest=join(workspace,'package.json'),lock=join(workspace,'bun.lock')
 if(!existsSync(lock))throw Error('Isolated dependency preparation requires a tracked text bun.lock; reads and patches remain available')
 const canonical=realpathSync(workspace)
 for(const path of [manifest,lock])if(!lstatSync(path).isFile()||realpathSync(path)!==join(canonical,path===manifest?'package.json':'bun.lock'))throw Error('Preparation manifest or lockfile is not an isolated regular file')
 const bytes=readFileSync(manifest),locked=readFileSync(lock)
 const fingerprint=createHash('sha256').update(bytes).update('\0').update(locked).digest('hex')
 const pkg=JSON.parse(bytes.toString()),data=Bun.JSONC.parse(locked.toString())
 if(pkg.packageManager&&!/^bun@/.test(pkg.packageManager))throw Error('Declared package manager is not Bun; reads and patches remain available')
 if(pkg.workspaces||Object.keys(data.workspaces??{}).some(path=>path!==''))throw Error('Workspace dependency preparation needs a separately verified recipe; reads and patches remain available')
 for(const entry of Object.values(data.packages??{}) as any[]){
  if(!Array.isArray(entry)||typeof entry[0]!=='string'||entry[0].length>240||!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry[0])||entry[1]!==''||!lockedIntegrity(entry[3]))throw Error('Only integrity-locked default registry packages support automatic preparation; local/Git/unverified inputs require owner handoff')
 }
 for(const value of Object.values({...pkg.dependencies,...pkg.devDependencies,...pkg.optionalDependencies}) as string[])if(typeof value!=='string'||/^(?:file:|link:|workspace:|git|https?:|\.\.?[\/]|[A-Za-z]:)/.test(value))throw Error('Local/Git dependency input requires owner handoff; reads and patches remain available')
 if(existsSync(receipt)){
  const prior=JSON.parse(readFileSync(receipt,'utf8'))
  if(prior.fingerprint!==fingerprint)throw Error('Preparation inputs changed; preserve the old receipt and retry with a fresh command ticket')
  if(prior.state==='blocked'&&!prior.output&&!existsSync(join(workspace,'node_modules'))){
   // The installer never ran. Preserve the failed preflight and partial cache,
   // then prepare a fresh private cache; the original command was not executed.
   renameSync(receipt,receipt+'.failed-'+Date.now()+'.json')
   return prepareRecoveredEnvironment(workspace,receipt,execute,sourceCache)
  }
  if(prior.state!=='ready')throw Error('Prior dependency preparation is '+prior.state+'; inspect '+receipt+' before retrying')
  if(typeof prior.cache?.directory!=='string'||!/^\.quest-preparation-[^/\\]+[/\\]cache$/.test(relative(canonical,prior.cache.directory))||!cachePath(prior.cache.directory).isDirectory())throw Error('Prepared private cache receipt is missing or replaced; inspect before retrying')
  if(!existsSync(join(workspace,'node_modules'))||lstatSync(join(workspace,'node_modules')).isSymbolicLink())throw Error('Prepared dependencies are missing or replaced')
  return prior
 }
 if(existsSync(join(workspace,'node_modules')))throw Error('Unreceipted dependencies already exist; preserve them for inspection')
 const record:any={recipe:'bun-frozen-cache-copy',fingerprint,state:'started',networkAccess:false,scripts:false,backend:'copyfile'}
 writeFileSync(receipt,JSON.stringify(record),{flag:'wx'})
 const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'"
 try{
   const owned=mkdtempSync(join(workspace,'.quest-preparation-')),config=join(owned,'bunfig.toml'),cache=join(owned,'cache');writeFileSync(config,'');mkdirSync(cache)
   record.cache={directory:cache,state:'started'};writeFileSync(receipt,JSON.stringify(record))
   record.cache=provisionCache(cache,Object.values(data.packages??{}),sourceCache);writeFileSync(receipt,JSON.stringify(record))
   const command='& '+quote(process.execPath)+' install --frozen-lockfile --ignore-scripts --backend=copyfile --linker=hoisted --no-progress --config='+quote(config)+' --registry=http://127.0.0.1:9 --cache-dir='+quote(cache)
   const result=await execute(workspace,command,workspace)
   record.output={exitCode:result.exitCode,stdout:preparationOutput(result.stdout),stderr:preparationOutput(result.stderr)}
   if(result.exitCode!==0)throw Error('Frozen cache-only preparation failed in the network-disabled sandbox (exit '+result.exitCode+'); stdout: '+record.output.stdout+'; stderr: '+record.output.stderr+'. No network permission was added')
  if(!readFileSync(manifest).equals(bytes)||!readFileSync(lock).equals(locked))throw Error('Preparation changed immutable inputs')
  if(!existsSync(join(workspace,'node_modules'))||lstatSync(join(workspace,'node_modules')).isSymbolicLink())throw Error('Preparation did not create isolated dependencies')
  record.state='ready';writeFileSync(receipt,JSON.stringify(record));return record
  }catch(error){record.state='blocked';record.reason=preparationOutput(error);writeFileSync(receipt,JSON.stringify(record));throw Error(record.reason)}
}
export function codexExecutable(){
 const configured=process.env.OPENCODE_CODEX_EXECUTABLE
 if(configured){if(!existsSync(configured))throw Error('Configured Codex engine is unavailable');return configured}
 const candidates=[join(homedir(),'.codex','plugins','.plugin-appserver','codex.exe'),join(process.env.APPDATA??'','npm','node_modules','@openai','codex','node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','codex','codex.exe')]
 const executable=candidates.find(existsSync)
 if(!executable)throw Error('Set OPENCODE_CODEX_EXECUTABLE to the installed Codex engine for isolated recovery')
 return executable
}
export async function executeRecoveredCommand(directory:string,command:string,workspace=directory){
 workspace=realpathSync(workspace);directory=realpathSync(directory)
 const rel=relative(workspace,directory)
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\'))throw Error('Recovered working directory escaped its workspace')
 const child=spawn(codexExecutable(),['app-server'],{cwd:directory,windowsHide:true,stdio:['pipe','pipe','pipe']})
 let id=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>()
 const fail=(e:Error)=>{for(const p of pending.values())p.reject(e);pending.clear()}
  let diagnostic=''
  child.on('error',fail);child.on('exit',code=>fail(Error('Recovery host exited before reporting command completion: '+code+'; '+preparationOutput(diagnostic))))
  child.stderr.on('data',bytes=>{diagnostic=(diagnostic+bytes.toString()).slice(-4096)})
 createInterface({input:child.stdout}).on('line',line=>{let value:any;try{value=JSON.parse(line)}catch{return}const p=pending.get(value.id);if(p){pending.delete(value.id);value.error?p.reject(Error(JSON.stringify(value.error))):p.resolve(value.result)}})
 const rpc=(method:string,params:any)=>new Promise<any>((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});child.stdin.write(JSON.stringify({id:next,method,params})+'\n')})
 const timer=setTimeout(()=>{fail(Error('Isolated command has no terminal result; do not replay it automatically'));child.kill()},120000)
 try{
  await rpc('initialize',{clientInfo:{name:'quest-isolated-recovery',version:'1'},capabilities:{experimentalApi:true}})
  child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n')
  return await rpc('command/exec',{command:[join(process.env.SystemRoot??'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),'-NoProfile','-NonInteractive','-Command',command],cwd:directory,env:{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:workspace},sandboxPolicy:{type:'workspaceWrite',writableRoots:[workspace],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true},timeoutMs:90000})
 }finally{clearTimeout(timer);child.stdin.end();child.kill()}
}
export async function runRecoveryTicket(ticket:string,expectedHash?:string){
 let preflightReceipt:{path:string;hash:string}|undefined
 try{
   if(!ticket||!/(?:^|[/\\])[a-f0-9-]{36}\.json$/.test(ticket))throw Error('Invalid recovery command ticket')
  // Atomic claim prevents a host retry from executing a command twice. Unknown
  // completion stays claimed for inspection; it is never silently replayed.
  const claimed=ticket+'.claimed',receipt=claimed+'.result.json'
   const checked=(path:string)=>{
    const stat=cachePath(path)
    if(!stat.isFile()||stat.nlink!==1||stat.size>1024*1024)throw Error('Invalid recovery ticket file')
    const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
    try{const opened=fstatSync(fd);if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino)throw Error('Recovery ticket replaced');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)throw Error('Recovery ticket shortened');offset+=n}const after=fstatSync(fd);cachePath(path);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('Recovery ticket changed');return bytes}finally{closeSync(fd)}
   }
   const bytes=checked(ticket),hash=createHash('sha256').update(bytes).digest('hex')
   if(expectedHash&&hash!==expectedHash)throw Error('Recovery ticket digest mismatch')
   if(existsSync(receipt)){const result=JSON.parse(checked(receipt).toString());if(result.ticketHash!==hash)throw Error('Recovery receipt binding mismatch');process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exitCode=result.exitCode??1;return}
   if(existsSync(claimed))throw Error('Command completion is unknown; inspect the claimed ticket instead of replaying it')
   // Exclusive creation, unlike rename-over-existing, is an atomic no-replay
   // claim even if two ordinary tool executions arrive concurrently.
   cachePath(dirname(ticket));writeFileSync(claimed,bytes,{flag:'wx',mode:0o600})
   preflightReceipt={path:receipt,hash}
   const input=JSON.parse(bytes.toString())
   if(input.version!==1||typeof input.command!=='string'||typeof input.directory!=='string')throw Error('Invalid recovery command record')
   if(input.binding)validateRecoveryBinding(input.binding)
  // Codex's Bash hook exposes command only; the original native workdir is
  // retained by the wrapper process. Map that cwd before entering isolation.
   const directory=input.binding?recoveryWorkingDirectory(input.binding,input.workdir??process.cwd()):input.directory
   if(input.prepare){
    const workspace=input.workspace??input.directory
    const fingerprint=createHash('sha256').update(workspace).update(readFileSync(join(workspace,'package.json'))).update(existsSync(join(workspace,'bun.lock'))?readFileSync(join(workspace,'bun.lock')):'missing-lock').digest('hex')
     // Different command tickets have separate staging directories. Keep the
     // environment receipt with the owned worktree so subsequent commands can
     // reuse prepared dependencies without reading the protected ledger.
     const preparation=await prepareRecoveredEnvironment(workspace,join(workspace,'.quest-environment-'+fingerprint+'.json'))
    console.error('Quest isolated preparation: '+JSON.stringify(preparation))
   }
  preflightReceipt=undefined
  const result=await executeRecoveredCommand(directory,input.command,input.workspace??input.directory)
   writeFileSync(receipt+'.tmp',JSON.stringify({...result,ticketHash:hash}),{flag:'wx'});renameSync(receipt+'.tmp',receipt)
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exitCode=result.exitCode??1
 }catch(error){const message='Quest isolated recovery: '+(error instanceof Error?error.message:String(error));if(preflightReceipt&&!existsSync(preflightReceipt.path))writeFileSync(preflightReceipt.path,JSON.stringify({ticketHash:preflightReceipt.hash,exitCode:1,stdout:'',stderr:message,commandStarted:false}),{flag:'wx'});console.error(message);process.exitCode=1}
}
if(import.meta.main)await runRecoveryTicket(process.argv[2])
