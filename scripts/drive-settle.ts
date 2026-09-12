/** When a driven host counts as finished, so a caller never polls the drive to find out. */

export type SettleRequest={quiet_ms?:unknown,timeout_ms?:unknown}
export type SettleBounds={quiet:number,limit:number}
export type SettleResult={settled:boolean,idle_ms:number}

export const SETTLE_QUIET_MS=2500
export const SETTLE_TIMEOUT_MS=180000

/**
 * The runtime reports launch, restart and exit; it never says "that turn is finished". A person reads
 * the host going quiet instead, so a drive reads the same thing. The floor keeps a caller from asking
 * for the per-second poll this action exists to replace: the whole point is that the waiting happens
 * inside the drive, where it is free, rather than across tool calls, where every second costs a model
 * turn and a full conversation replayed to the approvals reviewer.
 */
export function settleBounds(request:SettleRequest):SettleBounds{
 const quiet=request.quiet_ms??SETTLE_QUIET_MS,limit=request.timeout_ms??SETTLE_TIMEOUT_MS
 if(!Number.isInteger(quiet)||(quiet as number)<250||(quiet as number)>60000)throw Error('settle quiet_ms is 250 to 60000')
 if(!Number.isInteger(limit)||(limit as number)<(quiet as number)||(limit as number)>1800000)throw Error('settle timeout_ms is quiet_ms to 1800000')
 return {quiet:quiet as number,limit:limit as number}
}

/**
 * Undefined means keep waiting. A timeout resolves rather than throws: the capture that follows is the
 * evidence of what the host was still doing, and throwing would abandon the rest of the queue --
 * including the stop that ends the driven session -- over the one case where you most want the frame.
 */
export function settleOutcome(bounds:SettleBounds,lastOutput:number,now:number,deadline:number):SettleResult|undefined{
 const idle=now-lastOutput
 if(idle>=bounds.quiet||now>=deadline)return {settled:idle>=bounds.quiet,idle_ms:idle}
 return undefined
}
