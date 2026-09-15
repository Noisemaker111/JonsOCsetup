/**
 * @core-prevents concurrent protected worker tools failing admission or executing after their waiting turn was cancelled
 * @core-observed On 2026-09-13 the live accounts worker issued two shell calls together; the second failed with lock timeout: workspace while the first was still running.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {acquireLock,acquireLockAsync,LockBusyError} from '../quest/locking'
import {connectHostObservation,disconnectHostObservation,recordHostObservation,workspaceWaitSignal} from '../quest/host-observation'

test('workspace waits yield, retain exclusion, isolate sessions and stop on cancellation or disconnect',async()=>{
 const root=mkdtempSync(join(tmpdir(),'workspace-wait-')),host={}
 connectHostObservation(host)
 try{
  const first=acquireLock(root,'workspace-one'),wait=workspaceWaitSignal(host,'worker-one')
  const pending=acquireLockAsync(root,'workspace-one',wait.signal)
  expect(()=>acquireLock(root,'workspace-one',{timeoutMs:0})).toThrow(LockBusyError)
  const other=acquireLock(root,'workspace-two');other.release()
  const timer=setTimeout(()=>first.release(),20)
  const second=await pending;clearTimeout(timer);wait.dispose();second.release()
  const holder=acquireLock(root,'workspace-one'),cancelled=workspaceWaitSignal(host,'worker-one'),unrelated=workspaceWaitSignal(host,'worker-two')
  const blocked=acquireLockAsync(root,'workspace-one',cancelled.signal).then(()=>null,error=>error)
  recordHostObservation(host,{type:'session.execution.interrupted',data:{sessionID:'worker-one'}})
  expect(await blocked).toBeInstanceOf(Error);expect(unrelated.signal.aborted).toBe(false)
  cancelled.dispose();holder.release()
  disconnectHostObservation(host);expect(unrelated.signal.aborted).toBe(true);unrelated.dispose()
  expect(()=>workspaceWaitSignal(host,'worker-one')).toThrow('connected host')
  const after=acquireLock(root,'workspace-one');after.release()
 }finally{disconnectHostObservation(host);rmSync(root,{recursive:true,force:true})}
})
