/**
 * Self-improving incident loop: notice -> diagnose -> propose -> ask.
 *
 * Detects recurring incidents from signals the system already records
 * (papercuts.json, plugin-health.json, orchestration.jsonl, tui-*.log),
 * deduplicates each recurring error class into exactly one diagnosis Quest
 * (quest/store.ts admit(), which already dedupes by requestFingerprint), and
 * leaves the fix itself gated by orchestration/apply-gate.ts: a diagnosis
 * Quest whose fix touches system-owning code cannot complete without Jk's
 * recorded yes. This module only detects and proposes; it never edits code
 * and never approves itself.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { queryPapercuts, type Papercut } from "../plugins-active/papercut-memory"
import { readPluginHealth, HEALTH_FILE, type PluginHealth } from "../plugin-health"
import { readLedger, LEDGER_FILE, type LedgerEvent } from "./orchestration-ledger"
import { QuestStore } from "../quest/store"
import { readAllQuests } from "../quest/index"
import { requestFingerprint } from "../quest/privacy"
import { QUOTA_FAILOVER_PATTERN } from "../quest/reducer"
import type { Quest } from "../quest/types"

export const STATE_DIR = join(homedir(), ".local", "state", "opencode")
export const TUI_USAGE_LOG = join(STATE_DIR, "tui-usage.log")
export const TUI_PROBE_LOG = join(STATE_DIR, "tui-probe.log")

export type IncidentSource = "papercut" | "plugin-health" | "orchestration-ledger" | "tui-log" | "manual"
export type Incident = {
  fingerprint: string
  source: IncidentSource
  family: string
  title: string
  detail: string
  occurrences: number
  lastSeen: string
  refs: string[]
}

function fp(...parts: string[]): string { return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 20) }

/** Reduce free text to a stable bucket: strip numbers/ids/paths so two occurrences of "the same" error collapse to one fingerprint. */
function bucket(text: string): string {
  return text.toLowerCase().replace(/[A-Za-z]:\\[^\s]+|\/[^\s]+/g, "<path>").replace(/\b[0-9a-f]{6,}\b/g, "<id>").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 160)
}

// ---- Signal 1: recurring papercuts (shell failure memory) ------------------

export function detectPapercutIncidents(threshold = 2, file?: string, repo?: string, sinceDays?: number): Incident[] {
  const rows: Papercut[] = queryPapercuts({ state: "unresolved", limit: 50, repo, sinceDays }, file)
  return rows.filter((r) => r.occurrences >= threshold).map((r) => ({
    fingerprint: fp("papercut", r.fingerprint),
    source: "papercut" as const,
    family: r.family,
    title: `Recurring ${r.family} failure: ${r.errorSignature}`,
    detail: `${r.command} :: ${r.failure.excerpt || r.failure.status}`,
    occurrences: r.occurrences,
    lastSeen: r.lastSeen,
    refs: [r.id],
  }))
}

// ---- Signal 2: plugin-health quarantines/disables ---------------------------

export function detectPluginHealthIncidents(file = HEALTH_FILE, sinceMs = 24 * 60 * 60 * 1000, now = Date.now()): Incident[] {
  if(!Number.isFinite(sinceMs)||sinceMs<0||!Number.isFinite(now))throw Error("Invalid plugin-health observation window")
  const rows: PluginHealth[] = readPluginHealth(file)
  const groups = new Map<string, { count: number; sample: PluginHealth }>()
  for (const row of rows) {
    const at=Date.parse(row.timestamp);if(!Number.isFinite(at)||at<now-sinceMs||at>now)continue
    const key = `${row.path}|${row.phase}|${bucket(row.error)}`
    const g = groups.get(key)
    if (g) { g.count++; if (row.timestamp > g.sample.timestamp) g.sample = row } else groups.set(key, { count: 1, sample: row })
  }
  return [...groups.values()].map(({ count, sample }) => ({
    fingerprint: fp("plugin-health", sample.path, sample.phase, bucket(sample.error)),
    source: "plugin-health" as const,
    family: sample.phase,
    title: `Plugin ${sample.action} (${sample.phase}): ${sample.path}`,
    detail: sample.error,
    occurrences: count,
    lastSeen: sample.timestamp,
    refs: [sample.path],
  }))
}

