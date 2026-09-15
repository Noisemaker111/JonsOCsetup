/**
 * Where one session's wall clock went, read from the host database the running host writes.
 *
 * `/context-graph` answers "where did the tokens go". This answers the same question about time,
 * from the same place, with the same rule: measure what is recorded, never estimate what can be
 * measured, and never quietly distribute what is missing.
 *
 * Facts about the recorded timestamps, confirmed against the host that wrote them
 * (`upstream/packages/core/src/session/message-updater.ts`) and against the production ledger:
 *
 *  - An assistant message carries `time.created` / `time.streamed` / `time.completed`. A new step
 *    inside the same message RESETS `streamed` and `completed`, so for a multi-step turn only
 *    `created` and the final `completed` are trustworthy. The envelope is therefore
 *    `[created, completed]` and nothing finer is inferred from `streamed`.
 *  - A `tool` part carries its own `time` at the PART level — `part.time`, not `part.state.time`,
 *    which is undefined. It is `{ created, ran, completed }`: `created` when the model started
 *    streaming the call's arguments, `ran` when the host actually dispatched it (after argument
 *    streaming, permission and queueing), `completed` when the result came back. The host's own
 *    stats use `completed - coalesce(ran, created)` as a call's duration, and so does this module.
 *  - A `reasoning` part carries `time.{created,completed}`, so thinking is separable from the rest
 *    of the model's response. A `text` part carries no time at all, which is why assistant text is
 *    never its own segment: it is inside the envelope residue labelled "model response".
 *
 * The wall clock is partitioned, not summed: every millisecond of the session window lands in
 * exactly one segment. Overlapping claims are resolved by priority (a running tool outranks the
 * envelope it sits inside), and parallel tool calls split the milliseconds they genuinely share,
 * with the double-counted remainder reported separately as `concurrentToolMs` rather than hidden.
 *
 * `scripts/duration-audit.ts` and the `/duration-graph` TUI screen both read through this module so
 * the screen can never drift from the CLI it was verified against.
 */
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { hostDatabaseFile, type MessageRow } from "../context-graph/context-graph"

export { hostDatabaseFile }

export type DurationKind = "tool" | "dispatch" | "reasoning" | "model" | "waiting" | "gap"

export type DurationSegment = {
  label: string
  kind: DurationKind
  ms: number
  /** Fraction of the whole session window, so every segment's share sums to 1. */
  share: number
  /** Fraction of the working time (the window minus time spent waiting on the user). */
  activeShare: number
  /** Tool calls behind a tool segment; undefined for everything else. */
  calls?: number
}

export type DurationTurn = {
  seq: number
  startedAt: number
  ms: number
  toolMs: number
  modelMs: number
  tools: number
}

export type SessionDuration = {
  sessionID: string
  agent?: string
  title: string
  startedAt: number
  endedAt: number
  /** endedAt - startedAt. Every segment's ms sums to exactly this. */
  durationMs: number
  /** durationMs minus the time the session sat waiting for the next prompt. */
  activeMs: number
  waitingMs: number
  segments: DurationSegment[]
  /** Recorded time that no span covers, inside the working window: the red gaps. */
  gapMs: number
  gapCount: number
  medianGapMs: number
  longestGapMs: number
  toolCalls: number
  /**
   * Tool time double-counted by parallel calls: sum of every call's own duration minus the wall
   * time the session actually spent inside tools. Reported, never folded into a segment.
   */
  concurrentToolMs: number
  turns: DurationTurn[]
}

/** A running tool outranks the turn envelope it sits inside; the envelope is the residue. */
const PRIORITY: Record<DurationKind, number> = { tool: 4, dispatch: 3, reasoning: 2, model: 1, waiting: 0, gap: 0 }

export const MODEL_LABEL = "model response"
export const DISPATCH_LABEL = "tool call args + dispatch"
export const REASONING_LABEL = "assistant reasoning"
export const WAITING_LABEL = "waiting for you"
export const INJECTED_LABEL = "idle before injected input"
/**
 * The host creates the assistant message lazily, on the provider's FIRST output event
 * (`publish-llm-event.ts` -> `startAssistant`). So the stretch between an input arriving and the
 * turn appearing is request assembly plus time-to-first-token, and nothing records it. It is named
 * for what it is rather than folded into the model's time, which would make the model look slower
 * than the provider measured it.
 */
