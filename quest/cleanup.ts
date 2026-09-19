import {existsSync,readdirSync,readFileSync,mkdirSync,watch} from 'node:fs'
import {join,resolve} from 'node:path'
import {retireWorkspace} from './workspace-retirement'
import {QuestWorkspaces} from './workspaces'
import {readAllQuests} from './index'
import {inspectWorker,confirmWorkerIdle} from './worker-inspection'
import {boundedInspection} from './worker-observation.mjs'
import {readContinuations} from './runtime-queues'
import {pathKey,git} from './cleanup-git.mjs'
import type {QuestStore} from './store'
import type {Quest} from './types'

const terminal=new Set(['completed','failed','cancelled'])
const running=new Map<string,Promise<unknown>>()
/** Archived records are durable cleanup requests, including turn-ins from the board and CLI. */
export function cleanupQuests(store:QuestStore,host?:any,only?:string):Promise<any> {
 if(running.has(store.runtime))return running.get(store.runtime)!
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
     if(!sessionID||!await confirmWorkerIdle(host,sessionID)){reason='Owning host has not confirmed this worker is idle';break}
     const observed=await inspectWorker(host,s)
     if(!['completed','failed','interrupted'].includes(observed.state)){reason='Worker retained: '+observed.reason;break}
     const row:any=await boundedInspection((signal:AbortSignal)=>host.get({sessionID:s.openCodeSessionId??s.sessionID},{signal}));const actual=row?.data??row
     if(!actual?.location?.directory||pathKey(actual.location.directory)!==pathKey(w.path)){reason='Worker location does not match the owned checkout';break}
    }
    if(!reason)try{
     const coordination=join(store.runtime,'coordination',w.projectID+'.json')
     if(existsSync(coordination)&&JSON.parse(readFileSync(coordination,'utf8')).participants.some((p:any)=>!p.releasedAt&&pathKey(p.checkout)===pathKey(w.path)))reason='An editor still owns this checkout'
    }catch(e){reason=String(e)}
    const outcome=reason?manager.retain(w.runID,reason):await retireWorkspace({runtime:store.runtime,projectRoot:store.projectRoot,questID:q.id,runID:w.runID})
    results.push({quest:q.title,...outcome})
   }
  }
  return results
 }
 const promise=run().finally(()=>{running.delete(store.runtime)})
 running.set(store.runtime,promise)
 return promise
}
export function cleanupStatus(store:QuestStore,q:Quest){const manager=new QuestWorkspaces(store.runtime);return q.sessions.flatMap(s=>{const id=s.runID??s.callID;if(!/^[a-z0-9-]{1,80}$/.test(id))return [];const w=manager.get(id);return w?[{runID:id,removed:w.removed===true,...w.cleanup}]:[]})}

const watching=new WeakMap<object,()=>void>()
/** Filesystem/host events, never a cleanup polling interval or cron. */
export function installQuestCleanup(store:QuestStore,host:object){
 const existing=watching.get(host);if(existing)return existing
 const root=join(store.projectRoot,'.opencode');mkdirSync(root,{recursive:true})
 const gitWatchers=new Set<string>(),watchedRoots=new Set<string>(),mergeWatchers=new Set<ReturnType<typeof watch>>()
 /**
  * Only this repository's own refs decide whether a merge happened.
  *
  * Watching the whole common directory recursively also subscribed every `worktrees/<name>`
  * administrative tree -- 237 of them on this machine, across two checkouts -- and then discarded
  * everything they produced, because a per-worktree path arrives as `worktrees\<name>\refs\...`
  * and never matched the refs pattern. The subscriptions were the entire cost.
  */
 const watchRefs=(common:string)=>{
  const refs=join(common,'refs'),watchers:ReturnType<typeof watch>[]=[]
  if(existsSync(refs))watchers.push(watch(refs,{recursive:true},()=>trigger()))
  watchers.push(watch(common,{recursive:false},(_,file)=>{if(String(file??'')==='packed-refs')trigger()}))
  return watchers
 }
 const watchMerges=()=>{const dir=join(store.runtime,'workspaces');for(const file of existsSync(dir)?readdirSync(dir):[]){if(!file.endsWith('.json'))continue;let root:string|undefined;try{const w=JSON.parse(readFileSync(join(dir,file),'utf8'));if(w.mode==='research'||watchedRoots.has(w.root)||!existsSync(w.root))continue;root=w.root;const common=resolve(w.root,git(w.root,['rev-parse','--git-common-dir']));if(gitWatchers.has(common))continue;for(const watcher of watchRefs(common)){mergeWatchers.add(watcher);watcher.unref();watcher.on('error',e=>console.error('[quests] merge cleanup watcher',e))}gitWatchers.add(common)}catch(e){console.error('[quests] cleanup watch',e)}
  // One probe per root per host, whatever the probe did. A workspace root outside any repository
  // failed here on every trigger and spawned git again each time; that retry belongs to the next
  // host start, not to a loop driven by the cleanup it keeps waking.
  finally{if(root)watchedRoots.add(root)}}}
 let pending:ReturnType<typeof setTimeout>|undefined
 const trigger=()=>{if(pending)return;pending=setTimeout(()=>{pending=undefined;watchMerges();void cleanupQuests(store,host).catch(e=>console.error('[quests] cleanup',e))},100);pending.unref()}
 const watcher=watch(root,{recursive:true},(_,file)=>{if(file&&/^quests(?:-archive)?[/\\].*\.md$/.test(String(file)))trigger()});watcher.unref();watcher.on('error',e=>console.error('[quests] cleanup watcher',e))
 trigger()
 const dispose=()=>{if(pending)clearTimeout(pending);watcher.close();for(const merge of mergeWatchers)merge.close();watching.delete(host)}
 watching.set(host,dispose);return dispose
}
