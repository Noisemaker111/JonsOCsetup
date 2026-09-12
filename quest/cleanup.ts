import {hostExecution} from './host-observation'
import {existsSync,readdirSync,readFileSync,mkdirSync,copyFileSync,lstatSync,realpathSync,watch,unlinkSync} from 'node:fs'
import {join,resolve,isAbsolute,basename,relative} from 'node:path'
import {createHash} from 'node:crypto'
import {questAssetsDir} from './artifacts'
import {QuestWorkspaces} from './workspaces'
import {readAllQuests} from './index'
import {inspectWorker} from './worker-inspection'
import {readContinuations} from './runtime-queues'
import {pathKey,within,git} from './cleanup-git.mjs'
import type {QuestStore} from './store'
import type {Quest} from './types'

const terminal=new Set(['completed','failed','cancelled'])
const running=new WeakMap<object,Promise<unknown>>()
/** Archived records are durable cleanup requests, including turn-ins from the board and CLI. */
export function cleanupQuests(store:QuestStore,host?:any,only?:string):Promise<any> {
 if(host&&running.has(host))return running.get(host)!
 const run=async()=>{
  const manager=new QuestWorkspaces(store.runtime),results:any[]=[]
  for(const entry of readAllQuests(store.projectRoot,{includeArchived:true})){
   const q=entry.quest;if(!q||q.state!=='Archived'||only&&q.id!==only)continue
   const dir=join(store.runtime,'workspaces')
   for(const file of existsSync(dir)?readdirSync(dir):[]){
    if(!file.endsWith('.json'))continue
    const w=manager.get(file.slice(0,-5));if(!w||w.questID!==q.id||w.removed||w.claimedRunID||w.mode==='shared'||w.mode==='research')continue
    let reason:string|undefined
    const sessions=q.sessions.filter(s=>(s.runID??s.callID)===w.runID)
    if(w.cleanupProtocol!==1)reason='Older worker lacks the retirement guard; retain until its owner explicitly finishes the checkout'
    else if(!sessions.length)reason='No terminal worker ownership record; retained for inspection'
    else if(q.sessions.some(s=>!terminal.has(s.state)))reason='A Quest worker is active or uncertain'
    else if(readContinuations(store.runtime).some(r=>r.questID===q.id&&!['done','stopped'].includes(r.state)))reason='A continuation still needs this Quest'
    else for(const s of sessions){
     if(s.sessionID?.startsWith('command_'))continue
     if(!host){reason='Connect the owning OpenCode host to verify worker completion';break}
     const sessionID=s.openCodeSessionId??s.sessionID
     let active=hostExecution(host,sessionID!)
     if(typeof host.active==='function'){const response=await host.active();const rows=response?.data??response;active=Object.hasOwn(rows,sessionID!)}
     if(active!==false){reason='Owning host has not confirmed this worker is idle';break}
     const observed=await inspectWorker(host,s)
     if(!['completed','failed','interrupted'].includes(observed.state)){reason='Worker retained: '+observed.reason;break}
     const row=await host.get({sessionID:s.openCodeSessionId??s.sessionID});const actual=row?.data??row
     if(!actual?.location?.directory||pathKey(actual.location.directory)!==pathKey(w.path)){reason='Worker location does not match the owned checkout';break}
    }
    if(!reason)try{
     const coordination=join(store.runtime,'coordination',w.projectID+'.json')
     if(existsSync(coordination)&&JSON.parse(readFileSync(coordination,'utf8')).participants.some((p:any)=>!p.releasedAt&&pathKey(p.checkout)===pathKey(w.path)))reason='An editor still owns this checkout'
    }catch(e){reason=String(e)}
    const outcome=reason?manager.retain(w.runID,reason):manager.cleanup(w.runID,()=>{
     if(store.read(q.id)?.state!=='Archived')throw Error('Quest reopened during cleanup')
     preserveArtifacts(store,q,w.path)
    })
    results.push({quest:q.title,...outcome})
   }
  }
  return results
 }
 const promise=run().finally(()=>{if(host)running.delete(host)})
 if(host)running.set(host,promise)
 return promise
}
export function cleanupStatus(store:QuestStore,q:Quest){const manager=new QuestWorkspaces(store.runtime);return q.sessions.flatMap(s=>{const id=s.runID??s.callID;if(!/^[a-z0-9-]{1,80}$/.test(id))return [];const w=manager.get(id);return w?[{runID:id,removed:w.removed===true,...w.cleanup}]:[]})}

