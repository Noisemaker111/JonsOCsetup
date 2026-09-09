/** Shared account usage API: one cache across generations/processes, no exposed credentials. */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, statSync, utimesSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { randomUUID } from "node:crypto"
import { recordQuotaObservations } from "./calibration-store"
import { discoverConnections, type Connection } from "./account-connections"
import { probeConnection, type Observation, type ProbeFailure } from "./account-adapters"
import type { AccountSnapshot, AccountUsage, AccountWindow, PublicConnection } from "./account-types"
export type { AccountSnapshot, AccountUsage, AccountWindow } from "./account-types"

export const ACCOUNT_USAGE_FILE = process.env.OPENCODE_ACCOUNT_USAGE_FILE ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "opencode", "account-usage.json")
export const ACCOUNT_USAGE_TTL_MS = 30_000
const PLAN_TTL_MS = 6 * 3600_000
const stateKey = Symbol.for("opencode.account-usage.service")
type State = { flights: Map<string, Promise<AccountSnapshot>>; timer?: ReturnType<typeof setInterval> }
function state(): State {
  const root = globalThis as any
  return root[stateKey] ??= { flights: new Map() }
}
const empty = (): AccountSnapshot => ({ schema: 1, updatedAt: "", accounts: [], diagnostics: [] })
function readRaw(file: string): AccountSnapshot {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"))
    return data.schema === 1 && Array.isArray(data.accounts) && Array.isArray(data.diagnostics) && data.accounts.every((a: any) =>
      a && typeof a.id === "string" && a.plan && Array.isArray(a.windows) && Array.isArray(a.connections) &&
      a.windows.every((w: any) => w && typeof w.id === "string")) ? data : empty()
  } catch { return empty() }
}
export function accountIsStale(account: AccountUsage, now = Date.now()): boolean {
  const observed = Date.parse(account.observedAt ?? "")
  return !Number.isFinite(observed) || observed > now || now - observed >= ACCOUNT_USAGE_TTL_MS
}
export function windowNeedsRefresh(window: AccountWindow, now = Date.now()): boolean {
  return window.resetAt != null && Date.parse(window.resetAt) <= now
}
export function readAccountUsage(file = ACCOUNT_USAGE_FILE, now = Date.now()): AccountSnapshot {
  const snapshot = readRaw(file)
  return { ...snapshot, accounts: snapshot.accounts.map(a => ({
    ...a,
    freshness: { stale: accountIsStale(a, now), ageSeconds: a.observedAt && Number.isFinite(Date.parse(a.observedAt)) ? Math.max(0, Math.floor((now - Date.parse(a.observedAt)) / 1000)) : null, resetPending: a.windows.some(w => windowNeedsRefresh(w, now)) },
    state: ["auth-required", "unsupported"].includes(a.state) ? a.state : accountIsStale(a, now) || a.windows.some(w => w.scope === "shared" && windowNeedsRefresh(w, now)) ? "unknown" : a.state,
  })) }
}
function publicConnection(c: Connection): PublicConnection {
  return { id: c.id, owner: c.owner, routeProviders: c.routeProviders, modelPrefix: c.modelPrefix }
}
function sameConnections(account: AccountUsage, connections: Connection[]): boolean {
  return JSON.stringify(account.connections) === JSON.stringify(connections.map(publicConnection))
}
function newAccount(c: Connection): AccountUsage {
  return {
    id: c.accountID, provider: c.provider, identity: c.identity, connections: [], plan: c.plan,
    windows: [], extraUsage: { enabled: null }, state: "unknown", observedAt: null,
    attemptedAt: null, nextAttemptAt: null, failures: 0, error: null,
  }
}
export type AccountServiceOptions = {
  refresh?: boolean
  file?: string
  now?: () => number
  discover?: typeof discoverConnections
  probe?: (connection: Connection, options: { now: () => number; fetch: typeof fetch; refreshPlan: boolean }) => Promise<Observation | ProbeFailure>
  fetch?: typeof fetch
  lockWaitMs?: number
}
function writeAtomic(file: string, snapshot: AccountSnapshot) {
  const temporary = file + "." + randomUUID() + ".tmp"
  writeFileSync(temporary, JSON.stringify(snapshot, null, 2), { flag: "wx", mode: 0o600 })
  try { renameSync(temporary, file) } finally { if (existsSync(temporary)) unlinkSync(temporary) }
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Cross-process single flight, including TUI, collector CLI and immutable plugin generations. */
async function refreshUnderLock(opts: AccountServiceOptions): Promise<AccountSnapshot> {
  const file = opts.file ?? ACCOUNT_USAGE_FILE, now = opts.now ?? Date.now
  mkdirSync(dirname(file), { recursive: true })
  const lockFile = file + ".lock", owner = randomUUID(), deadline = Date.now() + (opts.lockWaitMs ?? 18_000)
  let acquired = false
  while (!acquired) {
    try { writeFileSync(lockFile, owner, { flag: "wx", mode: 0o600 }); acquired = true } catch (error: any) {
      if (error?.code !== "EEXIST") throw error
      // Only our exact lock file is eligible; no process inspection or termination.
      try { if (Date.now() - statSync(lockFile).mtimeMs > 120_000) unlinkSync(lockFile) } catch {}
      if (Date.now() >= deadline) {
        const cached = readAccountUsage(file, now())
        return { ...cached, diagnostics: [...cached.diagnostics, "Account refresh is still in progress; returning last observations."] }
      }
      await pause(75)
    }
  }
  const heartbeat = setInterval(() => { try { if (readFileSync(lockFile, "utf8") === owner) utimesSync(lockFile, new Date(), new Date()) } catch {} }, 10_000)
  heartbeat.unref?.()
  try {
    const previous = readRaw(file)
    const discovery = (opts.discover ?? discoverConnections)()
    const groups = new Map<string, Connection[]>()
    for (const c of discovery.connections) groups.set(c.accountID, [...(groups.get(c.accountID) ?? []), c])
    const entries = [...groups.entries()], accounts: AccountUsage[] = new Array(entries.length)
    let index = 0
    const worker = async () => {
      for (;;) {
        const i = index++
        if (i >= entries.length) return
        const [id, connections] = entries[i]
        const old = previous.accounts.find(a => a.id === id)
        const current = old ?? newAccount(connections[0])
        const clock = now(), attempt = Date.parse(current.attemptedAt ?? "")
        // Force means bypass freshness, not hammer a provider on simultaneous calls.
        const recentAttempt = Number.isFinite(attempt) && clock - attempt >= 0 && clock - attempt < 5000
        const retry = Date.parse(current.nextAttemptAt ?? "")
        const atReset = current.windows.some(w => windowNeedsRefresh(w, clock))
        const retained = old && sameConnections(old, connections)
        if (retained && (recentAttempt || (retry > clock && (current.failures > 0 || !opts.refresh && !atReset)))) {
          accounts[i] = current
          continue
        }
        const base = { ...current, connections: connections.map(publicConnection), attemptedAt: new Date(clock).toISOString() }
        let failure: ProbeFailure = { state: "unknown", error: "No working usage connection." }
        let observation: Observation | undefined
        let activeConnectionID: string | undefined
        const planAge = clock - Date.parse(current.plan.observedAt ?? "")
        const refreshPlan = current.plan.provenance !== "provider-observed" || !Number.isFinite(planAge) || planAge < 0 || planAge >= PLAN_TTL_MS
        const ordered = [...connections].sort((a, b) => Number(b.id === current.activeConnectionID) - Number(a.id === current.activeConnectionID))
        for (const connection of ordered) {
          try {
            const result = await (opts.probe ?? probeConnection)(connection, { now, fetch: opts.fetch ?? fetch, refreshPlan })
            if ("windows" in result) { observation = result; activeConnectionID = connection.id; break }
            failure = result
          } catch { failure = { state: "unknown", error: "Usage adapter failed." } }
        }
        if (observation) {
          const observed = now()
          const shared = observation.windows.filter(w => w.scope === "shared")
          const exhausted = shared.some(w => w.state === "exhausted")
          const available = shared.length > 0 && shared.every(w => w.state === "available" && !windowNeedsRefresh(w, observed))
          const upcoming = observation.windows.flatMap(w => w.resetAt && Date.parse(w.resetAt) > observed ? [Date.parse(w.resetAt) + 100] : [])
          accounts[i] = {
            ...base, activeConnectionID, windows: observation.windows, plan: observation.plan ?? current.plan,
            extraUsage: observation.extraUsage ?? current.extraUsage,
            state: exhausted ? "exhausted" : available ? "available" : "unknown",
            observedAt: new Date(observed).toISOString(),
            nextAttemptAt: new Date(Math.min(observed + ACCOUNT_USAGE_TTL_MS, ...upcoming)).toISOString(),
            failures: 0, error: null,
          }
        } else {
          const failures = current.failures + 1
          const retryMs = Math.max(5000, (failure.retryAfterSeconds ?? Math.min(300, 15 * 2 ** Math.min(failures - 1, 5))) * 1000)
          accounts[i] = { ...base, state: failure.state, failures, error: failure.error,
            nextAttemptAt: new Date(now() + retryMs).toISOString() }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker))
    // Removed credentials remove the account; cached quota cannot authorize a signed-out account.
    const snapshot: AccountSnapshot = { schema: 1, updatedAt: new Date(now()).toISOString(), accounts, diagnostics: discovery.diagnostics }
    writeAtomic(file, snapshot)
    try { recordQuotaObservations(snapshot, file + ".observations") } catch { snapshot.diagnostics.push("Quota observation history could not be saved") }
    return readAccountUsage(file, now())
  } finally {
    clearInterval(heartbeat)
    try { if (readFileSync(lockFile, "utf8") === owner) unlinkSync(lockFile) } catch {}
  }
}
export function getAccountUsage(options: AccountServiceOptions = {}): Promise<AccountSnapshot> {
  const key = options.file ?? ACCOUNT_USAGE_FILE
  const flights = state().flights
  const existing = flights.get(key)
  if (existing) return existing
  const pending = refreshUnderLock(options).finally(() => { if (flights.get(key) === pending) flights.delete(key) })
  flights.set(key, pending)
  return pending
}
/** Refresh while the usage server is running; timers do not keep the host alive. */
export function startAccountUsageRefresh() {
  const st = state()
  if (st.timer) return
  const refresh = () => void getAccountUsage().catch(() => {})
  refresh()
  st.timer = setInterval(refresh, ACCOUNT_USAGE_TTL_MS)
  st.timer.unref?.()
}
export function formatAccountUsage(snapshot: AccountSnapshot, now = Date.now()): string {
  const lines = snapshot.accounts.map(account => {
    const plan = account.plan.name ?? account.plan.rateLimitTier ?? "plan unknown"
    const tier = account.plan.multiplier ? " " + account.plan.multiplier + "x" : ""
    const windows = account.windows.map(w => {
      const time = w.resetAt ? Math.max(0, Math.ceil((Date.parse(w.resetAt) - now) / 60000)) : null
      return w.id + " " + (w.usedPercent == null ? "?" : w.usedPercent + "%") + (time == null ? "" : " resets " + time + "m")
    }).join("; ")
    return account.id + " [" + plan + tier + "; " + account.state + (accountIsStale(account, now) ? "; stale" : "") + "] " + windows + (account.error ? " — " + account.error : "")
  })
  return lines.length ? lines.join("\n") : "No readable account connections discovered."
}

/** Resolve account pools, never combine different accounts behind one provider. */
export function accountsForRoute(snapshot: AccountSnapshot, providerID: string, modelID: string): AccountUsage[] {
  return snapshot.accounts.filter(account => account.connections.some(connection => {
    if (!connection.routeProviders.includes(providerID)) return false
    if (connection.modelPrefix && !modelID.startsWith(connection.modelPrefix + "/")) return false
    const model = connection.modelPrefix ? modelID.slice(connection.modelPrefix.length + 1) : modelID
    if (providerID !== "cliproxyapi") return true
    return account.provider === "openai" ? /^gpt-|^o[1-9]/.test(model) :
      account.provider === "claude" ? /^claude-/.test(model) :
      account.provider === "grok" ? /^grok-/.test(model) : false
  }))
}
/** Canonical shared and model-window selection for UI and dispatch. */
export function relevantAccountWindows(account: AccountUsage, modelID: string) {
  const upstreamModel = modelID.includes("/") ? modelID.slice(modelID.indexOf("/") + 1) : modelID
  return account.windows.filter(w => w.scope === "shared" || w.scope === "model" &&
    (w.model === upstreamModel || w.model + "-fast" === upstreamModel || (w.model === "claude-sonnet" || w.model === "claude-opus") && upstreamModel.startsWith(w.model + "-")))
}
export function routeAccountCapacity(snapshot: AccountSnapshot, providerID: string, modelID: string, now = Date.now()) {
  const accounts = accountsForRoute(snapshot, providerID, modelID)
  if (accounts.length !== 1) return { state: "unknown" as const, accountIDs: accounts.map(a => a.id) }
  const account = accounts[0], stale = accountIsStale(account, now)
  const relevant = relevantAccountWindows(account, modelID)
  const resetPending = relevant.some(w => windowNeedsRefresh(w, now))
  const blocked = relevant.some(w => w.state === "exhausted")
  const available = account.state === "available" && relevant.length > 0 && relevant.every(w => w.state === "available")
  return {
    state: stale || resetPending || !!account.error ? "unknown" as const : blocked ? "exhausted" as const : available ? "available" as const : "unknown" as const,
    authenticated: account.state === "auth-required" ? false : account.observedAt && !stale && !account.error ? true : undefined,
    accountIDs: [account.id], windows: relevant,
    resetAt: blocked && relevant.filter(w => w.state === "exhausted").every(w => w.resetAt && Number.isFinite(Date.parse(w.resetAt)))
      ? Math.max(...relevant.filter(w => w.state === "exhausted").map(w => Date.parse(w.resetAt!))) : undefined,
  }
}

/** Bounded context feed; the full ledger stays behind usage_status(format=json). */
export function accountSummaryLine(snapshot: AccountSnapshot, now = Date.now()): string {
  const parts = snapshot.accounts.slice(0, 5).map(a => {
    const plan = (a.plan.name ?? "?") + (a.plan.multiplier ? " " + a.plan.multiplier + "x" : "")
    const windows = a.windows.filter(w => w.scope === "shared").slice(0, 3).map(w => {
      const reset = w.resetAt ? " reset " + Math.max(0, Math.ceil((Date.parse(w.resetAt) - now) / 60000)) + "m" : ""
      return w.label + " " + (w.remainingPercent == null ? "?" : w.remainingPercent + "% left") + reset
    }).join(", ")
    return a.provider + "/" + a.id.slice(-6) + " " + plan + " " + (accountIsStale(a, now) ? "STALE" : a.state) + ": " + windows
  })
  const text = "ACCOUNTS: " + parts.join(" | ") + " — usage_status(format=json)"
  return text.length <= 600 ? text : text.slice(0, 565) + "… usage_status(format=json)"
}
