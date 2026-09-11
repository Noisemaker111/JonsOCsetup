/**
 * Where one session's tokens went, read from the host database the running host writes.
 *
 * Two different things are reported and never mixed:
 *
 *  - Recorded per-turn counters (`session_message.data.tokens`) are what the provider billed:
 *    sent, cache-read, output, cost. These are measurements, not estimates.
 *  - Attribution of what was sent is derived from the stored parts, because that is the part a
 *    change can actually shrink. Characters are converted at 4 chars/token, so every attributed
 *    figure is an estimate and is labelled as one wherever it is shown.
 *
 * Facts that are easy to get wrong and are encoded here once:
 *  - A message's parts are `text` / `reasoning` / `tool`. There is no tool-call/tool-result pair.
 *  - A `tool` part carries the call AND the result together under `state`: `input` is what the
 *    model wrote, `content` is what came back.
 *  - `state.metadata` is stored for the TUI and is never sent: aisdk's `toolResultPart` builds the
 *    model message from the result. Counting it as context overstates what was actually sent, so
 *    it is kept in its own stored-only bucket.
 *
 * `scripts/context-audit.ts` and the `/context-graph` TUI screen both read through this module so
 * the screen can never drift from the CLI it was verified against.
 */
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type SliceKind = "instructions" | "prompts" | "assistant" | "reasoning" | "tool-input" | "tool-result" | "other" | "stored"

export type ContextTurn = {
  seq: number
  /** Uncached prompt tokens the provider charged for this request. */
  input: number
  /** Prompt tokens served from cache for this request. */
  cached: number
  output: number
  reasoning: number
  cost: number
}

export type ContextSlice = {
  label: string
  kind: SliceKind
  chars: number
  tokens: number
  /** Fraction of the attributed sent total; stored-only slices are 0 because they are not context. */
  share: number
  stored: boolean
}

export type SessionContext = {
  sessionID: string
  agent?: string
  title: string
  recorded: { input: number; output: number; cost: number }
  /** Sent tokens of the first recorded request: what the session costs before any work happens. */
  coldStartTokens: number
  turns: ContextTurn[]
  slices: ContextSlice[]
  /** Attributed estimate of everything that was sent, in tokens. */
  sentTokens: number
  /** Attributed estimate of what is stored for the TUI and never reaches the model. */
  storedOnlyTokens: number
}

export const STORED_PREFIX = "[stored, not sent]"
export const isStoredOnly = (label: string) => label.startsWith(STORED_PREFIX)

/** The only conversion in this module. Every figure derived from it is an estimate. */
export const contextTokens = (chars: number) => Math.round(chars / 4)

/** The database the running host writes; the drivers point OPENCODE_DB at an isolated copy. */
export function hostDatabaseFile(): string {
  return process.env.OPENCODE_DB ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "opencode.db")
}

/** Injected system context is shared by hash, so name each blob by what it actually holds. */
export function describeInstruction(value: string): string {
  const text = value.startsWith('"') ? (() => { try { return JSON.parse(value) as string } catch { return value } })() : value
  if (text.startsWith("<env>")) return "env header"
  if (/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d/.test(text)) return "date"
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed) && parsed[0]?.path) return "instruction files (" + parsed.length + ")"
    if (Array.isArray(parsed) && parsed[0]?.id) return "skills catalog (" + parsed.length + ")"
    if (parsed?.namespaces) return `tool namespaces (${parsed.shown}/${parsed.total} shown)`
  } catch {}
  return "instruction blob"
}

export type MessageRow = { type: string; seq: number; data: string }

/**
 * Attribute one session's stored parts.
 *
 * `instructionValues` are the raw instruction blobs the session currently holds, already resolved
 * from its `instruction_state` to `instruction_blob`.
 */
export function attributeSession(messages: MessageRow[], instructionValues: string[]): { turns: ContextTurn[]; slices: ContextSlice[]; sentTokens: number; storedOnlyTokens: number } {
  const turns: ContextTurn[] = []
  const buckets = new Map<string, { kind: SliceKind; chars: number }>()
  const add = (kind: SliceKind, label: string, chars: number) => {
    const seen = buckets.get(label) ?? { kind, chars: 0 }
    seen.chars += chars
    buckets.set(label, seen)
  }

  for (const value of instructionValues) add("instructions", "instructions: " + describeInstruction(value), value.length)

  for (const message of messages) {
    let data: any
    try { data = JSON.parse(message.data) } catch { continue }
    if (message.type === "user") { add("prompts", "user prompts", String(data.text ?? "").length); continue }
    const used = data.tokens ?? {}
    if (used.input || used.cache?.read) turns.push({
      seq: message.seq,
      input: used.input ?? 0,
      cached: used.cache?.read ?? 0,
      output: used.output ?? 0,
      reasoning: used.reasoning ?? 0,
      cost: +(data.cost ?? 0).toFixed(5),
    })
    for (const part of data.content ?? []) {
      if (part.type === "text") add("assistant", "assistant text", String(part.text ?? "").length)
      else if (part.type === "reasoning") add("reasoning", "assistant reasoning", String(part.text ?? "").length)
      else if (part.type === "tool") {
        const state = part.state ?? {}
        const name = part.name ?? "unknown"
        if (state.input !== undefined) add("tool-input", "tool call in: " + name, JSON.stringify(state.input).length)
        if (state.content !== undefined) add("tool-result", "tool result: " + name, JSON.stringify(state.content).length)
        // Stored for the TUI only; aisdk toolResultPart builds the request from the result.
        if (state.metadata !== undefined) add("stored", STORED_PREFIX + " metadata: " + name, JSON.stringify(state.metadata).length)
      }
      else add("other", "part: " + part.type, JSON.stringify(part).length)
    }
  }

  const ranked = [...buckets.entries()]
    .map(([label, value]) => ({ label, kind: value.kind, chars: value.chars, tokens: contextTokens(value.chars), stored: isStoredOnly(label) }))
    .sort((a, b) => b.chars - a.chars)
  const sentTokens = ranked.filter(row => !row.stored).reduce((n, row) => n + row.tokens, 0)
  const storedOnlyTokens = ranked.filter(row => row.stored).reduce((n, row) => n + row.tokens, 0)
  const slices: ContextSlice[] = ranked.map(row => ({ ...row, share: row.stored || !sentTokens ? 0 : row.tokens / sentTokens }))
  return { turns, slices, sentTokens, storedOnlyTokens }
}

