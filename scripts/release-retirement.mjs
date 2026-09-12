import {retryFinishedWorktrees} from './worktree-cleanup.mjs'
/**
 * Release lifetime ownership, decided from the process table rather than from a single pid.
 *
 * A lease says "this release root is in use". It is written before a launch spawns anything and
 * closed when that launch finishes, so a launch killed in between leaves an open lease that no
 * later pass could ever close -- four releases were pinned that way on 2026-09-11, three of them
 * inside ten minutes. The old refusal was right to distrust the lease pid: a dead launcher does
 * not prove the host child it spawned stopped, and Windows hands the dead number out again. But
 * distrusting one pid is not the same as having no evidence. The launch records under
 * run/runtime/<launch>/owner.json and run/direct/<launch>/launch.json name the lease they belong to, and the
 * process table shows parents, images, command lines and start times. Together they answer the
 * question the pid could not: is anything this lease could have started still running, and is
 * anything at all on this machine running out of this release root.
 *
 * Evidence is required, not assumed. If the process table cannot be listed, or a lease is too
 * malformed to name what it owns, the release stays -- and the refusal says which it was.
 */
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,copyFileSync,realpathSync,statSync,unlinkSync} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
import {homedir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {git,pathKey,within,removeIntegratedWorktree} from '../quest/cleanup-git.mjs'
import {withLock} from './evidence-lock.mjs'
import {processSnapshot} from './process-evidence.mjs'
const registry=join(homedir(),'.config','opencode','.channels')
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const atomic=(p,v)=>{mkdirSync(dirname(p),{recursive:true});const t=p+'.'+process.pid+'.tmp';writeFileSync(t,JSON.stringify(v,null,2)+'\n');renameSync(t,p)}
/** The retirement lock, judged on its owner record; see evidence-lock.mjs for why an mtime is not evidence. */
const lock=()=>({path:join(registry,'retirement.lock'),evidence:join(registry,'lock-reclaims'),label:'release-lock',subject:'a release',activity:'Release launch or retirement'})
const locked=(operation,run)=>withLock(lock(),operation,run)

export function useRelease(root,pid=process.pid){return locked('launch',()=>useReleaseLocked(root,pid))}
function useReleaseLocked(root,pid){
 const release=join(root,'channel-release.json');if(!existsSync(release)||read(release).cleanupProtocol!==1)return
 const id=randomUUID(),file=join(registry,'release-users',id+'.json');atomic(file,{root,pid,startedAt:new Date().toISOString()});return file
}
export function releaseUse(file){if(!file)return;if(!within(join(registry,'release-users'),file))throw Error('Invalid release lease');atomic(file,{...read(file),endedAt:new Date().toISOString()})}

/** Every launch record in a release that names the lease it was taken under, with the time it was written. */
function launchRecords(root){
 const records=[]
 for(const [kind,name] of [['runtime','owner.json'],['direct','launch.json']]){
  const launches=join(root,'run',kind);if(!existsSync(launches))continue
  for(const directory of readdirSync(launches)){
   const file=join(launches,directory,name);if(!existsSync(file))continue
   let record;try{record=read(file)}catch{record={}}
   records.push({kind,file,record,at:statSync(file).mtimeMs})
  }
 }
 return records
}

/**
 * Why an open lease still holds its release, or nothing if the machine says it does not.
 *
 * Two things are looked for, because the first alone is what made the old refusal permanent:
 *  - the launcher itself, which is the lease's own pid, and every pid its launch records name;
 *  - anything those started and never acknowledged. node-pty returns no pid for a conpty child on
 *    Windows, so childPID is absent from most real records and a surviving host has to be found by
 *    its parent instead -- Windows leaves an orphan's parent number in place, which is exactly the
 *    trail a killed launcher leaves behind.
 * A pid that is running but started after the record that names it is a number Windows handed on,
 * not the process the record meant, and it is not allowed to pin the release.
 *
 * `accounted` collects every pid this lease explains, so the root-wide scan does not report the
 * same process a second time in different words. `judged` is what was decided about each recorded
 * pid, and it is written onto a lease that gets closed so the decision can be read back later.
 */
function leaseHolders(lease,snapshot,accounted){
 const started=Date.parse(lease.startedAt)
 if(!Number.isSafeInteger(lease.pid)||lease.pid<1||!Number.isFinite(started))return {held:[`the lease names no usable owner (pid ${lease.pid}, started ${lease.startedAt}), so nothing on this machine can be matched against it`],judged:[]}
 const held=[],judged=[]
 // pid -> when something else took that number over. A real orphan of the original must predate it.
 const handedOn=new Map()
 const byPid=new Map(snapshot.processes.map(entry=>[entry.pid,entry]))
 const claimed=new Map() // pid -> the moment the record naming it was written
 const note=(pid,at)=>{if(Number.isSafeInteger(pid)&&pid>0&&!claimed.has(pid))claimed.set(pid,at)}
 note(lease.pid,started)
 // A launch record only adds pids; it is never the only source of one. Both launchers write the
 // lease with the pid that goes on to spawn the host, and the direct launcher records no pid of
 // its own at all -- the shell that owns the lease is the shell that runs the host as its child.
 for(const {record,at} of lease.launches){note(record.pid,at);note(record.childPID,at)}
 const owned=accounted
 for(const [pid,at] of claimed){
  owned.add(pid) // kept even when the number has been handed on, so a real orphaned child of it is still found below
  const entry=byPid.get(pid)
  if(!entry){judged.push(`pid ${pid} is not running`);continue}
  if(entry.createdAt>at+1000){handedOn.set(pid,entry.createdAt);judged.push(`pid ${pid} is now ${entry.name}, started ${new Date(entry.createdAt).toISOString()}, after the record that named it: the number was handed on`);continue}
  held.push(`pid ${pid} (${entry.name}) started ${new Date(entry.createdAt).toISOString()} is still running`)
 }
 // Anything those processes started and never acknowledged, followed transitively.
 for(let grew=true;grew;){
  grew=false
  for(const entry of snapshot.processes){
   if(owned.has(entry.pid)||!owned.has(entry.ppid)||entry.createdAt<started-1000)continue
   const reissued=handedOn.get(entry.ppid) // a child of the number's new holder is not this launch's child
   if(reissued!==undefined&&entry.createdAt>=reissued)continue
   owned.add(entry.pid);grew=true
   held.push(`pid ${entry.pid} (${entry.name}) started ${new Date(entry.createdAt).toISOString()} is a child of pid ${entry.ppid} from this lease and is still running`)
  }
 }
 return {held,judged}
}

/**
 * Anything running out of this release root, whatever a lease does or does not say about it.
 *
 * This is the guard that does not depend on a record being written: a shell, a build or a host
 * started by hand leaves no lease, and a release something is executing from is in use however
 * the bookkeeping reads. The pass asking the question is excluded -- opencode-runtime retires
 * from inside the very root it launched from, and it cannot be the evidence against itself.
 */
function rootOccupants(root,snapshot,accounted){
 const key=pathKey(root)
 const inside=text=>typeof text==='string'&&text.replaceAll('\\','/').toLowerCase().includes(key)
 return snapshot.processes
  .filter(entry=>entry.pid!==process.pid&&!accounted.has(entry.pid)&&(inside(entry.image)||inside(entry.command)))
  .map(entry=>`pid ${entry.pid} (${entry.name}) is running out of this release root: ${(entry.command||entry.image||'').slice(0,200)}`)
}

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
 // One listing for the whole pass, so every release is judged against the same instant. A pass
 // that cannot see the process table removes nothing: "nothing matched" and "nothing was looked
 // at" produce the same empty list and mean opposite things, and only one of them is safe.
 const snapshot=processSnapshot()
 const results=[]
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(!entry.isDirectory()||!entry.name.startsWith('dev-'))continue
  const root=join(dir,entry.name),file=join(root,'channel-release.json');if(protectedRoots.has(pathKey(root)))continue
  if(!existsSync(file)){results.push({root,removed:false,reason:'No release ownership receipt'});continue}
  const release=read(file)
  if(release.cleanupProtocol!==1){results.push({root,removed:false,reason:'Older release has no complete process lifetime record'});continue}
  // A release built by trying a branch records the ref it belongs to. Judging it against
  // origin/agents would keep an unmerged candidate forever, so its own ref decides -- and while it
  // is still that ref's tip it is what the next try of that branch reuses, so it is kept.
  const integration=release.integrationRef??'refs/remotes/origin/agents'
  if(release.integrationRef){
   let tip;try{tip=git(repository,['rev-parse','--verify',integration+'^{commit}'])}catch{tip=undefined}
   if(tip===release.commit){results.push({root,removed:false,reason:'Still the tip of '+integration+'; the next try of that ref reuses this preparation'});continue}
  }
  if(!within(dir,realpathSync(root))||pathKey(root)!==pathKey(realpathSync(root))||pathKey(release.root)!==pathKey(root)||release.channel!=='dev')throw Error('Release ownership mismatch')
  const records=launchRecords(root)
  if(records.some(r=>!r.record.releaseLease)){results.push({root,removed:false,reason:'A launch has no process lifetime lease; ownership review required'});continue}
  if(snapshot.unavailable){results.push({root,removed:false,reason:`The running processes on this machine could not be listed (${snapshot.unavailable}), so nothing can say whether this release is still in use`});continue}
  const open=users.filter(u=>u.root&&pathKey(u.root)===pathKey(root)&&!u.endedAt)
  // A launch killed before it acknowledged its exit leaves an open lease. Close it only on
  // evidence that nothing it could have started is running; otherwise say what is holding it.
  const accounted=new Set(),pinning=[],closing=[]
  for(const lease of open){
   const launches=records.filter(r=>r.record.releaseLease&&pathKey(r.record.releaseLease)===pathKey(lease.file))
   const {held,judged}=leaseHolders({...lease,launches},snapshot,accounted)
   if(held.length)pinning.push(`pid ${lease.pid} since ${lease.startedAt}: ${held.join('; ')}`)
   else closing.push({lease,judged})
  }
  const occupants=rootOccupants(root,snapshot,accounted)
  if(pinning.length||occupants.length){results.push({root,removed:false,reason:`A release process is active or its exit could not be judged (${[...pinning,...occupants].join(' | ')})`});continue}
  for(const {lease,judged} of closing)atomic(lease.file,{...(({file,...rest})=>rest)(lease),endedAt:new Date().toISOString(),endedBy:{reason:'Nothing this launch started was running and nothing was running out of the release root',judged,checkedProcesses:snapshot.processes.length,by:process.pid,at:new Date().toISOString()}})
  try{
   const evidence=join(registry,'retired-evidence',entry.name)
   for(const name of ['run','.visual-e2e'])if(existsSync(join(root,name)))preserveTree(join(root,name),join(evidence,name))
   const result=removeIntegratedWorktree({root:repository,path:root,head:release.commit,ref:integration,allowedIgnored:['node_modules/','generations/','.candidates/','.cache/','run/','.visual-e2e/','plugin-activation.json','channel-release.json']})
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
