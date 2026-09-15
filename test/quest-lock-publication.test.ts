// @core-prevents A crash during lock publication strands an ownerless lock and permanently blocks worker return delivery.
// @core-observed On 2026-09-15 the self-saving worker's failed notification could not retry because its lock directory had no owner.json, unchanged since 03:28:59Z.
import {expect,test} from 'bun:test'
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,utimesSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {acquireLock,LockBusyError} from '../quest/locking'

test('complete lock ownership is published atomically and a dead process is reclaimable',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-lock-owner-'))
 try{
  const held=acquireLock(root,'live')
  expect(statSync(held.path).isFile()).toBe(true)
  expect(JSON.parse(readFileSync(held.path,'utf8')).nonce).toBe(held.nonce)
  const before=readFileSync(held.path,'utf8');held.heartbeat()
  expect(readFileSync(held.path,'utf8')).toBe(before)
  expect(()=>acquireLock(root,'live',{timeoutMs:0})).toThrow(LockBusyError)
  held.release()
  const child=Bun.spawn([process.execPath,join(import.meta.dir,'fixtures/quest-lock-exit.ts'),root],{stdout:'pipe',stderr:'pipe'})
  expect(await child.exited).toBe(0)
  const path=join(root,'locks','abandoned.lock');utimesSync(path,new Date(0),new Date(0))
  const recovered=acquireLock(root,'abandoned',{timeoutMs:100,staleMs:0})
  expect(JSON.parse(readFileSync(path,'utf8')).pid).toBe(process.pid)
  recovered.release()
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('legacy live and unknown owners remain protected while proved dead owners recover',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-legacy-owner-')),path=join(root,'locks','legacy.lock')
 try{
  mkdirSync(path,{recursive:true})
  expect(()=>acquireLock(root,'legacy',{timeoutMs:0,staleMs:0})).toThrow(LockBusyError)
  expect(statSync(path).isDirectory()).toBe(true)
  writeFileSync(join(path,'owner.json'),JSON.stringify({pid:process.pid,processStart:'legacy',nonce:'legacy',heartbeat:1}))
  expect(()=>acquireLock(root,'legacy',{timeoutMs:0,staleMs:0,isAlive:()=>true})).toThrow(LockBusyError)
  const recovered=acquireLock(root,'legacy',{timeoutMs:100,staleMs:0,isAlive:()=>false})
  expect(statSync(recovered.path).isFile()).toBe(true)
  recovered.release()
 }finally{rmSync(root,{recursive:true,force:true})}
})