/** Roll the ranked slices up to one entry per kind, for a proportional stacked bar. */
export function sliceGroups(slices: ContextSlice[]): { kind: SliceKind; tokens: number; share: number }[] {
  const totals = new Map<SliceKind, number>()
  for (const slice of slices) {
    if (slice.stored) continue
    totals.set(slice.kind, (totals.get(slice.kind) ?? 0) + slice.tokens)
  }
  const sent = [...totals.values()].reduce((n, value) => n + value, 0)
  return [...totals.entries()]
    .map(([kind, tokens]) => ({ kind, tokens, share: sent ? tokens / sent : 0 }))
    .sort((a, b) => b.tokens - a.tokens)
}

/**
 * Lay a stacked bar out in whole terminal cells without losing or inventing a segment: every
 * non-zero group keeps at least one cell, and the largest group absorbs the rounding remainder so
 * the bar is always exactly `width` cells wide.
 */
export function stackedBar(groups: { kind: SliceKind; tokens: number; share: number }[], width: number): { kind: SliceKind; tokens: number; share: number; cells: number }[] {
  const present = groups.filter(group => group.tokens > 0)
  if (!present.length || width <= 0) return []
  const usable = Math.max(width, present.length)
  const cells = present.map(group => ({ ...group, cells: Math.max(1, Math.round(group.share * usable)) }))
  let drift = cells.reduce((n, entry) => n + entry.cells, 0) - usable
  for (let index = 0; drift !== 0 && index < cells.length * 2; index++) {
    const entry = cells[drift > 0 ? cells.length - 1 - (index % cells.length) : 0]
    if (drift > 0 && entry.cells > 1) { entry.cells--; drift-- }
    else if (drift < 0) { cells[0].cells++; drift++ }
  }
  return cells
}

function instructionValues(db: Database, sessionID: string): string[] {
  const state = db.query("select current_values from instruction_state where session_id=?").get(sessionID) as { current_values: string } | undefined
  if (!state) return []
  let held: string[] = []
  try { held = Object.values(JSON.parse(state.current_values) as Record<string, string>) } catch { return [] }
  const values: string[] = []
  for (const hash of held) {
    const blob = db.query("select value from instruction_blob where hash=?").get(hash) as { value: string } | undefined
    if (blob) values.push(blob.value)
  }
  return values
}

/**
 * Read one session, or every session, out of a host database.
 *
 * Opened read-only with a short busy timeout: the live host owns this file and a graph view must
 * never be able to block it.
 */
export function readSessionContexts(options: { file?: string; sessionID?: string } = {}): { file: string; sessions: SessionContext[] } {
  const file = options.file ?? hostDatabaseFile()
  if (!existsSync(file)) throw new Error("No session database at " + file)
  const db = new Database(file, { readonly: true })
  try {
    db.exec("PRAGMA busy_timeout=1000")
    const rows = (options.sessionID
      ? db.query("select id,title,agent,cost,tokens_input,tokens_output from session_v2 where id=?").all(options.sessionID)
      : db.query("select id,title,agent,cost,tokens_input,tokens_output from session_v2").all()) as any[]
    const sessions = rows.map(row => {
      const messages = db.query("select type,seq,data from session_message where session_id=? order by seq").all(row.id) as MessageRow[]
      const attributed = attributeSession(messages, instructionValues(db, row.id))
      return {
        sessionID: row.id,
        agent: row.agent ?? undefined,
        title: String(row.title ?? ""),
        recorded: { input: row.tokens_input ?? 0, output: row.tokens_output ?? 0, cost: +(row.cost ?? 0).toFixed(4) },
        coldStartTokens: attributed.turns[0]?.input ?? 0,
        ...attributed,
      }
    })
    return { file, sessions }
  } finally { db.close() }
}