// ---- Signal 3: orchestration ledger (failed notifications, failed deliveries) ----

export function detectLedgerIncidents(threshold = 2, file = LEDGER_FILE, sinceMs = 24 * 60 * 60 * 1000): Incident[] {
  const events: LedgerEvent[] = readLedger(file)
  const cutoff = Date.now() - sinceMs
  const groups = new Map<string, { count: number; label: string; family: string; at: string }>()
  for (const e of events) {
    if (!Number.isFinite(Date.parse(e.at)) || Date.parse(e.at) < cutoff || e.provenance === "synthetic") continue
    let key: string | undefined, label: string | undefined, family: string | undefined
    if (e.kind === "notification" && (e.state === "failed" || e.state === "missing-result" || e.state === "stopped")) {
      const desc = e.description ?? ""
      if (QUOTA_FAILOVER_PATTERN.test(desc)) continue // quota exhaustion is infrastructure noise, not a verdict — same exclusion the reducer already applies
      family = "notification"
      key = `notification|${e.state}|${bucket(desc)}`
      label = `Session notification ${e.state}: ${(desc || "no description").slice(0, 160)}`
    } else if (e.kind === "completion-delivery" && e.deliveryState === "failed") {
      family = "completion-delivery"
      key = "completion-delivery|failed"
      label = "Completion-delivery failed (worker finished but the Quest never received the result)"
    }
    if (!key || !label || !family) continue
    const g = groups.get(key)
    if (g) { g.count++; g.at = e.at } else groups.set(key, { count: 1, label, family, at: e.at })
  }
  const out: Incident[] = []
  for (const [key, g] of groups) {
    if (g.count < threshold) continue
    out.push({ fingerprint: fp("orchestration-ledger", key), source: "orchestration-ledger", family: g.family, title: g.label, detail: g.label, occurrences: g.count, lastSeen: g.at, refs: [file] })
  }
  return out
}

// ---- Signal 4: tui-*.log error lines ----------------------------------------

export type TuiLogPattern = { file: string; pattern: RegExp; family: string; title: string }
export function defaultTuiLogPatterns(stateDir = STATE_DIR): TuiLogPattern[] {
  return [
    { file: join(stateDir, "tui-usage.log"), pattern: /usage\.show missing/i, family: "tui-usage", title: "usage.show slash command missing after boot" },
    { file: join(stateDir, "tui-probe.log"), pattern: /Keymap\.Provider is missing/i, family: "tui-probe", title: "keymap.layer setup fails: Keymap.Provider is missing" },
  ]
}

const LOG_TIMESTAMP_RE = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/
/** Per-line timestamp: a line's own `[ISO]`/`=== ISO ===` marker, or the most recent one above it (tui-probe.log stamps a header, then unstamped detail lines). */
function lineTimestamps(lines: string[]): string[] {
  const out: string[] = []
  let current = ""
  for (const line of lines) { current = line.match(LOG_TIMESTAMP_RE)?.[1] ?? current; out.push(current) }
  return out
}

export function detectTuiLogIncidents(patterns: TuiLogPattern[] = defaultTuiLogPatterns(), threshold = 2, sinceMs = 7 * 24 * 60 * 60 * 1000): Incident[] {
  const out: Incident[] = []
  const cutoff = Date.now() - sinceMs
  for (const p of patterns) {
    if (!existsSync(p.file)) continue
    let lines: string[]
    try { lines = readFileSync(p.file, "utf8").split(/\r?\n/) } catch { continue }
    const timestamps = lineTimestamps(lines)
    const matches = lines.map((line, i) => ({ line, at: timestamps[i] })).filter(({ line, at }) => p.pattern.test(line) && !!at && Number.isFinite(Date.parse(at)) && Date.parse(at) >= cutoff && Date.parse(at) <= Date.now())
    if (matches.length < threshold) continue
    const lastSeen = matches.map((m) => m.at).filter(Boolean).sort().at(-1)!
    out.push({
      fingerprint: fp("tui-log", p.file, p.pattern.source),
      source: "tui-log",
      family: p.family,
      title: p.title,
      detail: matches[matches.length - 1].line.slice(0, 240),
      occurrences: matches.length,
      lastSeen,
      refs: [p.file],
    })
  }
  return out
}

