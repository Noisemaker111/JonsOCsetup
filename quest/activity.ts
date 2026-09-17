import { boundedInspection } from './worker-observation.mjs'
import { ownedRuns, nativeRunID, observedRun } from './session-lineage'
import { hostExecution } from './host-observation'
import { questTruth, type ObservationOf } from './reachability'
import type { Quest, QuestSession } from './types'

export { ownedRuns, observedRun }

export type ActivitySnapshot = { active?: Record<string, unknown>; checkedAt: string; reason?: string }
/** The one sentence every surface uses for a run the owning host will not confirm. */
export const UNCONFIRMED = 'Recorded as executing, but the owning host does not confirm an execution for it'

/** One bounded host read per public operation; saved assignments never prove activity. */
export async function readQuestActivity(host: any, quests: Quest[]): Promise<ActivitySnapshot> {
 const checkedAt = new Date().toISOString()
 if (!quests.some(q => ownedRuns(q).some(nativeRunID))) return { checkedAt }
 if (typeof host.active !== 'function') {
  const active: Record<string, unknown> = {}
  for (const q of quests) for (const run of ownedRuns(q)) {
   const id = nativeRunID(run)
   if (id && hostExecution(host, id) === true) active[id] = true
  }
  return { active, checkedAt, reason: 'Connected host events do not confirm execution for these assignments; ownership retained' }
 }
 try {
  const response = await boundedInspection(signal => host.active({ signal }))
  const active = response?.data ?? response
  if (!active || typeof active !== 'object' || Array.isArray(active)) throw Error('Invalid active execution response')
  return { active, checkedAt: new Date().toISOString() }
 } catch {
  return { checkedAt: new Date().toISOString(), reason: 'Host activity could not be confirmed; ownership retained' }
 }
}

/**
 * The tool and CLI answer to the same question the TUI asks its polling hook: "is this run live?".
 *
 * Before this the two paths reached different conclusions from the same host. `withQuestActivity`
 * rewrote a Quest's state from an activity map on some read paths, the TUI drew `observeWorker`
 * results, and the board mapped the saved ledger state straight to RUNNING, so one Quest read
 * Working in `quests.get`, RUNNING on the board and UNKNOWN in the footer in the same second. An
 * activity snapshot now becomes an ordinary observation, and every surface derives its state from
 * it through the one function in `reachability.ts`.
 */
export function observationFromActivity(snapshot: ActivitySnapshot): ObservationOf {
 return (run: QuestSession) => {
  const id = nativeRunID(run)
  if (id && snapshot.active && Object.hasOwn(snapshot.active, id)) return { state: 'running', checkedAt: snapshot.checkedAt }
  return { state: 'unknown', reason: snapshot.reason ?? UNCONFIRMED, checkedAt: snapshot.checkedAt }
 }
}

/** Counts of the owned runs behind one Quest, with the host's answer for each. */
export function questActivity(q: Quest, snapshot: ActivitySnapshot) {
 const truth = questTruth(q, observationFromActivity(snapshot))
 const assigned = truth.runs.length, running = truth.runs.filter(run => run.confirmed).length
 return { running, unconfirmed: assigned - running, assigned, checkedAt: snapshot.checkedAt,
  ...(assigned > running ? { reason: snapshot.reason ?? UNCONFIRMED } : {}) }
}

/** The projection every tool read returns: the one derived state, plus what the ledger recorded. */
export function withQuestActivity(q: Quest, result: any, snapshot: ActivitySnapshot) {
 const truth = questTruth(q, observationFromActivity(snapshot))
 return { ...result, state: truth.state, lane: truth.lane, reason: truth.reason, group: truth.group,
  recordedState: truth.recordedState, recordedExecuting: truth.recordedExecuting,
  running: truth.runs.filter(run => run.confirmed).length, activity: questActivity(q, snapshot) }
}
