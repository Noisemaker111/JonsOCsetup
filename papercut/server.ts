/** Durable, observation-only memory for shell failures. It never changes or reruns commands. */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, platform } from "node:os"
import { dirname, resolve } from "node:path"
import { createHash } from "node:crypto"
import { define } from "@opencode-ai/plugin/v2/promise"
import { hiddenExecFileSync } from "../scripts/windows-process"

export const PAPERCUT_FILE = process.env.OPENCODE_PAPERCUT_FILE || resolve(homedir(), ".local", "state", "opencode", "papercuts.json")
/** Default ledger, resolved per call so OPENCODE_PAPERCUT_FILE can redirect tests and tools after import. */
function defaultFile() { return process.env.OPENCODE_PAPERCUT_FILE || PAPERCUT_FILE }
const MAX_RECORDS = 500
const MAX_TEXT = 240
const MAX_SOLUTIONS = 10
const LOCK_TIMEOUT = 10000
const pending = new Map<string, Observation>()
const hangs = new Map<string, { timer: ReturnType<typeof setTimeout>; observation: Observation; startedAt: number; fingerprint?: string }>()

export type Observation = { command: string; cwd?: string; sessionID?: string; questID?: string; agent?: string; startedAt?: string; shell?: string }
export type Papercut = {
  id: string; schema: 1; family: string; fingerprint: string; repo: string; cwd: string; platform: string; shell: string
  command: string; errorSignature: string; suggestedRemediation?: string; failure: { status: string; excerpt: string; at: string; startedAt?: string; endedAt?: string; durationMs?: number; sessionID?: string; questID?: string }
  worktree: string
  occurrences: number; lastSeen: string; state: "unresolved" | "resolved"; confidence: number
  solutions: Array<{ command: string; evidence: string; at: string; sessionID?: string; confidence: number }>
  evidence?: Array<{ kind: "replay" | "note"; outcome: string; detail: string; at: string }>
}
type Store = { schema: 1; records: Papercut[] }

