/**
 * @core-prevents a release lease left open by a killed launch pinning its release for the life of the machine, pre-lease worktrees accumulating forever, and their opposite: retiring a release while a host that launch spawned is still running out of it
 * @core-observed On 2026-09-11 four dead-launcher leases permanently pinned releases; on 2026-09-14 fifty releases from the historical source checkout still occupied the channel tree because they predated leases, including thirty-three with complete process-owner records and no live holder that retirement refused before judging the evidence.
 */
import {test,expect} from 'bun:test'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {git,pathKey,registeredWorktrees} from '../quest/cleanup-git.mjs'

const script=new URL('../scripts/release-retirement.mjs',import.meta.url).href
const reason=(results:any[],root:string)=>results.find(r=>r.root===root)?.reason??''

/** A whole isolated channel registry: one release root, one launch record, one open lease. */
function stage(lease:{pid:number;startedAt:string}){
 const home=mkdtempSync(join(tmpdir(),'release-lease-'))
 const registry=join(home,'.config','opencode','.channels')
 const root=join(registry,'releases','dev-lease-probe')
 mkdirSync(join(root,'run','runtime','launch-probe'),{recursive:true})
 writeFileSync(join(root,'channel-release.json'),JSON.stringify({schema:1,cleanupProtocol:1,channel:'dev',root}))
 const file=join(registry,'release-users','probe.json')
 mkdirSync(join(registry,'release-users'),{recursive:true})
 writeFileSync(file,JSON.stringify({root,...lease}))
 // A real runtime record: node-pty reports no conpty pid on Windows, so childPID is genuinely absent here.
 writeFileSync(join(root,'run','runtime','launch-probe','owner.json'),JSON.stringify({releaseLease:file,pid:lease.pid,generation:'gen-probe',sequence:1}))
 return {home,root,file}
}
/** The production entry point, in its own process against that registry. */
const retire=(home:string,repository=home,env:Record<string,string>={})=>{
 const run=spawnSync(process.execPath,['-e',`import(${JSON.stringify(script)}).then(m=>console.log(JSON.stringify(m.retireReleases(${JSON.stringify(repository)}))))`],
  {env:{...process.env,HOME:home,USERPROFILE:home,...env},encoding:'utf8',windowsHide:true})
 try{return JSON.parse(run.stdout)}catch{throw Error(`retireReleases did not report: status ${run.status} ${run.stderr||run.error?.message||'no output'}`)}
}
const leaseOf=(file:string)=>JSON.parse(readFileSync(file,'utf8'))
/** A pid that is provably gone: the process is waited for before its number is used. */
const deadPid=()=>spawnSync('node',['-e','process.exit(0)'],{windowsHide:true}).pid as number

test('a release lease is closed only when the machine shows nothing that launch started is still running',()=>{
 const homes:string[]=[];let orphan=0,inside=0
 try{
  // 1. Held: the launcher is alive. Never judged, whatever else is true.
  {
   // A launcher writes its lease just after it starts, so the lease is dated now, not backdated:
   // a record cannot claim a process that came into existence after the record was written.
   const {home,root,file}=stage({pid:process.pid,startedAt:new Date().toISOString()});homes.push(home)
   expect(reason(retire(home),root)).toContain(`pid ${process.pid}`)
   expect(leaseOf(file).endedAt).toBeUndefined()
  }

  // 2. Held: the launcher is dead but the host it spawned outlived it. This is the case a dead
  //    pid alone cannot decide, and the reason it was never safe to infer death from the lease.
  {
   const startedAt=new Date().toISOString()
   const spawner=spawnSync('node',['-e',
    "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e9)'],{detached:true,stdio:'ignore',windowsHide:true});c.unref();console.log(c.pid)"],
    {encoding:'utf8',windowsHide:true})
   orphan=Number(spawner.stdout.trim())
   expect(orphan).toBeGreaterThan(0)
   const {home,root,file}=stage({pid:spawner.pid as number,startedAt});homes.push(home)
   const held=reason(retire(home),root)
   expect(held).toContain(String(orphan))
   expect(held).toContain('is a child of pid')
   expect(leaseOf(file).endedAt).toBeUndefined()
  }

  // 3. Free: the launcher is gone and nothing it could have started is running. The lease is
  //    closed with what was checked, and the release is no longer refused on its account.
  {
   const {home,root,file}=stage({pid:deadPid(),startedAt:new Date(Date.now()-3600_000).toISOString()});homes.push(home)
   const freed=reason(retire(home),root)
   expect(freed).not.toContain('lease')
   expect(freed).not.toContain('exit')
   const closed=leaseOf(file)
   expect(closed.endedAt).toBeTruthy()
   expect(closed.endedBy.judged.join(' ')).toContain('is not running')
   expect(closed.endedBy.checkedProcesses).toBeGreaterThan(0)
  }

  // 3b. The number was handed on. Windows reissues a dead launcher's pid within minutes -- the
  //     lease that pinned dev-3468fc4e2281 from 02:28 named 40820, which by 07:30 was a tail.exe.
  //     A process that came into existence after the record cannot be the one the record meant.
  {
   const {home,root,file}=stage({pid:process.pid,startedAt:new Date(Date.now()-3600_000).toISOString()});homes.push(home)
   expect(reason(retire(home),root)).not.toContain(`pid ${process.pid}`)
   expect(leaseOf(file).endedBy.judged.join(' ')).toContain('the number was handed on')
  }

  // 4. Refused, not assumed: a lease that cannot name what it owns is not evidence of absence.
  //    Nothing on the machine can be matched against it, so it stays open and says why.
  {
   const {home,root,file}=stage({pid:0,startedAt:'whenever'});homes.push(home)
   const blind=reason(retire(home),root)
   expect(blind).toContain('names no usable owner')
   expect(leaseOf(file).endedAt).toBeUndefined()
  }

  // 5. Held with no lease at all: something started by hand is running out of the root. Leases
  //    are bookkeeping; a process executing from the release is the thing itself.
  {
   const {home,root,file}=stage({pid:deadPid(),startedAt:new Date(Date.now()-3600_000).toISOString()})
   homes.push(home);writeFileSync(file,JSON.stringify({...leaseOf(file),endedAt:new Date().toISOString()}))
   const squatter=spawnSync(process.execPath,['-e',
    `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e9)',${JSON.stringify(root)}],{detached:true,stdio:'ignore',windowsHide:true});c.unref();console.log(c.pid)`],
    {encoding:'utf8',windowsHide:true})
   inside=Number(squatter.stdout.trim())
   expect(reason(retire(home),root)).toContain('is running out of this release root')
  }
 }finally{
  for(const pid of [orphan,inside])if(pid)try{process.kill(pid)}catch{}
  for(const home of homes)if(existsSync(home))rmSync(home,{recursive:true,force:true})
 }
})

