import { latestSessionAttempts, TERMINAL_RUN } from "./session-lineage"
import { observedRun } from "./activity"
import { questLane } from "./board"
import type { Quest, QuestSession } from "./types"

/**
 * One reachability vocabulary for every Quest surface.
 *
 * The saved record, the read normalization and the live host observation are three separate layers
 * (docs/quest-surface-authority.md). Each surface used to compose them itself, so one Quest could
 * read RUNNING on the board, green in the sidebar and UNKNOWN in the composer footer in the same
 * second. Every surface now asks this module, which keeps the distinctions the Quest requires:
 * saved workflow state vs host-confirmed execution, stalled work vs terminal, session existence vs
 * live execution, and recorded permission decisions vs pending requests.
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
    decisions: run.permissionDecisions ?? [],
    lastActivityAt: typeof live.lastActivityAt === "string" ? live.lastActivityAt : undefined,
  }
}

export type QuestLifecycle = { label: string; short: string; tone: ReachabilityTone; rank: number }

/**
 * The saved workflow state as a lane, with no live claim. This is the fallback for a Quest with no
 * owned run; a Quest with one always reports that run instead.
 */
export function questLifecycle(q: Quest): QuestLifecycle {
  const lane = questLane(q)
  if (lane === "archived") return { label: "Archived", short: "ARCHIVED", tone: "idle", rank: 5 }
  if (lane === "attention") return { label: "Needs attention", short: "ATTENTION", tone: "failed", rank: 0 }
  if (lane === "ready") return { label: "Ready for review", short: "REVIEW", tone: "done", rank: 1 }
  if (lane === "verifying") return { label: "Verifying", short: "VERIFYING", tone: "blocked", rank: 2 }
  if (q.stages.some(s => s.status === "working") || q.executingCount > 0) return { label: "Work recorded", short: "RECORDED", tone: "uncertain", rank: 3 }
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

const OWNED = new Set(["planned", "executing", "waiting", "blocked"])

/**
 * The one read every Quest surface draws: the newest owned attempt's reachability, else the saved
 * lifecycle. Ordered so a settled run's recorded outcome is never mistaken for live work, and a
 * stalled run is never painted with its saved lifecycle colour.
 */
export function questReachability(q: Quest, observation: ObservationOf): QuestReachability {
  const lifecycle = questLifecycle(q)
  const attempt = latestSessionAttempts(q.sessions).at(-1)
  if (!attempt || !OWNED.has(attempt.state)) return {
    lifecycle, state: "idle", label: lifecycle.label, tone: lifecycle.tone,
    confirmed: false, over: false, terminal: false, reason: q.reason, pendingPermissions: 0, decisions: [],
  }
  const run = runReachability(attempt, observation)
  return {
    lifecycle, run, state: run.state, label: run.label, tone: run.tone,
    confirmed: run.confirmed, over: run.over, terminal: run.terminal, reason: run.reason,
    pendingPermissions: run.pendingPermissions, decisions: run.decisions,
  }
}