function text(v: unknown, max = MAX_TEXT) { return typeof v === "string" ? v.slice(0, max) : "" }
function redact(value: string) {
  return value.replace(/(authorization\s*:\s*bearer\s+|(?:api[_-]?key|token|secret|password|passwd|private[_-]?key)\s*[=:]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, "[REDACTED]")
}
function normalize(command: string) {
  return redact(command).trim().replace(/\s+/g, " ").replace(/(['"]).*?\1/g, "$1…$1").replace(/[A-Za-z]:\\[^ ]+|\/[^ ]+/g, "<path>")
}
export function commandFamily(command: string) {
  const c = normalize(command).toLowerCase()
  if (/\bgit\b/.test(c)) return "git"
  if (/\b(?:npm|pnpm|yarn|bun)\b/.test(c)) return "node-dependencies"
  if (/\b(?:node|deno|bun)\b/.test(c)) return "node"
  if (/\b(?:cargo|rustc)\b/.test(c)) return "rust"
  if (/\b(?:python|pip)\b/.test(c)) return "python"
  if (/\b(?:dotnet|msbuild)\b/.test(c)) return "dotnet"
  return (c.match(/^([\w.-]+)/)?.[1] || "shell")
}
function signature(output: string) {
  const s = redact(output).toLowerCase()
  if (/working directory does not exist|working directory .* not exist|directory does not exist|no such file or directory/.test(s)) return "missing-working-directory"
  if (/filename too long|file name too long|path too long/.test(s)) return "filename-too-long"
  if (/node_modules|cannot find module|module not found/.test(s)) return "missing-node-dependency"
  if (/timed out|timeout|no[ -]?response|no output|hung/.test(s)) return "timeout-or-no-response"
  if (/permission denied|access is denied/.test(s)) return "permission-denied"
  if (/not found|is not recognized/.test(s)) return "command-not-found"
  const useful = s.split(/\r?\n/).find(x => x.trim())?.replace(/\d+/g, "#").slice(0, 90) || "nonzero-exit"
  return createHash("sha256").update(useful).digest("hex").slice(0, 12)
}
function objective(command: string) { const c = normalize(command).toLowerCase(); if (/artifact-gate/.test(c)) return "artifact-gate"; if (/node_modules|junction/.test(c)) return "node-dependency"; if (/core\.longpaths/.test(c)) return "git-longpaths"; return "" }
const repoCache = new Map<string, string>()
function repoIdentity(cwd: string) {
  const key = cwd.replace(/[\\/]+$/, "").toLowerCase()
  const cached = repoCache.get(key); if (cached) return cached
  try {
    const value = String(hiddenExecFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).trim().replace(/[\\/]+$/, "").toLowerCase() || key
    repoCache.set(key, value); return value
  } catch { repoCache.set(key, key); return key }
}
function lock<T>(file: string, fn: () => T): T | undefined {
  const l = `${file}.lock`, started = Date.now()
  while (Date.now() - started < LOCK_TIMEOUT) { try { mkdirSync(l); try { return fn() } finally { rmSync(l, { recursive: true, force: true }) } } catch (e) { if ((e as any)?.code !== "EEXIST") return undefined; try { if (Date.now() - statSync(l).mtimeMs > 30000) rmSync(l, { recursive: true, force: true }) } catch {} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5) } }
  return undefined
}
function load(file = defaultFile()): Store { try { const x = JSON.parse(readFileSync(file, "utf8")); if (x?.schema !== 1 || !Array.isArray(x.records)) return { schema: 1, records: [] }; return { schema: 1, records: x.records.filter((r: any) => r && typeof r.id === "string" && typeof r.fingerprint === "string" && typeof r.repo === "string" && typeof r.family === "string" && typeof r.command === "string" && r.failure && typeof r.failure === "object").map((r: any) => ({ ...r, solutions: Array.isArray(r.solutions) ? r.solutions.slice(-MAX_SOLUTIONS) : [] })) } } catch { return { schema: 1, records: [] } } }
function save(store: Store, file = defaultFile()) {
  mkdirSync(dirname(file), { recursive: true }); store.records.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)); store.records = store.records.slice(0, MAX_RECORDS).map(r => ({ ...r, solutions: r.solutions.slice(-MAX_SOLUTIONS) }))
  const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(store), "utf8"); renameSync(tmp, file)
}
function eventFields(event: any, output?: any): { observation: Observation; result: any } | undefined {
  const input = event?.input ?? event?.args ?? {}; const command = typeof input === "string" ? input : input.command ?? input.cmd ?? input.script
  if (typeof command !== "string" || !command.trim()) return undefined
  return { observation: { command, cwd: input.cwd ?? event.cwd ?? process.cwd(), sessionID: event.sessionID ?? event.parentID, questID: input.questID ?? event.questID, agent: event.agent, startedAt: event.startedAt, shell: input.shell ?? event.shell }, result: output ?? event.output ?? event }
}
function resultData(result: any) {
  const raw = typeof result === "string" ? { output: result, error: result } : result && typeof result === "object" ? result : {}
  const meta = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}
  const nested = raw.output && typeof raw.output === "object" ? raw.output : {}
  const r = { ...meta, ...nested, ...raw }
  const outputText = [raw.output, nested.output, meta.output].find(x => typeof x === "string")
  const out = [r.stderr, r.error, r.stdout, outputText, r.message, r.title].filter(x => typeof x === "string" && x.trim()).join("\n")
  const exit = r.exitCode ?? r.code ?? r.exit ?? (typeof r.status === "number" ? r.status : undefined)
  const hasExit = typeof exit === "number" || (typeof exit === "string" && exit.trim() !== "")
  const rawStatus = typeof r.status === "string" ? r.status.toLowerCase() : ""
  const status = r.timedOut || r.timeout ? "timeout" : r.cancelled || r.canceled ? "cancelled" : r.noResponse ? "no-response"
    : hasExit ? Number(exit) === 0 ? "succeeded" : "failed"
    : /success|completed|ok/.test(rawStatus) ? "succeeded"
    : /fail|error|does not exist|not found/.test(rawStatus) || Boolean(r.error || r.stderr) || /error:|fatal:|not found|cannot find module/i.test(out) ? "failed"
    : "unknown"
  return { out, status, durationMs: Number(r.durationMs) || undefined }
}
export function recordShell(event: any, output?: any, file = defaultFile()) {
  const fields = eventFields(event, output); if (!fields) return
  const { observation, result } = fields, d = resultData(result), now = new Date().toISOString(), normalized = normalize(observation.command)
  // A chain that prints a genuine error and ends in `exit 0` is retained as an observed masked failure.
  const masked = d.status === "succeeded" && /(?:filename too long|error:|fatal:|not found|cannot find module)/i.test(d.out) && /(?:^|[;&|])\s*exit\s+0\b/i.test(observation.command)
  if (d.status === "succeeded" && !masked) {
    linkObserved(observation, d.out, file); return
  }
  if (d.status === "unknown" && !d.out) return
  const family = /working directory does not exist|working directory .* not exist|directory does not exist|no such file or directory/i.test(d.out) ? "workspace" : commandFamily(observation.command), worktree = String(observation.cwd || process.cwd()), repo = repoIdentity(worktree), sig = signature(d.out || (masked ? "masked exit 0" : d.status)), fingerprint = createHash("sha256").update(`${repo}|${family}|${sig}|${normalized}`).digest("hex").slice(0, 20)
  try { mkdirSync(dirname(file), { recursive: true }); lock(file, () => { const store = load(file); let row = store.records.find(x => x.fingerprint === fingerprint) || store.records.find(x => x.repo === repo && x.family === family && x.errorSignature === sig && x.command === normalized); if (!row) { row = { id: `pc_${fingerprint}`, schema: 1, family, fingerprint, repo, cwd: worktree, worktree, platform: platform(), shell: text(observation.shell || (platform() === "win32" ? "powershell" : "bash"), 40), command: normalized, errorSignature: sig, suggestedRemediation: sig === "missing-working-directory" ? "Please validate the shared repo working directory before issuing commands; no remediation was run automatically." : undefined, failure: { status: masked ? "masked-success" : d.status, excerpt: redact(d.out).slice(0, MAX_TEXT), at: now, startedAt: observation.startedAt, endedAt: now, durationMs: d.durationMs, sessionID: observation.sessionID, questID: observation.questID }, occurrences: 0, lastSeen: now, state: "unresolved", confidence: 0.5, solutions: [] }; store.records.push(row) } row.occurrences++; row.lastSeen = now; row.failure = { ...row.failure, status: masked ? "masked-success" : d.status, excerpt: redact(d.out).slice(0, MAX_TEXT), at: now, startedAt: row.failure.startedAt || observation.startedAt, endedAt: now, durationMs: d.durationMs, sessionID: observation.sessionID, questID: observation.questID }; prune(store); save(store, file) }) } catch { /* never affect command execution */ }
}
function prune(store: Store) { store.records = store.records.slice(0, MAX_RECORDS) }

