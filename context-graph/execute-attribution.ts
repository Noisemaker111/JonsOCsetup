/**
 * Where a Code Mode `execute` span actually went.
 *
 * An `execute` part is one tool call in the timeline, but it is really a small program that calls
 * other tools: across this installation's ledger, 1,571 `execute` parts made 2,286 inner calls, up
 * to 24 inside a single one. The part records `time.created` / `time.ran` / `time.completed` for
 * the whole program and `state.metadata.toolCalls` records each inner call's `{tool, status, input}`
 * with no timing at all, so a duration view can only draw one undifferentiated block.
 *
 * `execute-timing.ts` fills that gap: it times every inner call from the host's own tool hooks and
 * writes the spans into `state.metadata.innerCalls`, which is stored for the TUI and never sent to
 * the model (aisdk's `toolResultPart` builds the request from the result), so the record costs no
 * context tokens. This module turns those spans into an attribution.
 *
 * Two rules keep the attribution honest:
 *
 *  - **Parallel calls are merged, not summed.** Code Mode runs independent calls with
 *    `Promise.all`, so two 300 ms calls that overlap occupy 300 ms of the execute span, not 600.
 *    Inner spans are clamped into the execute window and unioned before subtraction. The per-tool
 *    ranking still reports each call's own duration, because that is what a slow tool costs.
 *  - **The remainder is reported, not distributed.** Whatever the union does not cover is
 *    `unaccountedMs`: Code Mode runtime startup, the model's own JavaScript between calls, and
 *    result serialisation. It is named, never spread over the tools that happen to be there.
 *
 * `scripts/execute-attribution.ts` and any duration screen read through this module so a screen and
 * the command it was verified against cannot report different numbers.
 */
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { hostDatabaseFile, type MessageRow } from "./context-graph"

/** How an inner call ended. `interrupted` is a call the program never awaited before it returned. */
export type InnerCallStatus = "completed" | "error" | "interrupted"

/** One inner Code Mode call, as `execute-timing.ts` stores it under `state.metadata.innerCalls`. */
export type InnerCallRecord = {
  tool: string
  /** Unix ms when the host entered the inner call, taken in the host process. */
  start: number
  end: number
  status: InnerCallStatus
}

export type ExecuteSpan = {
  sessionID: string
  /** `session_message.seq` of the assistant message that holds the part. */
  seq: number
  /** The part's `id`, which is the host tool call id the timing hooks key on. */
  callID: string
  status: string
  /** `completed - (ran ?? created)`: the host's own definition of a tool part's duration. */
  durationMs: number
  /** `ran - created`: time the call waited before the host began executing it. */
  queuedMs: number
  /** Inner calls the metadata records the tool and status of, whether or not they were timed. */
  calls: number
  /**
   * Calls the metadata names but nothing timed, with what the metadata says became of them. Two
   * kinds reach a host tool and so can never fire a hook: Code Mode's built-in `search`, which
   * resolves against the runtime's own catalog, and a call the runtime rejects on its own
   * signature check, which is recorded `error` without ever being dispatched.
   */
  untimed: { tool: string; status: string }[]
  inner: InnerCallRecord[]
  /** Union of the inner spans clamped into the execute window; overlapping calls counted once. */
  attributedMs: number
  /** The part of the span no inner call covers. Reported as itself, never spread over the tools. */
  unaccountedMs: number
  /** Window start to the first inner call: Code Mode runtime startup and parsing the code. */
  startupMs: number
  /** Holes between inner calls: the model's own JavaScript deciding what to call next. */
  betweenMs: number
  /** Last inner call to window end: formatting and returning the result. */
  tailMs: number
  /** False when the part carries no timed spans: a failed execute, a search-only one, or one that predates the timing plugin. */
  timed: boolean
}

export type InnerToolStat = {
  tool: string
  calls: number
  errors: number
  /** Sum of each call's own duration, so a tool run twice in parallel is charged for both. */
  totalMs: number
  medianMs: number
  p95Ms: number
  maxMs: number
}

