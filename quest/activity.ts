import { boundedInspection } from './worker-observation.mjs'
import { latestSessionAttempts, TERMINAL_RUN } from './session-lineage'
import { hostExecution } from './host-observation'
import type { Quest, QuestSession } from './types'

export const ownedRuns = (q: Quest) => latestSessionAttempts(q.sessions).filter(run => ['planned', 'executing', 'waiting', 'blocked'].includes(run.state))

/**
 * What every surface shows for one run.
 *
 * useWorkerObservations polls the host only for ownedRuns, so a settled run has no
 * observation entry and every reader that asked it directly sat on "Checking owning
 * host…" for a worker that finished. The settled run reports the outcome we recorded;
 * only a live run is worth inspecting. The worker picker already did this, and the
 * board detail's agent log did not.
 */
export const observedRun = (run: QuestSession, observation: (run: QuestSession) => any) =>
 run.state && TERMINAL_RUN.has(run.state) ? { state: run.state, reason: run.result ?? 'Recorded outcome' } : observation(run)
type ActivitySnapshot = { active?: Record<string, unknown>; checkedAt: string; reason?: string }
const nativeID = (run: QuestSession) => {
 const id = run.openCodeSessionId ?? run.openCodeSessionID ?? run.sessionID
 return id?.startsWith('ses_') && !run.harness && run.runtime !== 'claude-code' ? id : undefined
}

/** One bounded host read per public operation; saved assignments never prove activity. */
export async function readQuestActivity(host: any, quests: Quest[]): Promise<ActivitySnapshot> {
 const checkedAt = new Date().toISOString()
 if (!quests.some(q => ownedRuns(q).some(nativeID))) return { checkedAt }
 if (typeof host.active !== 'function') {
  const active: Record<string, unknown> = {}
  for (const q of quests) for (const run of ownedRuns(q)) {
   const id = nativeID(run)
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

export function questActivity(q: Quest, snapshot: ActivitySnapshot) {
 const owners = ownedRuns(q)
 const running = owners.filter(run => { const id = nativeID(run); return id && snapshot.active && Object.hasOwn(snapshot.active, id) }).length
 return { running, unconfirmed: owners.length - running, assigned: owners.length, checkedAt: snapshot.checkedAt,
  ...(owners.length > running ? { reason: snapshot.reason ?? 'These assignments have no confirmed active execution; inspect before retrying' } : {}) }
}

export function withQuestActivity(q: Quest, result: any, snapshot: ActivitySnapshot) {
 const activity = questActivity(q, snapshot)
 const state = q.state === 'Working' && !activity.running
  ? q.stages.some(step => step.status === 'blocked') ? 'Needs attention' : 'Waiting'
  : q.state
 return { ...result, state, lane: state === 'Needs attention' ? 'attention' : result.lane,
  recordedState: q.state, recordedExecuting: q.executingCount, running: activity.running, activity }
}
