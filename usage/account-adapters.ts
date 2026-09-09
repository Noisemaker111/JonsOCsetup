import type { Connection } from "./account-connections"
import type { AccountPlan, AccountWindow, AccountUsage } from "./account-types"
export type Observation = { windows: AccountWindow[]; plan?: AccountPlan; extraUsage?: { enabled: boolean | null } }
export type ProbeFailure = { state: AccountUsage["state"]; error: string; retryAfterSeconds?: number }
const num = (x: unknown): number | null => typeof x === "number" && Number.isFinite(x) ? x : null
const pct = (x: unknown) => { const n = num(x); return n != null && n >= 0 && n <= 100 ? n : null }
const iso = (x: unknown): string | null => {
  const n = typeof x === "number" ? x * (x < 1e12 ? 1000 : 1) : typeof x === "string" ? Date.parse(x) : NaN
  return Number.isFinite(n) && Math.abs(n) < 8.64e15 ? new Date(n).toISOString() : null
}
export function durationLabel(seconds: number | null, fallback: string): string {
  if (!seconds || seconds <= 0) return fallback
  if (seconds % 86400 === 0) return seconds / 86400 + "d"
  if (seconds % 3600 === 0) return seconds / 3600 + "h"
  if (seconds % 60 === 0) return seconds / 60 + "m"
  return seconds + "s"
}
function window(id: string, row: any, now: number, scope: AccountWindow["scope"], duration: number | null, model?: string): AccountWindow {
  const used = pct(row.used_percent ?? row.utilization ?? row.percent)
  const remaining = pct(row.remaining_percent ?? row.percent_left) ?? (used == null ? null : 100 - used)
  const reset = iso(row.reset_at ?? row.resets_at ?? row.resetsAt ?? row.available_at) ??
    (num(row.reset_after_seconds) != null && row.reset_after_seconds >= 0 ? new Date(now + row.reset_after_seconds * 1000).toISOString() : null)
  const cap = row.available === false || row.limit_reached === true || row.allowed === false || row.status === "rate-limited" || row.status === "cap" || used === 100 || remaining === 0
  return { id, label: durationLabel(duration, id), scope, ...(model ? { model } : {}), durationSeconds: duration,
    usedPercent: used ?? (remaining == null ? null : 100 - remaining), remainingPercent: remaining, resetAt: reset,
    observedAt: new Date(now).toISOString(), state: cap ? "exhausted" : row.available === true || used != null || remaining != null ? "available" : "unknown" }
}
export function parseOpenAIAccountUsage(body: any, now: number): Observation {
  const windows: AccountWindow[] = []
  const add = (limits: any, prefix: string, scope: AccountWindow["scope"], model?: string) => {
    if (!limits || typeof limits !== "object") return
    const entries = [["primary", limits.primary_window], ["secondary", limits.secondary_window],
      ...(Array.isArray(limits.windows) ? limits.windows.map((w: any, i: number) => ["window-" + i, w]) : [])]
    for (const [id, value] of entries) if (value && typeof value === "object") {
      const row = window(prefix + ":" + id, value, now, scope, num(value.limit_window_seconds ?? value.window_seconds), model)
      windows.push(row)
    }
    // A top-level cap without percentages must not disappear; do not mark every
    // healthy subwindow exhausted when only the enclosing product is blocked.
    if (limits.limit_reached === true || limits.allowed === false) windows.push(window(prefix + ":status", { limit_reached: true }, now, scope, null, model))
  }
  add(body.rate_limit ?? body.rate_limits, "shared", "shared")
  add(body.code_review_rate_limit, "code-review", "feature")
  for (const [index, entry] of (Array.isArray(body.additional_rate_limits) ? body.additional_rate_limits : []).entries()) {
    const model = typeof entry.normal_model_slug === "string" ? entry.normal_model_slug : typeof entry.limit_name === "string" && /^gpt-[0-9]/i.test(entry.limit_name) ? entry.limit_name.toLowerCase() : undefined
    add(entry.rate_limit, "additional:" + (entry.metered_feature ?? entry.limit_name ?? index), model ? "model" : "feature", model)
  }
  // Preserve model-specific limits without assigning them to the whole account.
  for (const [model, value] of Object.entries(body.model_usage ?? {})) {
    const row = value as any
    if (row && typeof row === "object") {
      if (row.rate_limit || row.primary_window) add(row.rate_limit ?? row, "model:" + model, "model", model)
      else if (["used_percent", "utilization", "percent_left", "remaining_percent", "limit_reached", "available"].some(k => k in row)) windows.push(window("model:" + model, row, now, "model", num(row.limit_window_seconds), model))
    }
  }
  const plan = typeof body.plan_type === "string" ? { name: body.plan_type, rateLimitTier: null, multiplier: null, provenance: "provider-observed" as const, observedAt: new Date(now).toISOString() } : undefined
  return { windows, plan, extraUsage: { enabled: null } }
}
export function parseClaudeAccountUsage(body: any, now: number): Observation {
  const windows: AccountWindow[] = []
  for (const [id, value] of Object.entries(body)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    const row = value as any
    if (!("utilization" in row) && !("resets_at" in row)) continue
    if (id === "extra_usage") continue
    const shared = id === "five_hour" || id === "seven_day"
    const scope = shared ? "shared" : /sonnet|opus/.test(id) ? "model" : "unknown"
    const duration = id === "five_hour" ? 18000 : id.startsWith("seven_day") ? 604800 : null
    windows.push(window(id, row, now, scope, duration, /sonnet/.test(id) ? "claude-sonnet" : /opus/.test(id) ? "claude-opus" : undefined))
  }
  return { windows, extraUsage: { enabled: typeof body.extra_usage?.is_enabled === "boolean" ? body.extra_usage.is_enabled : null } }
}
export function parseClaudePlan(profile: any, now: number): AccountPlan | undefined {
  const tier = typeof profile.organization?.rate_limit_tier === "string" ? profile.organization.rate_limit_tier : null
  const name = profile.account?.has_claude_max === true ? "max" : profile.account?.has_claude_pro === true ? "pro" : null
  if (!tier && !name) return undefined
  return { name, rateLimitTier: tier, multiplier: tier?.match(/(?:^|_)(5|20)x(?:_|$)/) ? Number(tier.match(/(?:^|_)(5|20)x(?:_|$)/)![1]) : null,
    provenance: "provider-observed", observedAt: new Date(now).toISOString() }
}
export function parseGoAccountUsage(body: any, now: number): Observation {
  const windows = Object.entries(body.usage ?? {}).flatMap(([id, row]: [string, any]) => row && typeof row === "object"
    ? [window(id, row, now, ["rolling", "weekly", "monthly"].includes(id) ? "shared" : "unknown",
      id === "rolling" ? 18000 : id === "weekly" ? 604800 : null)] : [])
  return { windows, plan: typeof body.plan === "string" ? { name: body.plan, rateLimitTier: null, multiplier: null, provenance: "provider-observed", observedAt: new Date(now).toISOString() } : undefined }
}
export async function probeConnection(connection: Connection, opts: { now: () => number; fetch: typeof fetch; refreshPlan: boolean }): Promise<Observation | ProbeFailure> {
  if (connection.provider === "grok") return { state: "unsupported", error: "Connected account discovered; no verified Grok subscription-usage adapter." }
  // Fixed provider origins and paths. No caller-supplied URL and no redirects.
  const url = connection.provider === "openai" ? "https://chatgpt.com/backend-api/wham/usage" :
    connection.provider === "claude" ? "https://api.anthropic.com/api/oauth/usage" : "https://opencode.ai/zen/go/v1/usage"
  const token = connection.token()
  if (!token) return { state: "auth-required", error: "Credential unavailable; refresh through its existing owner." }
  const headers: Record<string, string> = { Authorization: "Bearer " + token, Accept: "application/json" }
  if (connection.provider === "openai") {
    if (!connection.upstreamAccountID) return { state: "auth-required", error: "OAuth account identity unavailable; refresh through its existing owner." }
    headers["ChatGPT-Account-Id"] = connection.upstreamAccountID
  }
  if (connection.provider === "claude") headers["anthropic-beta"] = "oauth-2025-04-20"
  const request = (target: string) => opts.fetch(target, { headers, redirect: "error", signal: AbortSignal.timeout(7000) })
  try {
    const response = await request(url)
    if (!response.ok) {
      const retry = response.headers.get("retry-after")
      const seconds = retry ? Number(retry) : NaN
      const retryAfterSeconds = Number.isFinite(seconds) ? Math.min(300, Math.max(0, seconds)) : retry && Number.isFinite(Date.parse(retry)) ? Math.min(300, Math.max(0, (Date.parse(retry) - opts.now()) / 1000)) : undefined
      return { state: response.status === 401 || response.status === 403 ? "auth-required" : "unknown",
        error: "Usage endpoint HTTP " + response.status + (response.status === 401 || response.status === 403 ? "; refresh through the existing credential owner." : ""),
        retryAfterSeconds }
    }
    const body = await response.json() as any
    if (!body || typeof body !== "object" || Array.isArray(body)) return { state: "unknown", error: "Usage endpoint returned an invalid schema." }
    if (connection.provider === "openai" && typeof body.account_id === "string" && body.account_id !== connection.upstreamAccountID) return { state: "unknown", error: "Usage response account identity does not match the selected connection." }
    const now = opts.now()
    const observation = connection.provider === "openai" ? parseOpenAIAccountUsage(body, now) : connection.provider === "claude" ? parseClaudeAccountUsage(body, now) : parseGoAccountUsage(body, now)
    if (!observation.windows.length) return { state: "unknown", error: "Usage endpoint returned no recognized windows." }
    if (connection.provider === "claude" && opts.refreshPlan) {
      try {
        const profile = await request("https://api.anthropic.com/api/oauth/profile")
        if (profile.ok) observation.plan = parseClaudePlan(await profile.json(), opts.now())
      } catch { /* A profile outage must not discard valid usage. */ }
    }
    return observation
  } catch { return { state: "unknown", error: "Usage endpoint unavailable or response invalid." } }
}
