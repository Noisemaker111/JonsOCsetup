/**
 * @core-prevents archived worktrees remaining forever after restart when the native host has no active-session listing
 * @core-observed September 15 audit found 54 retained receipts with unconfirmed idle, including 39 clean merged archived guarded worktrees.
 */
import {test,expect} from 'bun:test'
import {confirmWorkerIdle} from '../quest/worker-inspection'
import {connectHostObservation,recordHostObservation} from '../quest/host-observation'

test('historical idle requires an acknowledged owning-host wait and never interrupts a live worker',async()=>{
 let waits=0
 const host={wait:async(input:any,options:any)=>{expect(input.sessionID).toBe('worker');expect(options.signal).toBeInstanceOf(AbortSignal);waits++}}
 expect(await confirmWorkerIdle(host,'worker')).toBe(true)
 expect(waits).toBe(1)
 expect(await confirmWorkerIdle({},'worker')).toBe(false)
 expect(await confirmWorkerIdle({wait:async()=>{throw Error('Host unavailable')}},'worker')).toBe(false)
 connectHostObservation(host)
 recordHostObservation(host,{type:'session.execution.started',data:{sessionID:'worker'}})
 expect(await confirmWorkerIdle(host,'worker')).toBe(false)
 expect(waits).toBe(1)
 expect(await confirmWorkerIdle({active:async()=>({worker:{}}),wait:host.wait},'worker')).toBe(false)
 expect(waits).toBe(1)
 const racing={wait:async()=>recordHostObservation(racing,{type:'session.execution.started',data:{sessionID:'worker'}})}
 connectHostObservation(racing)
 expect(await confirmWorkerIdle(racing,'worker')).toBe(false)
})
