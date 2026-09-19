import { TERMINAL_RUN, ownedRuns, observedRun } from "./session-lineage"
import { questLane, type QuestLane } from "./board"
import type { Quest, QuestSession, QuestState } from "./types"

/**
 * One reachability vocabulary, and one derived state, for every Quest surface.
 *
 * The saved record, the read normalization and the live host observation are three separate layers
 * (docs/quest-surface-authority.md). Each surface used to compose them itself, so one Quest could
 * read RUNNING on the board, green in the sidebar and UNKNOWN in the composer footer in the same
 * second, and `quests.get` could answer Waiting for the Quest the board called RUNNING. Every
 * surface now asks this module, which keeps the distinctions the Quest requires: saved workflow
 * state vs host-confirmed execution, stalled work vs terminal, session existence vs live
 * execution, and recorded permission decisions vs pending requests.
 */
export type ReachabilityTone = "live" | "blocked" | "uncertain" | "failed" | "done" | "idle"
export type ObservationOf = (run: QuestSession) => any

type Spec = { label: string; tone: ReachabilityTone; over?: boolean }
/**
 * Every state an owning host can answer with, in one table. `over` marks an answer that means the
 * run will not produce more work even though the reducer may not have settled its saved row yet.
 */
const SPEC: Record<string, Spec> = {
  running: { label: "RUNNING", tone: "live" },
  blocked: { label: "BLOCKED", tone: "blocked" },
  completed: { label: "WORKER DONE", tone: "done", over: true },
  failed: { label: "FAILED", tone: "failed", over: true },
  cancelled: { label: "CANCELLED", tone: "failed", over: true },
  missing: { label: "MISSING", tone: "failed", over: true },
  stale: { label: "STALE", tone: "failed", over: true },
  interrupted: { label: "INTERRUPTED", tone: "failed", over: true },
  unreachable: { label: "UNREACHABLE", tone: "uncertain" },
  unknown: { label: "UNKNOWN", tone: "uncertain" },
  external: { label: "EXTERNAL", tone: "idle" },
  queued: { label: "QUEUED", tone: "idle" },
  launching: { label: "LAUNCHING", tone: "idle" },
}

export type RunReachability = {
  run: QuestSession
  /** The observation state, normalized to the SPEC vocabulary. */
  state: string
  /** The surface word for a list row. */
  label: string
  tone: ReachabilityTone
  /** The owning host confirmed a live execution right now. */
  confirmed: boolean
  /** The run will not produce more work: saved terminal, or the host answered with one. */
  over: boolean
  /** The saved row is terminal; ownership and step release read this, never the observation. */
  terminal: boolean
  reason: string
  /** Pending requests the owning host answered with. Location-scoped; zero is not proof of none. */
  pendingPermissions: number
  /** What each pending request actually asks for, so a surface can say it instead of "a decision". */
  pending: Array<{ id?: string; action: string; resources: string[] }>
  /** Decisions already recorded on the run. */
  decisions: NonNullable<QuestSession["permissionDecisions"]>
  lastActivityAt?: string
}

/** What every surface shows for one run, from the saved row plus the owning host's answer. */
export function runReachability(run: QuestSession, observation: ObservationOf): RunReachability {
  const live = observedRun(run, observation) ?? {}
  const state = typeof live.state === "string" ? live.state : "unknown"
  const spec = SPEC[state] ?? SPEC.unknown
  return {
    run, state, label: spec.label, tone: spec.tone,
    confirmed: state === "running",
    over: spec.over === true || TERMINAL_RUN.has(run.state),
    terminal: TERMINAL_RUN.has(run.state),
    reason: typeof live.reason === "string" ? live.reason : "",
    pendingPermissions: Array.isArray(live.permissions) ? live.permissions.length : 0,
    pending: (Array.isArray(live.permissions) ? live.permissions : []).map((request: any) => ({
      ...(request?.id ? { id: String(request.id) } : {}),
      action: String(request?.action ?? "permission"),
      resources: Array.isArray(request?.resources) ? request.resources.map(String) : [],
    })),
    decisions: run.permissionDecisions ?? [],
    lastActivityAt: typeof live.lastActivityAt === "string" ? live.lastActivityAt : undefined,
  }
}

export type QuestLifecycle = { label: string; short: string; tone: ReachabilityTone; rank: number }

/**
 * The saved workflow state as a lane, with no live claim. This is the fallback for a Quest with no
 * owned run; a Quest with one always reports that run instead.
 */
export function questLifecycle(q: Quest, state: QuestState = q.state): QuestLifecycle {
  const lane = questLane(q, state)
  if (lane === "archived") return { label: "Archived", short: "ARCHIVED", tone: "idle", rank: 5 }
  if (lane === "attention") return { label: "Needs attention", short: "ATTENTION", tone: "failed", rank: 0 }
  if (lane === "ready") return { label: "Ready for review", short: "REVIEW", tone: "done", rank: 1 }
  if (lane === "verifying") return { label: "Verifying", short: "VERIFYING", tone: "blocked", rank: 2 }
  if ((q.stages ?? []).some(s => s.status === "working") || (q.executingCount ?? 0) > 0) return { label: "Work recorded", short: "RECORDED", tone: "uncertain", rank: 3 }
  return { label: "Planned", short: "PLANNED", tone: "idle", rank: 4 }
}

export type QuestReachability = {
  lifecycle: QuestLifecycle
  /** The newest saved owned attempt, when there is one. */
  run?: RunReachability
  /** Run state when owned, otherwise "idle". */
  state: string
  /** Run label when owned, otherwise the lifecycle label. */
  label: string
  tone: ReachabilityTone
  confirmed: boolean
  over: boolean
  terminal: boolean
  reason: string
  pendingPermissions: number
  decisions: NonNullable<QuestSession["permissionDecisions"]>
}

