/**
 * @core-prevents a release lock outliving the process that took it and stranding every later launch behind "retry shortly" with nothing on the machine able to remove it, and its opposite: a reclaim taking a lock whose owner is still working
 * @core-observed A killed verification run left .channels/retirement.lock behind on 2026-09-11; four hours later every oca launch still failed with "Release launch or retirement is in progress; retry shortly", and only deleting the directory by hand cleared it. It happened twice in the same session.
 */
import {test,expect} from 'bun:test'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,utimesSync,rmSync} from 'node:fs'
import {tmpdir,hostname} from 'node:os'
import {join} from 'node:path'

const script=new URL('../scripts/release-retirement.mjs',import.meta.url).href
const home=mkdtempSync(join(tmpdir(),'release-lock-'))
const registry=join(home,'.config','opencode','.channels'),lock=join(registry,'retirement.lock'),reclaims=join(registry,'lock-reclaims')
const root=join(registry,'releases','dev-test');mkdirSync(root,{recursive:true})
writeFileSync(join(root,'channel-release.json'),JSON.stringify({schema:1,cleanupProtocol:1,channel:'dev',root}))
/** The launcher's own call, in its own process, against an isolated channel registry. */
const launch=()=>spawnSync('node',['-e',`import(${JSON.stringify(script)}).then(m=>console.log(JSON.stringify({lease:m.useRelease(${JSON.stringify(root)})})))`],{env:{...process.env,HOME:home,USERPROFILE:home},encoding:'utf8',windowsHide:true})
const hold=(owner:unknown,ageMs:number)=>{
 rmSync(lock,{recursive:true,force:true});mkdirSync(lock,{recursive:true})
 if(owner)writeFileSync(join(lock,'owner.json'),JSON.stringify(owner))
 const at=new Date(Date.now()-ageMs);utimesSync(lock,at,at)
}
const records=()=>existsSync(reclaims)?readdirSync(reclaims):[]

test('a release lock is reclaimed only when its owner is provably gone or the hold is implausible',()=>{
 try{
  expect(JSON.parse(launch().stdout).lease).toContain('release-users')
  expect(existsSync(lock)).toBe(false)

  // A live owner mid-operation is never taken, however inconvenient: that is the mutual exclusion.
  hold({token:'live',operation:'retirement',pid:process.pid,host:hostname(),startedAt:new Date(Date.now()-120_000).toISOString()},120_000)
  const contested=launch()
  expect(contested.status).not.toBe(0)
  expect(contested.stderr).toContain('is in progress')
  expect(JSON.parse(readFileSync(join(lock,'owner.json'),'utf8')).token).toBe('live')
  expect(records()).toHaveLength(0)

  // Nor is a lock nobody can explain yet: an unowned directory is reclaimed on age alone, never on sight.
  hold(undefined,0)
  expect(launch().status).not.toBe(0)
  expect(existsSync(lock)).toBe(true)
  expect(records()).toHaveLength(0)

  // The strand Jon hit: a killed process's bare directory, four hours old.
  hold(undefined,4*3600_000)
  expect(JSON.parse(launch().stdout).lease).toContain('release-users')
  expect(existsSync(lock)).toBe(false)
  expect(records()).toHaveLength(1)

  // A named owner that has exited is reclaimed at once, and the record says whose lock it took.
  const dead=spawnSync('node',['-e','process.exit(0)'],{windowsHide:true}).pid
  hold({token:'dead',operation:'launch',pid:dead,host:hostname(),startedAt:new Date(Date.now()-120_000).toISOString()},120_000)
  expect(JSON.parse(launch().stdout).lease).toContain('release-users')
  expect(existsSync(lock)).toBe(false)
  const evidence=records().map(name=>JSON.parse(readFileSync(join(reclaims,name),'utf8'))).find(r=>r.owner?.token==='dead')
  expect(evidence.reason).toContain(String(dead))
 }finally{rmSync(home,{recursive:true,force:true})}
})