function preserveArtifacts(store:QuestStore,q:Quest,workspace:string){
 let changed=false
 const copies:Array<{source:string;digest:string}>=[]
 const artifacts=q.evidence.artifacts.map(a=>{
  if(!a.path)return a
  const assetRoot=questAssetsDir(store.projectRoot,q.id)
  if(a.path.replaceAll('\\','/').startsWith('.opencode/quests-assets/'))return a
  const source=isAbsolute(a.path)?a.path:resolve(workspace,a.path)
  if(!within(workspace,source))return a
  if(!existsSync(source)||!lstatSync(source).isFile()||!within(realpathSync(workspace),realpathSync(source)))throw Error('Artifact missing, linked or not a regular file: '+a.name)
  const data=readFileSync(source),digest=createHash('sha256').update(data).digest('hex')
  mkdirSync(assetRoot,{recursive:true})
  const destination=join(assetRoot,digest+'-'+basename(source))
  if(!existsSync(destination))copyFileSync(source,destination)
  if(createHash('sha256').update(readFileSync(destination)).digest('hex')!==digest)throw Error('Artifact copy verification failed')
  copies.push({source,digest});changed=true;return {...a,path:destination,digest}
 })
 if(changed){const current=store.read(q.id);if(!current||current.revision!==q.revision)throw Error('Quest changed while preserving artifacts; retry cleanup');store.apply(q.id,'patched',{evidence:{...q.evidence,artifacts}},'quest:cleanup-artifacts',{expectedRevision:q.revision});q.evidence.artifacts=artifacts;q.revision=store.read(q.id)!.revision}
 for(const {source,digest} of copies){
  if(git(workspace,['ls-files','--',relative(workspace,source)]))continue
  if(createHash('sha256').update(readFileSync(source)).digest('hex')!==digest)throw Error('Artifact changed after preservation')
  unlinkSync(source)
 }
}
const watching=new WeakSet<object>()
/** Filesystem/host events, never a cleanup polling interval or cron. */
export function installQuestCleanup(store:QuestStore,host:object){
 if(watching.has(host))return;watching.add(host)
 const root=join(store.projectRoot,'.opencode');mkdirSync(root,{recursive:true})
 const gitWatchers=new Set<string>()
 const watchMerges=()=>{const dir=join(store.runtime,'workspaces');for(const file of existsSync(dir)?readdirSync(dir):[]){if(!file.endsWith('.json'))continue;try{const w=JSON.parse(readFileSync(join(dir,file),'utf8'));if(w.mode==='research'||!existsSync(w.root))continue;const common=resolve(w.root,git(w.root,['rev-parse','--git-common-dir']));if(gitWatchers.has(common))continue;const watcher=watch(common,{recursive:true},(_,file)=>{if(file&&/^(refs[/\\]|packed-refs$)/.test(String(file)))trigger()});watcher.unref();watcher.on('error',e=>console.error('[quests] merge cleanup watcher',e));gitWatchers.add(common)}catch(e){console.error('[quests] cleanup watch',e)}}}
 let pending:ReturnType<typeof setTimeout>|undefined
 const trigger=()=>{if(pending)return;pending=setTimeout(()=>{pending=undefined;watchMerges();void cleanupQuests(store,host).catch(e=>console.error('[quests] cleanup',e))},100);pending.unref()}
 const watcher=watch(root,{recursive:true},(_,file)=>{if(file&&/^quests(?:-archive)?[/\\].*\.md$/.test(String(file)))trigger()});watcher.unref();watcher.on('error',e=>console.error('[quests] cleanup watcher',e))
 trigger()
}
