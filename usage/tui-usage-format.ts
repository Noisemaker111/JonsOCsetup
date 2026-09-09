/** Pure /usage TUI formatters — no JSX. Tests import this, not usage.tsx. */

export const MISSING = "—"
export const RESET_UNKNOWN = MISSING
export const BAR_WIDTH = 10
export const BAR_FILL = "█"
export const BAR_EMPTY = "░"

/**
 * HUD columns: WIN + BAR + PCT + RESET (quota) or WIN + $ + RESET (money).
 * Sum + gaps must stay compact so the dialog sizes to content, not xlarge.
 */
export const COL = { win: 4, bar: 10, pct: 5, reset: 8 } as const
export const COL_GAP = 2
export const COL_COUNT = 4
export const TABLE_WIDTH = COL.win + COL.bar + COL.pct + COL.reset + COL_GAP * (COL_COUNT - 1)
export const MONEY_WIDTH = COL.bar + COL_GAP + COL.pct
export const DIALOG_INNER = 44
export const HINT_WIDTH = 42

export type PctTone = "ok" | "warn" | "cap" | "none"

/** The state shown beside each provider in the interactive usage dialog. */
export type SourceState = "connected" | "usage-reached" | "unavailable" | "unknown"

export type UsageForecastIn = {
  state?: "unlikely" | "at-risk" | "likely" | "unknown"
  horizonSeconds?: number | null
}

export type UsageWindowIn = {
  scope?: "shared" | "model" | "feature" | "unknown"
  label?: string
  used?: number
  cap?: number | null
  pct?: number | null
  resetsInSeconds?: number | null
  status?: string
  usedTokens?: number
  estimated?: boolean
  provenance?: "provider-observed" | "local-measured" | "predicted" | "unknown"
  prediction?: UsageForecastIn
}

export type SourceCtx = {
  id?: string
  kind?: string
}

export type UsageSourceIn = SourceCtx & {
  probe?: string
  apiCapHit?: boolean
  windows?: UsageWindowIn[]
}

export type UsageRowOut = {
  window: string
  bar: string
  showBar: boolean
  metric: string
  pct: string
  pctTone: PctTone
  reset: string
}

function compactTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
}

function positiveLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

/** Provider-native session.context limit if the payload includes one; otherwise undefined. */
export function contextLimitFromPayload(payload: unknown): number | undefined {
  const queue: unknown[] = [payload]
  const seen = new Set<unknown>()
  for (let i = 0; i < queue.length && i < 8; i++) {
    const value = queue[i]
    if (value == null || typeof value !== "object" || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) continue
    const obj = value as Record<string, unknown>
    const tokens = obj.tokens && typeof obj.tokens === "object" && !Array.isArray(obj.tokens) ? obj.tokens as Record<string, unknown> : undefined
    const found = positiveLimit(obj.limit) ?? positiveLimit(obj.contextLimit) ?? positiveLimit(tokens?.limit) ?? positiveLimit(tokens?.context)
    if (found != null) return found
    if (obj.data && typeof obj.data === "object") queue.push(obj.data)
    if (tokens) queue.push(tokens)
  }
  return undefined
}

export function contextMessagesFromPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    if (Array.isArray(obj.messages)) return obj.messages
    if (Array.isArray(obj.data)) return obj.data
    const nested = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? obj.data as Record<string, unknown> : undefined
    if (nested) {
      if (Array.isArray(nested.messages)) return nested.messages
      if (Array.isArray(nested.data)) return nested.data
    }
  }
  return payload
}

/** Used-only when limit is unknown. Never invent a 200k (or any) fake cap. */
export function formatContextUsage(usedTokens: number, limit?: number): string {
  const used = Math.max(0, Math.round(usedTokens))
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return compactTokens(used)
  const pct = Math.max(0, Math.min(100, Math.round(used / limit * 100)))
  return `${compactTokens(used)}/${compactTokens(limit)} (${pct}%)`
}

/** Same rounding as formatContextUsage, exposed separately so a gauge can bar-render it. */
export function contextUsagePct(usedTokens: number, limit?: number): number | null {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return null
  const used = Math.max(0, Math.round(usedTokens))
  return Math.max(0, Math.min(100, Math.round(used / limit * 100)))
}

const SPARK_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/** Relative shape of a source's already-collected 5h/7d/30d spend — real magnitudes, never a fabricated history. */
export function formatSparkline(values: Array<number | null | undefined>): string {
  const nums = values.map((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0))
  const max = Math.max(0, ...nums)
  if (max <= 0) return ""
  return nums.map((v) => SPARK_GLYPHS[Math.min(SPARK_GLYPHS.length - 1, Math.floor((v / max) * (SPARK_GLYPHS.length - 1)))]).join("")
}

