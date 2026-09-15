// @core-prevents Concurrent standalone hosts mutate the same giver conversation and lose tool outputs.
// @core-observed On September 15 two dev hosts opened the original giver; instructions flipped releases before two missing-tool-output failures.
import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {claimHost} from '../scripts/host-ownership.mjs'
import {spawnSync,spawn} from 'node:child_process'

test('a database has one launcher and becomes available after normal release',async()=>{
  const root=mkdtempSync(join(tmpdir(),'oc-host-owner-')),database=join(root,'host.db')
  try {
    const first=await claimHost({database})
    try {await expect(claimHost({database})).rejects.toThrow()}
    finally {await first.release()}
    const reopened=await claimHost({database});await reopened.release()
    const independent=await claimHost({database:join(root,'isolated.db')});await independent.release()
  }finally {rmSync(root,{recursive:true,force:true})}
})
test('a live legacy host blocks admission even without a responding health endpoint',async()=>{
  const root=mkdtempSync(join(tmpdir(),'oc-legacy-host-')),questRoot=join(root,'quests'),registry=join(questRoot,'.opencode','.quest-runtime','quest-api')
  mkdirSync(registry,{recursive:true});writeFileSync(join(registry,'legacy.json'),JSON.stringify({pid:process.pid,url:'http://127.0.0.1:1'}))
  try {await expect(claimHost({database:join(root,'host.db'),questRoot})).rejects.toThrow('already has a live host')}
  finally {rmSync(root,{recursive:true,force:true})}
})
test('the production Node launcher releases kernel ownership after a process exits without cleanup',()=>{
  if(!['win32','linux'].includes(process.platform))return
  const root=mkdtempSync(join(tmpdir(),'oc-host-crash-'))
  try {
    const result=spawnSync('node',[join(import.meta.dir,'fixtures/host-owner-crash.mjs'),join(root,'host.db')],{encoding:'utf8',windowsHide:true,timeout:10000})
    expect({status:result.status,error:result.error,stderr:result.stderr}).toEqual({status:0,error:undefined,stderr:''})
    expect(result.stdout).toContain('same database reopened')
  }finally {rmSync(root,{recursive:true,force:true})}
})

test('pre-boot discovery receipts survive recovery while current invalid receipts still block',async()=>{
  const root=mkdtempSync(join(tmpdir(),'oc-preboot-host-')),questRoot=join(root,'quests'),registry=join(questRoot,'.opencode','.quest-runtime','quest-api'),database=join(root,'host.db')
  mkdirSync(registry,{recursive:true})
  const path=join(registry,'old.json'),payload=JSON.stringify({instance:'pre-pid-format',url:'http://127.0.0.1:1',token:'throwaway'})
  writeFileSync(path,payload);utimesSync(path,new Date(0),new Date(0))
  const reused=join(registry,'reused.json');writeFileSync(reused,JSON.stringify({version:2,pid:process.pid}));utimesSync(reused,new Date(0),new Date(0))
  try {
    const lease=await claimHost({database,questRoot});await lease.release()
    expect(readFileSync(path,'utf8')).toBe(payload)
    writeFileSync(path,payload)
    await expect(claimHost({database,questRoot})).rejects.toThrow('invalid process identity')
  }finally {rmSync(root,{recursive:true,force:true})}
})

test('a reused process ID does not own a receipt written before that process started',async()=>{
  const root=mkdtempSync(join(tmpdir(),'oc-reused-host-')),questRoot=join(root,'quests'),registry=join(questRoot,'.opencode','.quest-runtime','quest-api')
  mkdirSync(registry,{recursive:true})
  const script=join(root,'wait.mjs');writeFileSync(script,'process.stdin.resume()')
  const prior=new Date(Date.now()-2000),child=spawn('node',[script],{windowsHide:true,stdio:['pipe','ignore','pipe']})
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)})
  const path=join(registry,'reused.json');writeFileSync(path,JSON.stringify({version:2,pid:child.pid}));utimesSync(path,prior,prior)
  try {const lease=await claimHost({database:join(root,'host.db'),questRoot});await lease.release();expect(child.exitCode).toBeNull()}
  finally {const exited=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();await exited;rmSync(root,{recursive:true,force:true})}
})
