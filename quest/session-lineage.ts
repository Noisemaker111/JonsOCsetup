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

/** A settled run reports the outcome we recorded; the owning host is not asked to confirm it again. */
export const TERMINAL_RUN: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "missing", "stale"])
export const isTerminalSession = (state: string) => TERMINAL_RUN.has(state)

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
    // A step can be recorded working without any run ever claiming it, because a giver or worker
    // update writes the status directly. Nothing owns it and nothing can: dispatch only ever selects
    // a pending step, so neither an owner nor an ending will appear, and the Quest waits forever on
    // a worker that was never started. That is not silence from an owner — there is no owner.
    if (!runs.length) return [{ stageID: step.id, status: 'pending' as const,
      evidence: 'Recorded working with no run on this Quest that ever claimed it, so nothing is executing it and nothing will end it.' }]
    const latest = runs.at(-1)
    // Every terminal state releases the step, not only the three a worker reports for itself.
    // `missing` and `stale` are what reconciliation writes when it establishes that a run is over:
    // its session is gone, its workspace was deleted, its lease expired, or its execution ended with
    // the host. Leaving those out meant each of those settles freed the run and left the step owned
    // by it anyway, so the board filled with working steps that had no run behind them at all.
    if (!latest || !TERMINAL_RUN.has(latest.state) || runs.some(run => !TERMINAL_RUN.has(run.state))) return []
    const ended = ['missing', 'stale'].includes(latest.state)
      ? `Run recorded ${latest.state}; nothing is executing it any more.`
      : `Worker ${latest.state} without saving this step as done.`
    return [{ stageID: step.id, status: 'pending' as const,
      evidence: `${ended} ${latest.result ?? latest.evidence.at(-1) ?? 'Inspect the retained run result before retrying.'}` }]
  })
}