export type DetectOptions = {
  papercutThreshold?: number; papercutFile?: string; papercutRepo?: string; papercutSinceDays?: number
  pluginHealthFile?: string; pluginHealthSinceMs?:number
  ledgerThreshold?: number; ledgerFile?: string; ledgerSinceMs?: number
  tuiLogPatterns?: TuiLogPattern[]; tuiLogThreshold?: number; tuiLogSinceMs?: number
}

/** Bounding each signal to a recent window keeps the loop reporting today's incidents, not re-litigating every historical row on the first run. */
export function detectIncidents(opts: DetectOptions = {}): Incident[] {
  return [
    ...detectPapercutIncidents(opts.papercutThreshold ?? 2, opts.papercutFile, opts.papercutRepo, opts.papercutSinceDays ?? 3),
    ...detectPluginHealthIncidents(opts.pluginHealthFile,opts.pluginHealthSinceMs),
    ...detectLedgerIncidents(opts.ledgerThreshold ?? 2, opts.ledgerFile, opts.ledgerSinceMs ?? 24 * 60 * 60 * 1000),
    ...detectTuiLogIncidents(opts.tuiLogPatterns, opts.tuiLogThreshold ?? 2, opts.tuiLogSinceMs ?? 7 * 24 * 60 * 60 * 1000),
  ]
}

// ---- Auto-intake: one recurring error class -> one diagnosis Quest ---------

export function incidentRequestFingerprint(incident: Pick<Incident, "source" | "fingerprint">): string {
  return requestFingerprint({ incidentLoop: 1, source: incident.source, fingerprint: incident.fingerprint })
}

export type IntakeResult = { incident: Incident; quest: Quest; created: boolean }

/**
 * Deduplicated auto-intake. One recurring error class produces one Quest:
 * a second detection pass over the same incident returns the existing Quest
 * (created: false) instead of admitting a duplicate.
 */
export function intakeIncidents(projectRoot: string, incidents: Incident[], store: QuestStore = new QuestStore(projectRoot)): IntakeResult[] {
  const existing = readAllQuests(projectRoot,{includeArchived:true}).map((x) => x.quest).filter((q): q is Quest => !!q)
  const results: IntakeResult[] = []
  for (const incident of incidents) {
    const fingerprint = incidentRequestFingerprint(incident)
    const matches=existing.filter(q=>q.requestFingerprint===fingerprint||q.extensions?.incidentFingerprint===incident.fingerprint)
    const match=matches.find(q=>q.state!=="Archived")??matches.filter(q=>!Number.isFinite(Date.parse(incident.lastSeen))||Date.parse(incident.lastSeen)<=Date.parse(q.updatedAt)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]
    if (match) { results.push({ incident, quest: match, created: false }); continue }
    const quest = store.admit({
      title: `Diagnose incident: ${incident.title}`,
      objective: `Auto-detected recurring incident (${incident.source}/${incident.family}, ${incident.occurrences} occurrence(s)): ${incident.detail} Diagnose the root cause and prepare a fix. Any fix touching system-owning code (quest/, orchestration/, models/, plugins) is staged only — it cannot complete without Jk's explicit apply-gate approval (orchestration/apply-gate.ts).`,
      kind: "investigation",
      priority: incident.occurrences >= 5 ? "high" : "normal",
      requestFingerprint: fingerprint,
      extensions: {
        incidentLoop: true,
        incidentFingerprint: incident.fingerprint,
        incidentSource: incident.source,
        incidentFamily: incident.family,
        incidentOccurrences: incident.occurrences,
        incidentDetectedAt: new Date().toISOString(),
        applyGate: { status: "not-requested" },
      },
    })
    existing.push(quest)
    results.push({ incident, quest, created: true })
  }
  return results
}

/** One end-to-end pass: detect, then intake. This is the loop's whole body; a cron/watchdog just calls this on an interval. */
export function runIncidentLoop(projectRoot: string, opts: DetectOptions = {}): IntakeResult[] {
  return intakeIncidents(projectRoot, detectIncidents(opts))
}