export type AttributionTotals = {
  executes: number
  timed: number
  /** Executes with no timed spans at all, which contribute their whole span to `unaccountedMs`. */
  untimed: number
  /** Calls the metadata names that nothing timed, `search` above all, counted per tool. */
  untimedCalls: Record<string, number>
  /** Untimed calls the metadata records as errors: rejected by the runtime before any host tool ran. */
  untimedRejected: number
  spanMs: number
  attributedMs: number
  unaccountedMs: number
  startupMs: number
  betweenMs: number
  tailMs: number
  /** Attributed share of the span of the timed executes only; the honest headline. */
  coverage: number
  /** Attributed share of every execute span, including the ones nothing timed. */
  coverageOfAll: number
}

/**
 * Total length covered by a set of intervals, counting overlap once.
 *
 * Summing durations would double-charge `Promise.all`, which is the normal way Code Mode issues
 * several calls, and could attribute more than the span it is being subtracted from.
 */
export function mergedLength(spans: { start: number; end: number }[]): number {
  const sorted = spans.filter(span => span.end > span.start).sort((a, b) => a.start - b.start)
  let total = 0, start = 0, end = -1
  for (const span of sorted) {
    if (span.start > end) { total += Math.max(0, end - start); start = span.start; end = span.end; continue }
    if (span.end > end) end = span.end
  }
  return total + Math.max(0, end - start)
}

const asRecord = (value: unknown): InnerCallRecord | undefined => {
  if (!value || typeof value !== "object") return undefined
  const { tool, start, end, status } = value as Record<string, unknown>
  if (typeof tool !== "string" || typeof start !== "number" || typeof end !== "number") return undefined
  return { tool, start, end, status: status === "error" || status === "interrupted" ? status : "completed" }
}

/** Attribute one stored `execute` part. `part` is a `tool` part as the host writes it. */
export function attributeExecutePart(part: any, sessionID: string, seq: number): ExecuteSpan | undefined {
  if (part?.type !== "tool" || part.name !== "execute") return undefined
  const time = part.time ?? {}
  const began = time.ran ?? time.created
  if (typeof began !== "number" || typeof time.completed !== "number") return undefined
  const metadata = part.state?.metadata ?? {}
  const inner = (Array.isArray(metadata.innerCalls) ? metadata.innerCalls : []).flatMap((value: unknown) => {
    const record = asRecord(value)
    return record ? [record] : []
  })
  // An inner span can only be charged against the window it ran in; a call left open when the
  // program returned is closed at the end of the window rather than being dropped.
  const clamped = inner.map(record => ({
    start: Math.max(record.start, began),
    end: Math.min(record.end, time.completed),
  }))
  const durationMs = time.completed - began
  const attributedMs = Math.min(durationMs, mergedLength(clamped))
  // Split the remainder by where it sits rather than leaving it one number: what happens before the
  // first call, between calls and after the last one are three different costs with three different
  // fixes, and none of them belongs to a tool. startup + attributed + between + tail = duration.
  const first = clamped.length ? Math.min(...clamped.map(span => span.start)) : time.completed
  const last = clamped.length ? Math.max(...clamped.map(span => span.end)) : time.completed
  const startupMs = inner.length ? first - began : 0
  const tailMs = inner.length ? time.completed - last : 0
  const named = (Array.isArray(metadata.toolCalls) ? metadata.toolCalls : [])
    .map((call: any) => ({ tool: String(call?.tool ?? "unknown"), status: String(call?.status ?? "unknown") }))
  const calls = named.length || inner.length
  // Whatever the metadata names that no span covers: one occurrence cancels one span of that tool.
  const untimed = [...named]
  for (const record of inner) {
    const at = untimed.findIndex(call => call.tool === record.tool)
    if (at >= 0) untimed.splice(at, 1)
  }
  return {
    sessionID,
    seq,
    callID: String(part.id ?? ""),
    status: String(part.state?.status ?? "unknown"),
    durationMs,
    queuedMs: typeof time.ran === "number" && typeof time.created === "number" ? time.ran - time.created : 0,
    calls,
    untimed,
    inner,
    attributedMs,
    unaccountedMs: durationMs - attributedMs,
    startupMs,
    betweenMs: inner.length ? durationMs - attributedMs - startupMs - tailMs : 0,
    tailMs,
    timed: inner.length > 0,
  }
}

