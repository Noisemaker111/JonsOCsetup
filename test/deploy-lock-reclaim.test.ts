/**
 * @core-prevents the plugin promotion lock being taken from a promotion that is still copying trees and validating a host because a bare mtime passed two minutes, and its opposite: a lock left by a killed promotion that nothing on the machine can identify or remove
 * @core-observed On 2026-09-11 scripts/plugin-deploy.ts still reclaimed .plugin-promote.lock on Date.now()-mtime>120000 with no owner record: a probe holding it from a live pid for three minutes had it deleted and the promotion ran anyway, leaving no trace, while a bare lock ten seconds old failed every later deploy with a message naming nobody -- the same shape as the retirement lock that stranded Jon's oca launches for four hours that day.
 */
import {test,expect} from 'bun:test'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,utimesSync,rmSync} from 'node:fs'
import {tmpdir,hostname} from 'node:os'
import {join} from 'node:path'

const deploy=new URL('../scripts/plugin-deploy.ts',import.meta.url).href
const home=mkdtempSync(join(tmpdir(),'deploy-lock-'))
const reclaims=join(home,'.config','opencode','.channels','lock-reclaims')
const root=join(home,'root'),lock=join(root,'.plugin-promote.lock'),candidate=join(root,'.candidates','probe')
mkdirSync(candidate,{recursive:true})

/** The public promotion call, in its own process, against an isolated home so reclaim records are ours. */
const promote=()=>{
 const run=spawnSync('bun',['-e',`const m=await import(${JSON.stringify(deploy)});try{await m.promote(${JSON.stringify(root)},${JSON.stringify(candidate)},"gen-probe");console.log("PROMOTED")}catch(e){console.log("REFUSED "+(e?.message??e))}`],
  {env:{...process.env,HOME:home,USERPROFILE:home},encoding:'utf8',windowsHide:true})
 return (run.stdout||'').trim()+((run.stderr||'').trim()&&'\n'+run.stderr.trim())
}
const hold=(owner:unknown,ageMs:number)=>{
 rmSync(lock,{recursive:true,force:true});mkdirSync(lock,{recursive:true})
 if(owner)writeFileSync(join(lock,'owner.json'),JSON.stringify(owner))
 const at=new Date(Date.now()-ageMs);utimesSync(lock,at,at)
}
const records=()=>existsSync(reclaims)?readdirSync(reclaims):[]

test('the plugin promotion lock is taken only when its owner is provably gone or the hold is implausible',()=>{
 try{
  // A promotion three minutes in is doing exactly what a promotion does: a host validation alone
  // is allowed 180s. Its lock is not available, and the refusal names who holds it.
  hold({token:'live',operation:'promotion',pid:process.pid,host:hostname(),startedAt:new Date(Date.now()-180_000).toISOString()},180_000)
  const contested=promote()
  expect(contested).toContain('REFUSED')
  expect(contested).toContain(`pid ${process.pid}`)
  expect(JSON.parse(readFileSync(join(lock,'owner.json'),'utf8')).token).toBe('live')
  expect(records()).toHaveLength(0)

  // A lock nobody can explain yet is still a lock: an unowned directory is reclaimed on age, never on sight.
  hold(undefined,0)
  expect(promote()).toContain('REFUSED')
  expect(existsSync(lock)).toBe(true)
  expect(records()).toHaveLength(0)

  // The strand: a killed promotion's bare directory, four hours old. It is taken, and the record says so.
  hold(undefined,4*3600_000)
  expect(promote()).not.toContain('already in progress')
  expect(existsSync(lock)).toBe(false)
  expect(records()).toHaveLength(1)

  // A named owner that has exited is taken at once, and the evidence names the pid it took it from.
  const dead=spawnSync('node',['-e','process.exit(0)'],{windowsHide:true}).pid
  hold({token:'dead',operation:'promotion',pid:dead,host:hostname(),startedAt:new Date(Date.now()-120_000).toISOString()},120_000)
  expect(promote()).not.toContain('already in progress')
  expect(existsSync(lock)).toBe(false)
  const evidence=records().map(name=>JSON.parse(readFileSync(join(reclaims,name),'utf8'))).find(r=>r.owner?.token==='dead')
  expect(evidence.reason).toContain(String(dead))
  expect(evidence.lock).toBe(lock)
 }finally{rmSync(home,{recursive:true,force:true})}
})
