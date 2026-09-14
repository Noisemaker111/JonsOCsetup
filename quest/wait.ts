/**
 * Wait for a worker instead of asking about it again.
 *
 * A giver's `quest get` is not a cheap tool call: it is a whole turn. Measured over the session
 * database, `quest` was 69% of all inner Code Mode calls (1,579 of 2,286) and `get` alone was 420
 * calls against 216 distinct (session, quest) pairs -- one `execute` issued 24 of them. Every
 * redundant one pays request setup, time-to-first-token, thinking and tool preparation again to
 * learn that nothing has changed yet.
 *
 * There is already a return path: QuestWorkerReturns prompts the originating giver with an
 * bounded "Automatic Quest worker update" the moment a run reaches a terminal state, so the cheapest wait
 * is no turn at all -- the giver stops and is woken. This module is what makes the tool layer
 * enforce that rather than ask for it: it fingerprints exactly what a `get` would tell the caller,
 * so a repeat of the same request against the same state is recognisable, and it blocks on the
 * saved state changing instead of returning the same bytes.
 */
import type { Quest, QuestSession } from "./types"

/** A run that can still change on its own. Everything else is already settled. */
export const ACTIVE_RUN_STATES = ["planned", "executing", "waiting", "blocked"] as const
export const TERMINAL_RUN_STATES = ["completed", "failed", "cancelled"] as const

export const DEFAULT_WAIT_SECONDS = 120
export const MAX_WAIT_SECONDS = 600
/** Saved state is re-read this often; changes are written by the tracker, continuation and workers. */
const READ_INTERVAL_MS = 1000
/** Host observation is a round trip per active run, so it runs on its own slower cadence. */
const RECONCILE_INTERVAL_MS = 5000

const runKey = (run: QuestSession) => run.runID ?? run.callID
const isRun = (run: QuestSession, runID?: string) => !runID || run.runID === runID || run.callID === runID

export function activeRuns(quest: Quest, runID?: string): QuestSession[] {
  return quest.sessions.filter((run) => isRun(run, runID) && (ACTIVE_RUN_STATES as readonly string[]).includes(run.state))
}

/**
 * Everything a `get` would report, as one comparable value.
 *
 * Unscoped this includes the Quest revision, so any saved event at all counts as a change and the
 * caller is never held back from something it has not seen. Scoped to one run it deliberately does
 * not: a giver that asked to wait for run X should not be woken by an unrelated Quest edit.
 */
export function observedState(quest: Quest, runID?: string): string {
  const runs = quest.sessions.filter((run) => isRun(run, runID))
  const stages = runID
    ? quest.stages.filter((stage) => runs.some((run) => run.deliverables.includes(stage.id)))
    : quest.stages
  return JSON.stringify([
    runID ? null : [quest.state, quest.revision],
    runs.map((run) => [runKey(run), run.state, run.result ?? "", run.updatedAt]),
    stages.map((stage) => [stage.id, stage.status, stage.note ?? ""]),
  ])
}

/** A run line the giver can act on without another call. */
export const runSummary = (run: QuestSession) => ({
  runID: runKey(run),
  workerSessionID: run.openCodeSessionId ?? run.sessionID,
  state: run.state,
  steps: run.deliverables,
  result: run.result?.slice(0, 400),
})

const RETURN_PATH =
  "When a run reaches completed, failed or cancelled this session is woken automatically with an " +
  '"Automatic Quest worker update" carrying the Quest state, finished step, one-line outcome and a pointer to its complete saved notes.'

/** What the caller should do instead of asking again. Named actions, not encouragement. */
export function waitSteering(quest: Quest, runID: string | undefined, waitedMs: number): string {
  const running = activeRuns(quest, runID)
  return (
    `No saved change in ${Math.round(waitedMs / 1000)}s. Still active: ` +
    (running.map((run) => `${runKey(run)} ${run.state}`).join(", ") || "none") +
    `. ${RETURN_PATH} End this turn rather than calling get again, or call quest action=wait with wait.runID to block on one run.`
  )
}

/** Held, not unref'd: an unref'd timer is not guaranteed to fire, and this one is what ends the wait. */
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

export type WaitOutcome = { changed: boolean; quest?: Quest; milliseconds: number }

/**
 * Block until the saved Quest stops matching `fingerprint`, or the deadline passes.
 *
 * A worker that dies stops writing, so silence can never be read as progress: the wait is bounded,
 * host observation is reconciled while it runs so a settled outcome is noticed, and a wait that
 * ends on its deadline returns the unchanged state with steering rather than a failure.
 */
export async function awaitQuestChange(options: {
  read: () => Quest | undefined
  fingerprint: string
  runID?: string
  deadline: number
  reconcile?: () => Promise<unknown>
  onWaiting?: (waitedMs: number) => void
}): Promise<WaitOutcome> {
  const started = Date.now()
  let reconciledAt = 0
  for (;;) {
    const now = Date.now()
    if (now >= options.deadline) return { changed: false, quest: options.read(), milliseconds: now - started }
    if (options.reconcile && now - reconciledAt >= RECONCILE_INTERVAL_MS) {
      reconciledAt = now
      try { await options.reconcile() } catch { /* observation failure is not a state change */ }
    }
    const quest = options.read()
    // A Quest that is gone is a change the caller must see, not something to keep waiting on.
    if (!quest || observedState(quest, options.runID) !== options.fingerprint) {
      return { changed: true, quest, milliseconds: Date.now() - started }
    }
    options.onWaiting?.(Date.now() - started)
    await sleep(Math.min(READ_INTERVAL_MS, Math.max(0, options.deadline - Date.now())))
  }
}