export const GAP_LABEL = "unrecorded · request setup + first token"
export const toolLabel = (name: string) => "tool: " + name

type Claim = { start: number; end: number; kind: DurationKind; label: string }
/**
 * Anything that is not an assistant message is an input the session sat waiting for. `user` is the
 * human typing; `synthetic`, `system`, `compaction`, `agent-switched` and friends are inputs the
 * host or a returning worker injected. Both are idle time, and both end an idle stretch, so the
 * host taking its own time after the input arrives is never excused as the human being slow.
 */
type Mark = { at: number; label: string }

export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "0s"
  if (ms < 1000) return Math.round(ms) + "ms"
  const seconds = ms / 1000
  if (seconds < 60) return seconds.toFixed(seconds < 10 ? 1 : 0) + "s"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes + "m " + Math.round(seconds - minutes * 60) + "s"
  const hours = Math.floor(minutes / 60)
  return hours + "h " + (minutes - hours * 60) + "m"
}

/**
 * Lay claims over `[start, end)` so that every millisecond lands in exactly one bucket.
 *
 * Uncovered time is not one thing. A stretch that ends at a user prompt is the session waiting on
 * the human; a stretch that begins at a user prompt and ends when the assistant starts is the host
 * taking time nobody recorded. `userMarks` splits those apart so the second is never excused as
 * the first.
 */
function partition(claims: Claim[], start: number, end: number, inputMarks: Mark[]): { totals: Map<string, { kind: DurationKind; ms: number }>; gaps: number[] } {
  const totals = new Map<string, { kind: DurationKind; ms: number }>()
  const gaps: number[] = []
  if (!(end > start)) return { totals, gaps }
  const inside = claims
    .map(claim => ({ ...claim, start: Math.max(start, claim.start), end: Math.min(end, claim.end) }))
    .filter(claim => claim.end > claim.start)
  const marks = new Map<number, string>()
  for (const mark of inputMarks) if (mark.at > start && mark.at < end) marks.set(mark.at, mark.label)
  const claimStarts = new Set(inside.map(claim => claim.start))
  const points = new Set<number>([start, end, ...marks.keys()])
  for (const claim of inside) { points.add(claim.start); points.add(claim.end) }
  const ordered = [...points].sort((a, b) => a - b)

  const add = (label: string, kind: DurationKind, ms: number) => {
    const seen = totals.get(label) ?? { kind, ms: 0 }
    seen.ms += ms
    totals.set(label, seen)
  }
  let openGap = 0

  for (let index = 0; index < ordered.length - 1; index++) {
    const from = ordered[index]
    const to = ordered[index + 1]
    const span = to - from
    if (span <= 0) continue
    const active = inside.filter(claim => claim.start <= from && claim.end >= to)
    if (!active.length) {
      // An uncovered stretch that runs up to a prompt (or to the end of an open session) is the
      // session waiting on the human. One that runs up to the assistant starting is time the host
      // took and nobody recorded -- the red gap. The difference is which side of the prompt it is on.
      const waitingFor = claimStarts.has(to) ? undefined : marks.get(to) ?? (to === end ? WAITING_LABEL : undefined)
      if (waitingFor) { add(waitingFor, "waiting", span); if (openGap) { gaps.push(openGap); openGap = 0 } }
      else { add(GAP_LABEL, "gap", span); openGap += span }
      continue
    }
    if (openGap) { gaps.push(openGap); openGap = 0 }
    const top = active.reduce((best, claim) => Math.max(best, PRIORITY[claim.kind]), -1)
    const winners = [...new Set(active.filter(claim => PRIORITY[claim.kind] === top).map(claim => claim.label))]
    const kind = active.find(claim => PRIORITY[claim.kind] === top)!.kind
    for (const label of winners) add(label, kind, span / winners.length)
  }
  if (openGap) gaps.push(openGap)
  return { totals, gaps }
}

