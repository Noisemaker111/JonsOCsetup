import {retryFinishedWorktrees} from './worktree-cleanup.mjs'
/**
 * Release lifetime ownership. Uninstrumented releases are never guessed dead.
 *
 * The lock is a directory because an exclusive create is the one thing every filesystem
 * agrees on, and it carries owner.json so a lock that outlived its process can be told
 * apart from one that is working. A bare directory recorded nothing: a launch killed
 * mid-operation left it behind and every later launch failed with "retry shortly" while
 * nothing on the machine could ever remove it, which is a strand, not a wait. Reclaim is
 * therefore evidence-driven -- the owning process is gone, or the hold is past a ceiling
 * no real pass approaches -- never a shortened timeout, and never silent: it prints what
 * it took and why, and keeps the record it removed under .channels/lock-reclaims.
 */
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,copyFileSync,realpathSync,rmSync,statSync,unlinkSync} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
import {homedir,hostname} from 'node:os'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {git,pathKey,within,removeIntegratedWorktree} from '../quest/cleanup-git.mjs'
const registry=join(homedir(),'.config','opencode','.channels')
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const atomic=(p,v)=>{mkdirSync(dirname(p),{recursive:true});const t=p+'.'+process.pid+'.tmp';writeFileSync(t,JSON.stringify(v,null,2)+'\n');renameSync(t,p)}
const lockPath=join(registry,'retirement.lock')
/** A hold younger than this is never judged: a reclaim decision must never land on a claim being made right now. */
const SETTLE=30_000
/** Longest plausible hold. A lease write is one small file; a full retirement pass is git work measured in seconds. */
const CEILING=15*60_000
const ATTEMPTS=4,PAUSE=250
const pause=ms=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}
const ago=ms=>ms<1000?`${ms}ms`:ms<60_000?`${Math.round(ms/1000)}s`:ms<3_600_000?`${Math.round(ms/60_000)}m`:`${(ms/3_600_000).toFixed(1)}h`
/** EPERM means the process exists and is not ours; ESRCH means it is provably gone. */
const running=pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true}catch(error){return error.code==='EPERM'}}
function heldBy(){
 let at;try{at=statSync(lockPath).mtimeMs}catch{return undefined}
 let record;try{record=read(join(lockPath,'owner.json'))}catch{}
 const started=record?.startedAt?Date.parse(record.startedAt):NaN
 return {record,age:Math.max(0,Date.now()-(Number.isFinite(started)?started:at))}
}
const describe=holder=>(holder.record?`a ${holder.record.operation} taken by pid ${holder.record.pid} on ${holder.record.host} at ${holder.record.startedAt}`:'an operation that recorded no owner')+` (${ago(holder.age)} ago)`
function staleReason(holder){
 if(holder.age<SETTLE)return undefined
 const record=holder.record
 if(record&&!running(record.pid))return `the ${record.operation} that took it in pid ${record.pid} at ${record.startedAt} (${ago(holder.age)} ago) is no longer running`
 if(holder.age<CEILING)return undefined
 return record
  ?`pid ${record.pid} still exists but has held it for ${ago(holder.age)}, past the ${ago(CEILING)} ceiling for a release ${record.operation}, so it is wedged or that pid was reused`
  :`it records no owner at all and is ${ago(holder.age)} old, past the ${ago(CEILING)} ceiling for a release operation`
}
function reclaim(holder,reason,operation){
 const moved=`${lockPath}.reclaimed-${randomUUID()}`
 try{renameSync(lockPath,moved)}catch{return false} // another process reclaimed it first
 let taken;try{taken=read(join(moved,'owner.json'))}catch{}
 if(JSON.stringify(taken??null)!==JSON.stringify(holder.record??null)){
  // The lock changed hands between reading it and moving it; the holder we judged is not the one we took.
  try{renameSync(moved,lockPath);return false}catch(error){throw Error(`Reclaimed a release lock that changed hands and could not be restored; inspect ${moved} before launching again: ${error}`)}
 }
 const evidence=join(registry,'lock-reclaims',`${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}.json`)
 atomic(evidence,{lock:lockPath,reason,heldFor:ago(holder.age),owner:taken??null,reclaimedBy:{pid:process.pid,operation,host:hostname()},at:new Date().toISOString()})
 rmSync(moved,{recursive:true,force:true})
 process.stderr.write(`[release-lock] Reclaimed ${lockPath}: ${reason}. Removed ${describe(holder)}; saved it to ${evidence}.\n`)
 return true
}
function claim(operation){
 mkdirSync(registry,{recursive:true})
 try{mkdirSync(lockPath)}catch{return undefined}
 const token=randomUUID()
 try{writeFileSync(join(lockPath,'owner.json'),JSON.stringify({token,operation,pid:process.pid,host:hostname(),startedAt:new Date().toISOString()},null,2)+'\n')}
 catch(error){rmSync(lockPath,{recursive:true,force:true});throw error}
 return token
}
function releaseLock(token){
 let owner;try{owner=read(join(lockPath,'owner.json'))}catch{}
 if(owner&&owner.token!==token){process.stderr.write(`[release-lock] Left ${lockPath} alone: it now holds ${describe({record:owner,age:0})}, not this operation.\n`);return}
 try{rmSync(lockPath,{recursive:true,force:true})}catch(error){process.stderr.write(`[release-lock] Could not remove ${lockPath}: ${error}\n`)}
}
function locked(operation,run){
 for(let attempt=0;;attempt++){
  const token=claim(operation)
  if(token!==undefined){try{return run()}finally{releaseLock(token)}}
  const holder=heldBy()
  if(!holder){if(attempt>=ATTEMPTS)throw Error('Release launch or retirement is in progress; retry shortly');continue} // released while we looked; claim again
  const reason=staleReason(holder)
  if(reason&&reclaim(holder,reason,operation))continue
  if(attempt>=ATTEMPTS)throw Error(`Release ${describe(holder)} is in progress; retry shortly. A later launch reclaims this lock once that process is gone or the hold passes ${ago(CEILING)}.`)
  if(!reason)pause(PAUSE)
 }
}
export function useRelease(root,pid=process.pid){return locked('launch',()=>useReleaseLocked(root,pid))}
function useReleaseLocked(root,pid){
 const release=join(root,'channel-release.json');if(!existsSync(release)||read(release).cleanupProtocol!==1)return
 const id=randomUUID(),file=join(registry,'release-users',id+'.json');atomic(file,{root,pid,startedAt:new Date().toISOString()});return file
}
export function releaseUse(file){if(!file)return;if(!within(join(registry,'release-users'),file))throw Error('Invalid release lease');atomic(file,{...read(file),endedAt:new Date().toISOString()})}
function preserveTree(source,destination){
 mkdirSync(destination,{recursive:true})
 for(const e of readdirSync(source,{withFileTypes:true})){
  if(e.isSymbolicLink())continue // launch config junctions are reproducible, not artifacts
  const from=join(source,e.name),to=join(destination,e.name)
  if(e.isDirectory())preserveTree(from,to);else if(e.isFile()){copyFileSync(from,to);if(!readFileSync(from).equals(readFileSync(to)))throw Error('Release evidence copy changed: '+from)}
 }
}
export function retireReleases(repository){return locked('retirement',()=>retireReleasesLocked(repository))}
function retireReleasesLocked(repository){
 const dir=join(registry,'releases');if(!existsSync(dir))return []
 const protectedRoots=new Set([pathKey(resolve(dirname(fileURLToPath(import.meta.url)),'..'))])
 for(const name of ['dev','stable']){const p=join(registry,name+'.json');if(existsSync(p)){const pointer=read(p);for(const entry of [pointer,pointer.previous])if(entry?.root)protectedRoots.add(pathKey(entry.root))}}
 const leases=join(registry,'release-users'),users=existsSync(leases)?readdirSync(leases).filter(n=>n.endsWith('.json')).map(n=>({file:join(leases,n),...read(join(leases,n))})):[]
 const results=[]
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(!entry.isDirectory()||!entry.name.startsWith('dev-'))continue
  const root=join(dir,entry.name),file=join(root,'channel-release.json');if(protectedRoots.has(pathKey(root)))continue
  if(!existsSync(file)){results.push({root,removed:false,reason:'No release ownership receipt'});continue}
  const release=read(file)
  if(release.cleanupProtocol!==1){results.push({root,removed:false,reason:'Older release has no complete process lifetime record'});continue}
  if(!within(dir,realpathSync(root))||pathKey(root)!==pathKey(realpathSync(root))||pathKey(release.root)!==pathKey(root)||release.channel!=='dev')throw Error('Release ownership mismatch')
  let untrackedLaunch=false
  for(const [kind,name] of [['runtime','owner.json'],['direct','launch.json']]){const launches=join(root,'run',kind);if(existsSync(launches))for(const d of readdirSync(launches)){const file=join(launches,d,name);if(existsSync(file)&&!read(file).releaseLease)untrackedLaunch=true}}
  if(untrackedLaunch){results.push({root,removed:false,reason:'A launch has no process lifetime lease; ownership review required'});continue}
  const owners=users.filter(u=>u.root&&pathKey(u.root)===pathKey(root))
  // Even an absent/dead PID cannot prove an unacknowledged child stopped, so this stays a
  // refusal rather than a reclaim. Name the process so a lease left open by a killed launch
  // is visible instead of silently pinning the release forever.
  const open=owners.filter(u=>!u.endedAt)
  if(open.length){results.push({root,removed:false,reason:`A release process is active or its exit was not acknowledged (${open.map(u=>`pid ${u.pid} ${running(u.pid)?'running':'not running'} since ${u.startedAt}`).join('; ')})`});continue}
  try{
   const evidence=join(registry,'retired-evidence',entry.name)
   for(const name of ['run','.visual-e2e'])if(existsSync(join(root,name)))preserveTree(join(root,name),join(evidence,name))
   const result=removeIntegratedWorktree({root:repository,path:root,head:release.commit,ref:'refs/remotes/origin/agents',allowedIgnored:['node_modules/','generations/','.candidates/','.cache/','run/','.visual-e2e/','plugin-activation.json','channel-release.json']})
   atomic(join(registry,'retirements',entry.name+'.json'),{root,evidence,...result,at:new Date().toISOString()});results.push({root,...result})
  }catch(error){results.push({root,removed:false,reason:String(error)})}
 }
 // A lease says "this release root is in use". Nothing ever removed one, so they accumulated
 // against roots that had already been retired -- 67 records for 28 roots here on 2026-09-11,
 // 40 of them naming directories that no longer existed. A record for a vanished root can
 // guard nothing, so retirement clears it; leases for live roots stay as use evidence.
 const cleared=users.filter(u=>!u.root||!existsSync(u.root))
 for(const lease of cleared)try{unlinkSync(lease.file)}catch{}
 if(cleared.length)results.push({clearedLeases:cleared.length,reason:'Release roots no longer exist'})
 return results
}
if(process.argv[1]&&pathKey(process.argv[1])===pathKey(fileURLToPath(import.meta.url))){
 if(process.argv[2]==='release'){releaseUse(process.argv[3]);const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const repository=dirname(resolve(root,git(root,['rev-parse','--git-common-dir'])));console.log(JSON.stringify({releases:retireReleases(repository),tasks:retryFinishedWorktrees(repository)}))}
 else throw Error('Use release <lease file>')
}
