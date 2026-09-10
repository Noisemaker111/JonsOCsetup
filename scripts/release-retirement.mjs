import {retryFinishedWorktrees} from './worktree-cleanup.mjs'
/** Release lifetime ownership. Uninstrumented releases are never guessed dead. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,copyFileSync,realpathSync,rmdirSync} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
import {homedir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {git,pathKey,within,removeIntegratedWorktree} from '../quest/cleanup-git.mjs'
const registry=join(homedir(),'.config','opencode','.channels')
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const atomic=(p,v)=>{mkdirSync(dirname(p),{recursive:true});const t=p+'.'+process.pid+'.tmp';writeFileSync(t,JSON.stringify(v,null,2)+'\n');renameSync(t,p)}
function locked(operation){
 const path=join(registry,'retirement.lock');mkdirSync(registry,{recursive:true});try{mkdirSync(path)}catch{throw Error('Release launch or retirement is in progress; retry shortly')}
 try{return operation()}finally{rmdirSync(path)}
}
export function useRelease(root,pid=process.pid){return locked(()=>useReleaseLocked(root,pid))}
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
  if(e.isDirectory())preserveTree(from,to);else if(e.isFile())copyFileSync(from,to)
 }
}
export function retireReleases(repository){return locked(()=>retireReleasesLocked(repository))}
function retireReleasesLocked(repository){
 const dir=join(registry,'releases');if(!existsSync(dir))return []
 const protectedRoots=new Set([pathKey(resolve(dirname(fileURLToPath(import.meta.url)),'..'))])
 for(const name of ['dev','stable']){const p=join(registry,name+'.json');if(existsSync(p)){const pointer=read(p);for(const entry of [pointer,pointer.previous])if(entry?.root)protectedRoots.add(pathKey(entry.root))}}
 const leases=join(registry,'release-users'),users=existsSync(leases)?readdirSync(leases).filter(n=>n.endsWith('.json')).map(n=>read(join(leases,n))):[]
 const results=[]
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(!entry.isDirectory()||!entry.name.startsWith('dev-'))continue
  const root=join(dir,entry.name),file=join(root,'channel-release.json');if(protectedRoots.has(pathKey(root)))continue
  if(!existsSync(file)){results.push({root,removed:false,reason:'No release ownership receipt'});continue}
  const release=read(file)
  if(release.cleanupProtocol!==1){results.push({root,removed:false,reason:'Older release has no complete process lifetime record'});continue}
  if(!within(dir,realpathSync(root))||pathKey(root)!==pathKey(realpathSync(root))||pathKey(release.root)!==pathKey(root)||release.channel!=='dev')throw Error('Release ownership mismatch')
  const owners=users.filter(u=>pathKey(u.root)===pathKey(root))
  // Even an absent/dead PID cannot prove an unacknowledged child stopped.
  if(owners.some(u=>!u.endedAt)){results.push({root,removed:false,reason:'A release process is active or its exit was not acknowledged'});continue}
  try{
   const evidence=join(registry,'retired-evidence',entry.name)
   for(const name of ['run','.visual-e2e'])if(existsSync(join(root,name)))preserveTree(join(root,name),join(evidence,name))
   const result=removeIntegratedWorktree({root:repository,path:root,head:release.commit,ref:'refs/remotes/origin/agents',allowedIgnored:['node_modules/','generations/','.candidates/','.cache/','run/','.visual-e2e/','plugin-activation.json','channel-release.json']})
   atomic(join(registry,'retirements',entry.name+'.json'),{root,evidence,...result,at:new Date().toISOString()});results.push({root,...result})
  }catch(error){results.push({root,removed:false,reason:String(error)})}
 }
 return results
}
if(process.argv[1]&&pathKey(process.argv[1])===pathKey(fileURLToPath(import.meta.url))){
 if(process.argv[2]==='release'){releaseUse(process.argv[3]);const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const repository=dirname(resolve(root,git(root,['rev-parse','--git-common-dir'])));console.log(JSON.stringify({releases:retireReleases(repository),tasks:retryFinishedWorktrees(repository)}))}
 else throw Error('Use release <lease file>')
}
