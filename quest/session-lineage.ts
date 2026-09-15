import type { QuestSession } from "./types"

/** Matches the harness's quota/model-failover terminal ("Usage reached — X. Falling over to Y ... paused until the window resets"). This is infrastructure noise, not a verdict that the work failed. */
export const QUOTA_FAILOVER_PATTERN = /usage reached[\s\S]{0,400}?(falling over|no healthy failover|paused until the window resets)/i

/**
 * A session's `quotaExhausted` flag is only set by the reducer when a
 * "failed" session-state event is applied AND matches the pattern at that
 * moment. Sessions that failed before that reducer logic existed carry no
 * flag and never will, since already-applied events are never replayed. Re-
 * derive it lazily from the session's stored evidence/result so those
 * pre-existing failures stop permanently blocking the Quest.
 */
export function isSessionQuotaExhausted(session: QuestSession): boolean {
  if (session.quotaExhausted) return true
  if (session.state !== "failed") return false
  return QUOTA_FAILOVER_PATTERN.test(`${session.evidence?.join(" ") ?? ""} ${session.result ?? ""}`)
}

/** Historical attempts stay visible, but only the newest attempt in a resume lineage is live work. */
export function latestSessionAttempts(sessions: QuestSession[]): QuestSession[] {
  const latest = new Map<string, QuestSession>()
  for (const session of sessions) {
    const root = session.resumeRoot ?? session.resumedFrom ?? session.callID
    const prior = latest.get(root)
    if (!prior || session.attempt > prior.attempt || (session.attempt === prior.attempt && session.updatedAt > prior.updatedAt)) latest.set(root, session)
  }
  return [...latest.values()]
}

/** Only an evidenced terminal owner can release a working step; silence cannot. */
export function terminalStepUpdates(q: import('./types').Quest) {
  return q.stages.flatMap(step => {
    if (step.status !== 'working') return []
    const runs = q.sessions.filter(run => run.deliverables.includes(step.id))
    const latest = runs.at(-1)
    if (!latest || !['completed', 'failed', 'cancelled'].includes(latest.state)
      || runs.some(run => ['planned', 'executing', 'waiting', 'blocked'].includes(run.state))) return []
    return [{ stageID: step.id, status: 'pending' as const,
      evidence: `Worker ${latest.state} without saving this step as done. ${latest.result ?? latest.evidence.at(-1) ?? 'Inspect the retained run result before retrying.'}` }]
  })
}