// ---- Hung commands --------------------------------------------------------
// A shell call that never returns is never seen by execute.after, so the
// recorder above never fires for the most painful failures of all. The
// plugin arms a timer per pending shell call; when it fires we record a
// `no-response` papercut. Observation only — the command is never killed.

/** Hang threshold: OPENCODE_PAPERCUT_HANG_MS, default 120s, never below 10s. */
export function hangThresholdMs() { return Math.max(10_000, Number(process.env.OPENCODE_PAPERCUT_HANG_MS) || 120_000) }
export type HangClock = { now(): number; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
let hangClock: HangClock = { now: Date.now, setTimeout, clearTimeout }
/** Test seam: swap the clock used to arm hang timers (undefined restores the real one). */
export function setHangClock(clock: HangClock | undefined) { hangClock = clock ?? { now: Date.now, setTimeout, clearTimeout } }
export function hangExcerpt(observation: Observation, elapsedMs: number) { return `no output for ${Math.round(elapsedMs / 1000)}s while running: ${normalize(observation.command)}` }
function hangEvent(observation: Observation, elapsedMs: number) {
  return { event: { tool: "shell", input: observation, sessionID: observation.sessionID, questID: observation.questID, agent: observation.agent, startedAt: observation.startedAt ?? new Date(hangClock.now() - elapsedMs).toISOString() }, output: { noResponse: true, stderr: hangExcerpt(observation, elapsedMs), durationMs: elapsedMs } }
}
/** Record a hung command as a `timeout-or-no-response` papercut. Returns the fingerprint, or undefined if recording failed. */
export function recordHang(observation: Observation, elapsedMs: number, file = defaultFile()): string | undefined {
  try {
    const { event, output } = hangEvent(observation, elapsedMs), normalized = normalize(observation.command), worktree = String(observation.cwd || process.cwd())
    const fingerprint = createHash("sha256").update(`${repoIdentity(worktree)}|${commandFamily(observation.command)}|${signature(hangExcerpt(observation, elapsedMs))}|${normalized}`).digest("hex").slice(0, 20)
    recordShell(event, output, file)
    return fingerprint
  } catch { return undefined }
}
/** A call that already recorded a hang papercut eventually finished: append the real outcome as evidence, and credit the solution if it succeeded. */
export function reconcileHang(fingerprint: string, observation: Observation, elapsedMs: number, output: any, file = defaultFile()) {
  try {
    const d = resultData(output), now = new Date().toISOString(), seconds = Math.round(elapsedMs / 1000)
    const detail = d.status === "succeeded" ? `eventually exited 0 after ${seconds}s` : `eventually ${d.status} after ${seconds}s${d.out ? `: ${redact(d.out).slice(0, 120)}` : ""}`
    lock(file, () => {
      const store = load(file), row = store.records.find(x => x.fingerprint === fingerprint || x.id === `pc_${fingerprint}`)
      if (!row) return
      row.evidence = [...(row.evidence || []), { kind: "note", outcome: redact(d.status).slice(0, 40), detail: redact(detail).slice(0, MAX_TEXT), at: now }].slice(-MAX_SOLUTIONS)
      row.occurrences++; row.lastSeen = now
      if (d.status === "succeeded") { row.solutions.push({ command: normalize(observation.command), evidence: "completed after hang", at: now, sessionID: observation.sessionID, confidence: 0.4 }); row.state = "resolved"; row.confidence = 0.4 }
      save(store, file)
    })
  } catch { /* never affect command execution */ }
}
function linkObserved(observation: Observation, output: string, file: string) { const worktree = String(observation.cwd || process.cwd()), repo = repoIdentity(worktree), family = commandFamily(observation.command); try { lock(file, () => { const store = load(file), sig = signature(output), goal = objective(observation.command), now = Date.now(), candidates = store.records.filter(x => x.repo === repo && x.family === family && x.shell === text(observation.shell || (platform() === "win32" ? "powershell" : "bash"), 40) && x.state === "unresolved" && now - Date.parse(x.lastSeen) <= 86400000 && (x.errorSignature === sig || (x.errorSignature === "filename-too-long" && /core\.longpaths/i.test(observation.command)) || (goal === "artifact-gate" && /artifact-gate/.test(x.command)))); if (candidates.length !== 1 || candidates[0].command === normalize(observation.command)) return; const row = candidates[0]; row.solutions.push({ command: normalize(observation.command), evidence: redact(output).slice(0, MAX_TEXT) || "successful exit", at: new Date().toISOString(), sessionID: observation.sessionID, confidence: 0.65 }); row.state = "resolved"; row.confidence = 0.65; save(store, file) }) } catch {} }
export function markPapercut(id: string, solution: string, evidence = "explicitly linked", file = defaultFile()) { try { lock(file, () => { const s = load(file), r = s.records.find(x => x.id === id); if (!r) return; r.solutions.push({ command: normalize(solution), evidence: redact(evidence).slice(0, MAX_TEXT), at: new Date().toISOString(), confidence: 1 }); r.state = "resolved"; r.confidence = 1; save(s, file) }) } catch {} }
export function getPapercut(id: string, file = defaultFile()) { return load(file).records.find(r => r.id === id) }
export function recordPapercutEvidence(id: string, outcome: string, detail: string, file = defaultFile()) { let saved = false; try { lock(file, () => { const s = load(file), r = s.records.find(x => x.id === id); if (!r) return; r.evidence = [...(r.evidence || []), { kind: "replay", outcome: redact(outcome).slice(0, 40), detail: redact(detail).slice(0, MAX_TEXT), at: new Date().toISOString() }].slice(-MAX_SOLUTIONS); r.lastSeen = new Date().toISOString(); save(s, file); saved = true }) } catch {} return saved }
export function queryPapercuts(input: any = {}, file = defaultFile()) {
  const now = Date.now(), repo = input.repo ?? repoIdentity(process.cwd())
  const rows = load(file).records.filter(r => (!input.repo || r.repo === repo) && (!input.family || r.family === input.family) && (!input.errorSignature || r.errorSignature === input.errorSignature) && (!input.state || r.state === input.state) && (!input.confidence || r.confidence >= Number(input.confidence)) && (!input.sinceDays || now - Date.parse(r.lastSeen) <= Number(input.sinceDays) * 86400000))
  rows.sort((a, b) => Number(b.state === "unresolved") - Number(a.state === "unresolved") || b.lastSeen.localeCompare(a.lastSeen))
  return rows.slice(0, Math.min(Number(input.limit) || 25, 50))
}
export function formatFixPlan(row: Papercut, questID?: string) {
  return [
    `Fix papercut ${row.id} (${row.family} · ${row.state})`,
    `failed: ${row.command}`,
    `why: ${row.errorSignature} — ${row.failure.excerpt || row.failure.status}`,
    row.suggestedRemediation ? `remediation: ${row.suggestedRemediation}` : "",
    row.solutions.length ? `known working: ${row.solutions.map(s => s.command).join("; ")}` : "known working: none yet — inspect the failure, apply a fix, then mark_papercut",
    questID ? `quest: ${questID}` : "",
    "Do the fix yourself (run the known working command or the equivalent). Then mark_papercut with the command that worked.",
  ].filter(Boolean).join("\n")
}
export function formatPapercuts(rows: Papercut[]) {
  if (!rows.length) return "No papercuts found for this repository."
  return rows.map(r => [`[${r.id}] ${r.family} · ${r.state} · ${r.occurrences} occurrence(s)`, `failed: ${r.command}`, `why: ${r.errorSignature} — ${r.failure.excerpt || r.failure.status}`, r.solutions.length ? `worked: ${r.solutions.map(s => `${s.command} (${s.evidence})`).join("; ")}` : "worked: not observed", `fix: call fix_papercut with id ${r.id}`, `sessions: ${[r.failure.sessionID, ...r.solutions.map(s => s.sessionID)].filter(Boolean).join(", ") || "unknown"}`].join("\n")).join("\n\n")
}

export default define({ id: "papercut-memory", async setup(ctx) {
  const tool = (ctx as any).tool
  const isShell = (e: any) => /^(shell|bash|cmd|powershell|pwsh|terminal|exec)$/i.test(String(e?.tool ?? e?.name ?? ""))
  const shell = (ctx as any).shell
  if (shell?.hook) await shell.hook("create.before", (e: any) => {
    // Shell creation supplies the authoritative cwd/shell; retain it for the subsequent tool event.
    const f = eventFields(e); if (!f) return
    const key = String(e?.callID ?? e?.id ?? e?.sessionID ?? "")
    if (key) pending.set(key, f.observation)
  })
  if (tool?.hook) { await tool.hook("execute.before", (e: any) => {
    if (!isShell(e)) return
    const f = eventFields(e); if (!f) return
    const key = String(e.callID ?? e.id ?? `${Date.now()}-${Math.random()}`)
    pending.set(key, f.observation)
    // Arm a hang timer: if this call is still pending when it fires, record a
    // no-response papercut. Observation only — the command is never touched.
    const existing = hangs.get(key); if (existing) hangClock.clearTimeout(existing.timer)
    const observation = f.observation, startedAt = hangClock.now()
    const timer = hangClock.setTimeout(() => {
      if (!pending.has(key)) return
      try { const fingerprint = recordHang(observation, hangClock.now() - startedAt); const h = hangs.get(key); if (h) h.fingerprint = fingerprint } catch { /* never affect command execution */ }
    }, hangThresholdMs())
    timer?.unref?.()
    hangs.set(key, { timer, observation, startedAt })
  }); await tool.hook("execute.after", (e: any, out: any) => { if (!isShell(e)) return; const key = String(e?.callID ?? e?.id ?? ""); const obs = pending.get(key); const output = out ?? e?.output; const hang = hangs.get(key); if (hang) { hangClock.clearTimeout(hang.timer); hangs.delete(key) } if (obs) { pending.delete(key); if (hang?.fingerprint) reconcileHang(hang.fingerprint, obs, hangClock.now() - hang.startedAt, output); else recordShell({ ...e, input: obs }, output) } else recordShell(e, output) }) }
  if (tool?.transform) await tool.transform((draft: any) => { draft.add({ name: "view_papercuts", description: "Read-only, local memory of shell approaches that caused papercuts. It only remembers; it never acts.", input: { type: "object", properties: { repo: { type: "string" }, family: { type: "string" }, errorSignature: { type: "string" }, state: { type: "string", enum: ["unresolved", "resolved"] }, sinceDays: { type: "number" }, confidence: { type: "number" }, limit: { type: "number" } }, additionalProperties: false }, execute: async (input: any) => ({ content: formatPapercuts(queryPapercuts(input)) }) }); draft.add({ name: "mark_papercut", description: "Explicitly link a known working command to a papercut. Metadata only; does not execute the command.", input: { type: "object", properties: { id: { type: "string" }, solution: { type: "string" }, evidence: { type: "string" } }, required: ["id", "solution"], additionalProperties: false }, execute: async (input: any) => { markPapercut(input.id, input.solution, input.evidence); return { content: "Papercut metadata linked." } } }); draft.add({ name: "fix_papercut", description: "Open a papercut for repair: show the failure, known working command, and a follow-up Quest. Does not execute the command; you must apply the fix.", input: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, execute: async (input: any) => { const row = getPapercut(input.id); if (!row) return { content: `Papercut not found: ${input.id}` }; let questID: string | undefined; try { const { createPapercutFollowup } = await import("./papercut-ui"); questID = createPapercutFollowup(row.id)?.id } catch {} return { content: formatFixPlan(row, questID) } } }) })
} })