/** Only surface a forecast when it says something actionable; "unknown"/"unlikely" is noise, not signal. */
export function formatForecast(prediction: UsageForecastIn | undefined): string | undefined {
  if (!prediction) return undefined
  if (prediction.state !== "likely" && prediction.state !== "at-risk") return undefined
  const h = prediction.horizonSeconds
  if (h == null || !Number.isFinite(h)) return undefined
  const label = prediction.state === "likely" ? "exhausts" : "at risk"
  return `${label} ~${humanizeSeconds(h)}`
}

const SOURCE_TITLE: Record<string, string> = {
  "opencode-go": "OPENCODE GO",
  opencode: "OPENCODE",
  "grok-sub": "GROK",
  xai: "XAI",
  openai: "OPENAI",
  cursor: "CURSOR",
}

const SOURCE_HINT: Record<string, string> = {
  "opencode-go": "Go: 5h+week+month are real caps",
  "grok-sub": "SuperGrok 5h window · not xAI metered",
  cursor: "Cursor 5h premium · probe is presence-only",
}

/** Quota/subscription sources with their own authoritative percent (or none at all)
 * never show a $ column — a locally-priced token estimate is not their real bill. */
const NO_MONEY = new Set(["opencode-go", "opencode", "cursor", "openai"])

export function pad(value: string, width: number, align: "left" | "right"): string {
  const text = value.length > width ? value.slice(0, width) : value
  const space = " ".repeat(Math.max(0, width - text.length))
  return align === "left" ? text + space : space + text
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return MISSING
  return `$${n.toFixed(2)}`
}

export function fmtPct(pct: number | null | undefined, estimated = false): string {
  if (pct == null || !Number.isFinite(pct)) return MISSING
  return `${estimated ? "~" : ""}${Math.round(pct)}%`
}

export function fmtBar(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return ""
  const clamped = Math.max(0, Math.min(100, pct))
  let filled = Math.round(clamped / (100 / BAR_WIDTH))
  if (clamped > 0 && filled === 0) filled = 1
  if (clamped < 100 && filled === BAR_WIDTH) filled = BAR_WIDTH - 1
  return BAR_FILL.repeat(filled) + BAR_EMPTY.repeat(BAR_WIDTH - filled)
}

export function humanizeSeconds(total: number): string {
  const s = Math.max(0, Math.floor(Number(total) || 0))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return `${s}s`
}

export function fmtReset(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return RESET_UNKNOWN
  const text = humanizeSeconds(seconds)
  return text.length > COL.reset ? text.slice(0, COL.reset) : text
}

export function fmtWindow(label: string | undefined): string {
  const text = (label ?? "").trim()
  if (!text) return MISSING
  return text.length > COL.win ? text.slice(0, COL.win) : text
}

/** Kept for unit tests; the HUD no longer renders a STATUS column. */
export function fmtStatus(windowStatus?: string, probe?: string): string {
  const w = (windowStatus ?? "").toLowerCase()
  if (w === "rate-limited" || w === "cap") return "cap"
  if (w === "ok") return "ok"
  if (w === "stale") return "stale"
  const p = (probe ?? "").toLowerCase().trim()
  if (p === "ok") return "ok"
  if (p === "cap" || p.includes("rate-limit")) return "cap"
  if (p.includes("stale")) return "stale"
  if (!p || p === "none" || p.includes("no endpoint") || p.includes("not configured")) return "none"
  const compact = p.replace(/[^a-z0-9]+/g, "").slice(0, 6)
  return compact || "none"
}

export function pctTone(pct: number | null | undefined, status?: string): PctTone {
  if (status === "rate-limited" || status === "cap") return "cap"
  if (pct == null || !Number.isFinite(pct)) return "none"
  if (pct >= 90) return "cap"
  if (pct >= 70) return "warn"
  return "ok"
}

/**
 * Reduce probe and window telemetry to a truthful, compact provider state.
 *
 * `apiCapHit` is also used by the Go fail-closed path when its API is
 * unavailable, so it only means "usage reached" when the probe itself was
 * successful. A stale cache deliberately loses its state rather than making
 * old health or cap information look current.
 */
export function sourceState(source: UsageSourceIn | undefined, opts: { stale?: boolean } = {}): SourceState {
  if (!source || opts.stale) return "unknown"
  const windows = (source.windows ?? []).filter(w => !w.scope || w.scope === "shared")
  const capped = windows.some((w) =>
    w.status === "rate-limited" || w.status === "cap" ||
    (typeof w.pct === "number" && Number.isFinite(w.pct) && w.pct >= 100),
  )
  if (capped || (source.apiCapHit === true && source.probe === "ok")) return "usage-reached"
  if (source.probe === "ok") return "connected"
  if (source.probe === "err" || source.probe === "error") return "unavailable"
  if (windows.some((w) => w.provenance === "provider-observed")) return "connected"
  return "unknown"
}