/** Every timestamp a message and its parts recorded, so the window can never end before the work did. */
function collectClaims(messages: MessageRow[]): { claims: Claim[]; inputMarks: Mark[]; stamps: number[]; toolCalls: number; toolSpanMs: number; envelopes: { seq: number; start: number; end: number; claims: Claim[]; tools: number }[] } {
  const claims: Claim[] = []
  const inputMarks: Mark[] = []
  const stamps: number[] = []
  const envelopes: { seq: number; start: number; end: number; claims: Claim[]; tools: number }[] = []
  let toolCalls = 0
  let toolSpanMs = 0
  const mark = (value: unknown) => { if (typeof value === "number" && isFinite(value) && value > 0) stamps.push(value); return typeof value === "number" && isFinite(value) && value > 0 ? value : undefined }

  for (const message of messages) {
    let data: any
    try { data = JSON.parse(message.data) } catch { continue }
    const time = data.time ?? {}
    if (message.type !== "assistant") {
      const at = mark(time.created)
      if (at !== undefined) inputMarks.push({ at, label: message.type === "user" ? WAITING_LABEL : INJECTED_LABEL })
      continue
    }
    const created = mark(time.created)
    mark(time.streamed)
    const own: Claim[] = []
    let tools = 0

    for (const part of data.content ?? []) {
      const partTime = part?.time ?? {}
      if (part?.type === "tool") {
        toolCalls++
        tools++
        const begin = mark(partTime.ran) ?? mark(partTime.created)
        const finish = mark(partTime.completed)
        const opened = mark(partTime.created)
        if (begin !== undefined && finish !== undefined && finish > begin) {
          own.push({ start: begin, end: finish, kind: "tool", label: toolLabel(String(part.name ?? "unknown")) })
          toolSpanMs += finish - begin
        }
        // created -> ran is the host finishing the arguments, checking permission and dispatching.
        if (opened !== undefined && partTime.ran !== undefined && partTime.ran > opened) own.push({ start: opened, end: partTime.ran, kind: "dispatch", label: DISPATCH_LABEL })
      } else if (part?.type === "reasoning") {
        const begin = mark(partTime.created)
        const finish = mark(partTime.completed)
        if (begin !== undefined && finish !== undefined && finish > begin) own.push({ start: begin, end: finish, kind: "reasoning", label: REASONING_LABEL })
      }
    }

    // The envelope closes at the last thing that actually happened when the step never ended.
    const recorded = mark(time.completed)
    const reached = own.reduce((last, claim) => Math.max(last, claim.end), recorded ?? 0)
    const start = created ?? own.reduce((first, claim) => Math.min(first, claim.start), Infinity)
    const end = Math.max(recorded ?? 0, reached)
    if (isFinite(start) && end > start) {
      own.push({ start, end, kind: "model", label: MODEL_LABEL })
      envelopes.push({ seq: message.seq, start, end, claims: own, tools })
    }
    claims.push(...own)
  }
  return { claims, inputMarks, stamps, toolCalls, toolSpanMs, envelopes }
}

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

/**
 * Attribute one session's wall clock.
 *
 * `row` is the `session_v2` row: its `time_created` / `time_updated` bound the window, but the
 * parts are allowed to widen it — on the production ledger `time_updated` has been observed 21.9s
 * BEHIND the last recorded part, and a window that ends before the work did would silently drop
 * that work.
 */
