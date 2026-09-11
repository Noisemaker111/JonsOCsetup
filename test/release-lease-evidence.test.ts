/**
 * @core-prevents a release lease left open by a killed launch pinning its release for the life of the machine, and its opposite: retiring a release while a host that launch spawned is still running out of it
 * @core-observed On 2026-09-11 four dev releases were pinned by leases whose launcher pids (48228, 51024, 41376 and 40820) were provably dead -- three of them appeared inside ten minutes -- and nothing on the machine could ever close those leases, so retireReleases refused those roots on every later pass.
 */
import {test,expect} from 'bun:test'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

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
const retire=(home:string,env:Record<string,string>={})=>{
 const run=spawnSync(process.execPath,['-e',`import(${JSON.stringify(script)}).then(m=>console.log(JSON.stringify(m.retireReleases(${JSON.stringify(home)}))))`],
  {env:{...process.env,HOME:home,USERPROFILE:home,...env},encoding:'utf8',windowsHide:true})
 return JSON.parse(run.stdout||'[]')
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

  // 4. Refused, not assumed: with no process listing there is no evidence either way, and
  //    "nothing matched" must never be reached by never looking.
  {
   const {home,root,file}=stage({pid:deadPid(),startedAt:new Date(Date.now()-3600_000).toISOString()});homes.push(home)
   const missing=process.platform==='win32'?{SystemRoot:join(home,'no-such-windows')}:{PATH:join(home,'no-such-bin')}
   const blind=reason(retire(home,missing),root)
   expect(blind).toContain('could not be listed')
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