/**
 * The owned attempt a Quest is represented by: a host-confirmed one when there is one, otherwise
 * the one most recently touched. Taking the last element of the array instead meant a Quest with a
 * confirmed worker could be represented by a stale `planned` sibling and read as idle everywhere.
 */
function representativeRun(runs: RunReachability[]): RunReachability | undefined {
  return runs.find(run => run.confirmed)
    ?? runs.find(run => run.pendingPermissions > 0)
    ?? [...runs].sort((a, b) => a.run.updatedAt.localeCompare(b.run.updatedAt)).at(-1)
}

/**
 * The one read every Quest surface draws: the representative owned attempt's reachability, else the
 * saved lifecycle. Ordered so a settled run's recorded outcome is never mistaken for live work, and
 * a stalled run is never painted with its saved lifecycle colour.
 */
export function questReachability(q: Quest, observation: ObservationOf, state: QuestState = q.state, owned?: RunReachability[]): QuestReachability {
  const lifecycle = questLifecycle(q, state)
  const run = representativeRun(owned ?? ownedRuns(q).map(row => runReachability(row, observation)))
  if (!run) return {
    lifecycle, state: "idle", label: lifecycle.label, tone: lifecycle.tone,
    confirmed: false, over: false, terminal: false, reason: q.reason, pendingPermissions: 0, decisions: [],
  }
  return {
    lifecycle, run, state: run.state, label: run.label, tone: run.tone,
    confirmed: run.confirmed, over: run.over, terminal: run.terminal, reason: run.reason,
    pendingPermissions: run.pendingPermissions, decisions: run.decisions,
  }
}

/** The four groups Jon reads a Quest list in. Every Quest lands in exactly one. */
export const REPORT_GROUPS = ["you", "working", "queued", "done"] as const
export type ReportGroup = typeof REPORT_GROUPS[number]

export type QuestTruth = {
  quest: Quest
  /** The one state every surface shows for this Quest. */
  state: QuestState
  /** What the ledger recorded before the owning host was asked. */
  recordedState: QuestState
  recordedExecuting: number
  /** The owning host confirms an active execution for one of this Quest's owned attempts. */
  confirmed: boolean
  /** Why the shown state is what it is; the downgrade reason when the two differ. */
  reason: string
  lane: QuestLane
  group: ReportGroup
  /** Every owned attempt, with the owning host's answer for each. */
  runs: RunReachability[]
  /** The attempt the surfaces represent this Quest by. */
  run?: RunReachability
  reach: QuestReachability
  pendingPermissions: number
}

/** The one sentence for a recorded execution the owning host will not confirm. */
const UNCONFIRMED_REASON = "Recorded as executing, but the owning host does not confirm an execution for it"

/**
 * The single derivation of a Quest's state. `list`, `get`, `status`, `plan`, the board, the footer,
 * the sidebar and the giver's report all read this, so no two of them can disagree about one Quest.
 *
 * "Working" means the owning host confirms an active execution for an attempt this Quest still
 * owns. `executing` is written by prompt-admission bookkeeping when the prompt is sent, never by
 * host confirmation, so a recorded-executing run nothing is running reads as Waiting -- or Needs
 * attention when a step is already blocked -- on every surface, carrying the reason.
 */
export function questTruth(q: Quest, observation: ObservationOf): QuestTruth {
  const runs = ownedRuns(q).map(run => runReachability(run, observation))
  const confirmed = runs.some(run => run.confirmed)
  const pendingPermissions = runs.reduce((total, run) => total + run.pendingPermissions, 0)
  const recordedState = q.state
  let state = recordedState
  let reason = q.reason
  if (recordedState === "Working" && !confirmed) {
    state = (q.stages ?? []).some(step => step.status === "blocked") ? "Needs attention" : "Waiting"
    const observed = runs.find(run => run.reason)?.reason
    reason = observed && observed !== UNCONFIRMED_REASON ? observed : UNCONFIRMED_REASON
  }
  const reach = questReachability(q, observation, state, runs)
  return {
    quest: q, state, recordedState, recordedExecuting: q.executingCount ?? 0, confirmed, reason,
    lane: questLane(q, state), group: questGroup(state, pendingPermissions), runs,
    run: reach.run, reach, pendingPermissions,
  }
}

/**
 * Which of Jon's four groups a Quest belongs to. A pending permission is his decision whatever the
 * ledger says about the rest of the Quest, which is the case the giver kept reporting as Working.
 */
export function questGroup(state: QuestState, pendingPermissions = 0): ReportGroup {
  if (state === "Archived" || state === "Complete" || state === "Ready to complete") return "done"
  if (pendingPermissions > 0 || state === "Needs attention") return "you"
  if (state === "Working") return "working"
  return "queued"
}

export type QuestCounts = Record<ReportGroup, number> & { open: number; total: number }

/**
 * The counts every surface shows. The CLI `list` result, the composer footer's "N open" and the
 * board's filter counts call this on the same records with the same observation, so the three
 * numbers cannot drift apart the way 110 records answered 15 Working to one reader and 0 running
 * to the next.
 */
export function questCounts(truths: QuestTruth[]): QuestCounts {
  const counts = { you: 0, working: 0, queued: 0, done: 0, open: 0, total: truths.length }
  for (const truth of truths) {
    counts[truth.group]++
    if (truth.state !== "Archived") counts.open++
  }
  return counts
}