export function sourceStateLabel(state: SourceState): string {
  if (state === "usage-reached") return "usage reached"
  return state
}

export function sourceStateTone(state: SourceState): PctTone {
  if (state === "usage-reached") return "cap"
  if (state === "connected") return "ok"
  if (state === "unavailable") return "cap"
  return "none"
}

export function sourceTitle(id: string): string {
  if (SOURCE_TITLE[id]) return SOURCE_TITLE[id]
  return id.replace(/-/g, " ").toUpperCase()
}

export function sourceUsesMoney(id?: string, _kind?: string): boolean {
  const key = (id ?? "").toLowerCase().split(":")[0]
  if (!key) return false
  return !NO_MONEY.has(key)
}

export function windowHasSignal(w: UsageWindowIn, source?: SourceCtx): boolean {
  if (w.pct != null && Number.isFinite(w.pct)) return true
  const used = w.used
  if (used != null && Number.isFinite(used) && used > 0) {
    if (!source?.id) return true
    return sourceUsesMoney(source.id, source.kind)
  }
  return false
}

/** Drop placeholder plan docs; never dump a wrapping paragraph. */
export function formatDoc(doc: string | undefined, width = HINT_WIDTH): string | undefined {
  if (!doc) return undefined
  const one = doc.replace(/\s+/g, " ").trim()
  if (!one || /^edit me/i.test(one)) return undefined
  if (one.length <= width) return one
  return one.slice(0, Math.max(0, width - 1)) + "…"
}

export function sourceHint(id: string, doc?: string, width = HINT_WIDTH): string | undefined {
  return formatDoc(SOURCE_HINT[id] ?? doc, width)
}

export function formatSubtitle(age: string, stale: boolean, width = DIALOG_INNER): string {
  const line = stale ? `${age} ago · stale` : `${age} ago`
  if (line.length <= width) return line
  return line.slice(0, Math.max(0, width - 1)) + "…"
}

function moneyAllowed(w: UsageWindowIn, source?: SourceCtx): boolean {
  if (source?.id) return sourceUsesMoney(source.id, source.kind)
  return (w.used ?? 0) > 0
}

export function formatWindowRow(w: UsageWindowIn, source?: SourceCtx): UsageRowOut {
  const pctKnown = w.pct != null && Number.isFinite(w.pct)
  const tone = pctTone(w.pct ?? null, w.status)
  // A window with no real signal (no pct, no tracked usage) only has a reset
  // countdown because computeWindowReset falls back to "a fresh full window" —
  // that's a guess, not a real deadline, so don't dress it up as one.
  const reset = windowHasSignal(w, source) ? fmtReset(w.resetsInSeconds ?? null) : RESET_UNKNOWN
  const window = fmtWindow(w.label)

  if (pctKnown) {
    const pct = fmtPct(w.pct, w.estimated)
    return {
      window,
      bar: fmtBar(w.pct),
      showBar: true,
      metric: pct,
      pct,
      pctTone: tone,
      reset,
    }
  }

  if (moneyAllowed(w, source) && w.used != null && Number.isFinite(w.used) && w.used > 0) {
    const metric = fmtMoney(w.used)
    return {
      window,
      bar: "",
      showBar: false,
      metric,
      pct: MISSING,
      pctTone: "none",
      reset,
    }
  }

  return {
    window,
    bar: "",
    showBar: false,
    metric: MISSING,
    pct: MISSING,
    pctTone: "none",
    reset,
  }
}

export function emptySourceRow(_probe?: string): UsageRowOut {
  return {
    window: MISSING,
    bar: "",
    showBar: false,
    metric: MISSING,
    pct: MISSING,
    pctTone: "none",
    reset: RESET_UNKNOWN,
  }
}

export function formatRowLine(row: UsageRowOut): string {
  const win = pad(row.window ?? MISSING, COL.win, "left")
  const reset = pad(row.reset ?? RESET_UNKNOWN, COL.reset, "right")
  if (row.showBar) {
    return [win, pad(row.bar ?? "", COL.bar, "left"), pad(row.pct ?? MISSING, COL.pct, "right"), reset].join(" ".repeat(COL_GAP))
  }
  return [win, pad(row.metric ?? MISSING, MONEY_WIDTH, "left"), reset].join(" ".repeat(COL_GAP))
}

export const HEADER_LINE = formatRowLine({
  window: "WIN",
  bar: "",
  showBar: true,
  metric: "",
  pct: "%",
  pctTone: "none",
  reset: "RESET",
})
