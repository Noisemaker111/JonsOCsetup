/** Legacy consumers get the same account observations; this module performs no network calls. */
import type { UsageCache, UsageSource } from "./usage-lib"
import { readAccountUsage, accountIsStale, windowNeedsRefresh } from "./account-api"
import type { AccountSnapshot } from "./account-types"

export function projectAccountUsage(cache: UsageCache | undefined, snapshot: AccountSnapshot = readAccountUsage(), now = Date.now()): UsageCache | undefined {
  if (!snapshot.accounts.length) return cache
  const vendorSource = (provider: string) => provider === "claude" ? "claude-code" : provider === "grok" ? "grok-sub" : provider
  const represented = new Set(snapshot.accounts.flatMap(a => a.provider === "openai" ? ["openai", "codex"] : a.provider === "claude" ? ["claude", "claude-code"] : [vendorSource(a.provider)]))
  const oldSources = (cache?.sources ?? []).filter(s => !represented.has(s.id)).map(s => ({ ...s, observedAt: s.observedAt ?? cache?.updated }))
  const sources: UsageSource[] = snapshot.accounts.map(account => {
    const base = vendorSource(account.provider)
    const count = snapshot.accounts.filter(a => a.provider === account.provider).length
    const legacy = cache?.sources.find(s => s.id === base)
    const observed = account.observedAt
    const stale = accountIsStale(account, now)
    const plan = [account.plan.name, account.plan.multiplier ? account.plan.multiplier + "x" : null].filter(Boolean).join(" ")
    const title = [account.provider, plan, account.id.slice(-6)].filter(Boolean).join(" · ")
    return {
      ...legacy,
      id: count === 1 ? base : base + ":" + account.id.slice(-6),
      accountID: account.id, displayName: title, observedAt: observed ?? "",
      kind: "sub", source: "account-api",
      probe: account.error ? account.state === "auth-required" ? "err" : "none" : observed ? "ok" : "none",
      probeDetail: account.error ?? account.connections.map(c => c.owner).join(", "),
      apiCapHit: !stale && account.state === "exhausted",
      windows: account.windows.map(w => ({
        label: w.scope === "shared" ? w.label : w.id,
        usedTokens: 0, used: 0, cap: null, pct: w.usedPercent,
        remaining: w.remainingPercent,
        resetAt: w.resetAt, observedAt: w.observedAt, scope: w.scope, model: w.model,
        resetsInSeconds: w.resetAt ? Math.max(0, Math.ceil((Date.parse(w.resetAt) - now) / 1000)) : null,
        status: stale || windowNeedsRefresh(w, now) ? "unknown" : w.state === "exhausted" ? "cap" : w.state === "available" ? "ok" : "unknown",
        provenance: "provider-observed" as const, estimated: false,
      })),
    }
  })
  return { updated: snapshot.updatedAt, sources: [...sources, ...oldSources], accounts: snapshot }
}