export function attributeDuration(row: { time_created?: number; time_updated?: number; time_idle?: number | null }, messages: MessageRow[]): Omit<SessionDuration, "sessionID" | "agent" | "title"> {
  const { claims, inputMarks, stamps, toolCalls, toolSpanMs, envelopes } = collectClaims(messages)
  const known = [...stamps, ...inputMarks.map(mark => mark.at)]
  const startedAt = Math.min(row.time_created ?? Infinity, ...(known.length ? known : [row.time_created ?? 0]))
  const endedAt = Math.max(row.time_updated ?? 0, ...(known.length ? known : [row.time_updated ?? 0]))
  const durationMs = Math.max(0, endedAt - startedAt)

  const { totals, gaps } = partition(claims, startedAt, endedAt, inputMarks)
  const callsByLabel = new Map<string, number>()
  for (const claim of claims) if (claim.kind === "tool") callsByLabel.set(claim.label, (callsByLabel.get(claim.label) ?? 0) + 1)

  const waitingMs = [...totals.values()].filter(value => value.kind === "waiting").reduce((n, value) => n + value.ms, 0)
  const gapMs = totals.get(GAP_LABEL)?.ms ?? 0
  const activeMs = Math.max(0, durationMs - waitingMs)
  const segments: DurationSegment[] = [...totals.entries()]
    .map(([label, value]) => ({
      label,
      kind: value.kind,
      ms: Math.round(value.ms),
      share: durationMs ? value.ms / durationMs : 0,
      activeShare: value.kind === "waiting" ? 0 : activeMs ? value.ms / activeMs : 0,
      ...(callsByLabel.has(label) ? { calls: callsByLabel.get(label) } : {}),
    }))
    .sort((a, b) => b.ms - a.ms)

  const toolWallMs = segments.filter(segment => segment.kind === "tool").reduce((n, segment) => n + segment.ms, 0)

  const turns: DurationTurn[] = envelopes.map(envelope => {
    const inner = partition(envelope.claims, envelope.start, envelope.end, [])
    let toolMs = 0
    for (const [, value] of inner.totals) if (value.kind === "tool") toolMs += value.ms
    const ms = envelope.end - envelope.start
    return { seq: envelope.seq, startedAt: envelope.start, ms, toolMs: Math.round(toolMs), modelMs: Math.round(ms - toolMs), tools: envelope.tools }
  })

  return {
    startedAt,
    endedAt,
    durationMs,
    activeMs,
    waitingMs: Math.round(waitingMs),
    segments,
    gapMs: Math.round(gapMs),
    gapCount: gaps.length,
    medianGapMs: median(gaps.map(Math.round)),
    longestGapMs: Math.round(gaps.reduce((n, gap) => Math.max(n, gap), 0)),
    toolCalls,
    concurrentToolMs: Math.max(0, Math.round(toolSpanMs - toolWallMs)),
    turns,
  }
}

/** Roll the segments up to one entry per kind, for a proportional stacked bar. */
export function durationGroups(duration: SessionDuration, options: { includeWaiting?: boolean } = {}): { kind: DurationKind; ms: number; share: number }[] {
  const totals = new Map<DurationKind, number>()
  for (const segment of duration.segments) {
    if (!options.includeWaiting && segment.kind === "waiting") continue
    totals.set(segment.kind, (totals.get(segment.kind) ?? 0) + segment.ms)
  }
  const base = [...totals.values()].reduce((n, value) => n + value, 0)
  return [...totals.entries()]
    .map(([kind, ms]) => ({ kind, ms, share: base ? ms / base : 0 }))
    .sort((a, b) => b.ms - a.ms)
}

/**
 * Read one session, or every session, out of a host database.
 *
 * Opened read-only with a short busy timeout: the live host owns this file and a graph view must
 * never be able to block it.
 */
export function readSessionDurations(options: { file?: string; sessionID?: string } = {}): { file: string; sessions: SessionDuration[] } {
  const file = options.file ?? hostDatabaseFile()
  if (!existsSync(file)) throw new Error("No session database at " + file)
  const db = new Database(file, { readonly: true })
  try {
    db.exec("PRAGMA busy_timeout=1000")
    const rows = (options.sessionID
      ? db.query("select id,title,agent,time_created,time_updated,time_idle from session_v2 where id=?").all(options.sessionID)
      : db.query("select id,title,agent,time_created,time_updated,time_idle from session_v2").all()) as any[]
    const sessions = rows.map(row => {
      const messages = db.query("select type,seq,data from session_message where session_id=? order by seq").all(row.id) as MessageRow[]
      return {
        sessionID: row.id,
        agent: row.agent ?? undefined,
        title: String(row.title ?? ""),
        ...attributeDuration(row, messages),
      }
    })
    return { file, sessions }
  } finally { db.close() }
}