/** Every `execute` span in one session's stored messages. Same row shape `attributeSession` reads. */
export function executeSpans(messages: MessageRow[], sessionID: string): ExecuteSpan[] {
  const spans: ExecuteSpan[] = []
  for (const message of messages) {
    if (message.type !== "assistant") continue
    let data: any
    try { data = JSON.parse(message.data) } catch { continue }
    for (const part of data.content ?? []) {
      const span = attributeExecutePart(part, sessionID, message.seq)
      if (span) spans.push(span)
    }
  }
  return spans
}

const quantile = (values: number[], fraction: number) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}

/** Rank the inner tools by the time they actually spend, across whatever spans are passed in. */
export function innerToolStats(spans: ExecuteSpan[]): InnerToolStat[] {
  const byTool = new Map<string, { durations: number[]; errors: number }>()
  for (const span of spans) {
    for (const call of span.inner) {
      const entry = byTool.get(call.tool) ?? { durations: [], errors: 0 }
      entry.durations.push(Math.max(0, call.end - call.start))
      if (call.status === "error") entry.errors++
      byTool.set(call.tool, entry)
    }
  }
  return [...byTool.entries()]
    .map(([tool, entry]) => ({
      tool,
      calls: entry.durations.length,
      errors: entry.errors,
      totalMs: entry.durations.reduce((n, value) => n + value, 0),
      medianMs: quantile(entry.durations, 0.5),
      p95Ms: quantile(entry.durations, 0.95),
      maxMs: Math.max(...entry.durations),
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
}

/**
 * Reconcile: inner spans + unaccounted remainder = the execute span, exactly.
 *
 * `coverage` deliberately excludes executes nothing timed rather than counting them as a 100%
 * miss, and `coverageOfAll` reports the version that does, so neither number can flatter the
 * other. An untimed execute is still carried in `spanMs` and `unaccountedMs`.
 */
export function attributionTotals(spans: ExecuteSpan[]): AttributionTotals {
  const timed = spans.filter(span => span.timed)
  const spanMs = spans.reduce((n, span) => n + span.durationMs, 0)
  const attributedMs = spans.reduce((n, span) => n + span.attributedMs, 0)
  const timedSpanMs = timed.reduce((n, span) => n + span.durationMs, 0)
  const sum = (pick: (span: ExecuteSpan) => number) => spans.reduce((n, span) => n + pick(span), 0)
  const untimedCalls: Record<string, number> = {}
  let untimedRejected = 0
  for (const span of spans) for (const call of span.untimed) {
    untimedCalls[call.tool] = (untimedCalls[call.tool] ?? 0) + 1
    if (call.status === "error") untimedRejected++
  }
  return {
    executes: spans.length,
    timed: timed.length,
    untimed: spans.length - timed.length,
    untimedCalls,
    untimedRejected,
    spanMs,
    attributedMs,
    unaccountedMs: spanMs - attributedMs,
    startupMs: sum(span => span.startupMs),
    betweenMs: sum(span => span.betweenMs),
    tailMs: sum(span => span.tailMs),
    coverage: timedSpanMs ? attributedMs / timedSpanMs : 0,
    coverageOfAll: spanMs ? attributedMs / spanMs : 0,
  }
}

/**
 * Read execute spans out of a host database.
 *
 * Read-only with a short busy timeout, like every other reader here: the live host owns this file
 * and a duration view must never be able to block it.
 */
export function readExecuteSpans(options: { file?: string; sessionID?: string } = {}): { file: string; spans: ExecuteSpan[] } {
  const file = options.file ?? hostDatabaseFile()
  if (!existsSync(file)) throw new Error("No session database at " + file)
  const db = new Database(file, { readonly: true })
  try {
    db.exec("PRAGMA busy_timeout=1000")
    const rows = (options.sessionID
      ? db.query("select session_id,type,seq,data from session_message where type='assistant' and session_id=? order by seq").all(options.sessionID)
      : db.query("select session_id,type,seq,data from session_message where type='assistant' order by session_id,seq").all()) as (MessageRow & { session_id: string })[]
    const spans = rows.flatMap(row => executeSpans([row], row.session_id))
    return { file, spans }
  } finally { db.close() }
}