test('a pre-lease release is removed only with complete process and historical worktree ownership evidence',()=>{
 const home=realpathSync.native(mkdtempSync(join(tmpdir(),'release-legacy-')))
 try{
  const historical=join(home,'historical'),maintained=join(home,'maintained'),foreign=join(home,'foreign'),remote='https://example.invalid/owner/repository.git'
  mkdirSync(historical);git(historical,['init']);git(historical,['config','user.email','test@example.invalid']);git(historical,['config','user.name','Test'])
  writeFileSync(join(historical,'.gitignore'),'channel-release.json\nrun/\ngenerations/\nplugin-activation.json\nnode_modules/\n')
  writeFileSync(join(historical,'source'),'owned source\n');git(historical,['add','.gitignore','source']);git(historical,['commit','-m','owned release'])
  const commit=git(historical,['rev-parse','HEAD'])
  const clone=spawnSync('git',['clone','--no-hardlinks',historical,maintained],{encoding:'utf8',windowsHide:true})
  if(clone.status!==0)throw Error(clone.stderr||'fixture clone failed')
  git(historical,['remote','add','origin',remote]);git(maintained,['remote','set-url','origin',remote]);git(maintained,['update-ref','refs/remotes/origin/agents',commit])
  const other=spawnSync('git',['clone','--no-hardlinks',historical,foreign],{encoding:'utf8',windowsHide:true})
  if(other.status!==0)throw Error(other.stderr||'foreign fixture clone failed')
  git(foreign,['remote','set-url','origin','https://example.invalid/someone/else.git'])
  const registry=join(home,'.config','opencode','.channels'),releases=join(registry,'releases')
  const stageLegacy=(name:string,kind?:'runtime'|'direct',record:Record<string,unknown>={},owner=historical)=>{
   const root=join(releases,name);git(owner,['worktree','add','--detach',root,commit])
   writeFileSync(join(root,'channel-release.json'),JSON.stringify({schema:1,channel:'dev',commit,root,preparedAt:new Date(Date.now()-60_000).toISOString()}))
   if(kind){const leaf=join(root,'run',kind,'launch');mkdirSync(leaf,{recursive:true});writeFileSync(join(leaf,kind==='runtime'?'owner.json':'launch.json'),JSON.stringify(record))}
   return root
  }
  const removable=stageLegacy('dev-legacy-removable','runtime',{pid:deadPid(),sequence:1})
  const occupied=stageLegacy('dev-legacy-occupied','runtime',{pid:process.pid,sequence:1})
  const ownerless=stageLegacy('dev-legacy-ownerless','direct',{channel:'dev',generation:'old'})
  const unknown=stageLegacy('dev-legacy-unknown')
  const wrongRepository=stageLegacy('dev-legacy-other-repository','runtime',{pid:deadPid(),sequence:1},foreign)
  const outcome=retire(home,maintained)
  expect(outcome.find((row:any)=>row.root===removable)?.removed).toBe(true)
  expect(existsSync(removable)).toBe(false)
  expect(registeredWorktrees(historical).map(row=>pathKey(row.worktree))).not.toContain(pathKey(removable))
  expect(reason(outcome,occupied)).toContain(String(process.pid));expect(existsSync(occupied)).toBe(true)
  expect(reason(outcome,ownerless)).toContain('names no process owner');expect(existsSync(ownerless)).toBe(true)
  expect(reason(outcome,unknown)).toContain('no launch records');expect(existsSync(unknown)).toBe(true)
  expect(reason(outcome,wrongRepository)).toContain('different or unknown repository');expect(existsSync(wrongRepository)).toBe(true)
 }finally{rmSync(home,{recursive:true,force:true})}
})
