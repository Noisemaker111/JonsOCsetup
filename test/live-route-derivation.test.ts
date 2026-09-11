/**
 * @core-prevents a derived route reaching dispatch without a connected account, catalog entry, access-policy permission, billing or benchmark
 * @core-observed Live derivation replaced the hand-typed allowlist; each of the five sources must stay a veto (2026-09-10, PR41).
 */
import { test, expect } from "bun:test"
import { join } from "node:path"
// Derivation reads the user's installed access policy, and fails closed to no candidates when it
// cannot. Point it at this repository's own policy so the check is about the veto rules and not
// about whose home directory the checkout happens to sit in.
process.env.OPENCODE_ACCESS_POLICY = join(import.meta.dir, "..", "models", "access-policy.json")
import { readBenchmarkTable } from "../models/benchmark-table"
import { deriveBenchmarkRoutes } from "../models/live-routes"
import { planRoutes, type Account, type Route } from "../models/route-planner"
import type { AccountSnapshot } from "../usage/account-types"

const account = (id: string, provider: any, routeProviders: string[]) => ({
  id, provider, identity: "account" as const, connections: [{ id: id + "-c", owner: "opencode" as const, routeProviders, modelPrefix: null }],
  plan: { name: null, rateLimitTier: null, multiplier: null, provenance: "unknown" as const, observedAt: null },
  windows: [], extraUsage: { enabled: null }, state: "available" as const, observedAt: new Date().toISOString(),
  attemptedAt: null, nextAttemptAt: null, failures: 0, error: null,
})
const snapshot = { schema: 1, updatedAt: "", diagnostics: [], accounts: [account("go", "opencode-go", ["opencode-go"]), account("router", "openrouter", ["openrouter"])] } as unknown as AccountSnapshot

/** The routing table is live data the router acts on, so a malformed edit must fail loudly here. */
test("benchmarks.md is the routing table, and every entry states where its number came from", () => {
  const table = readBenchmarkTable()
  expect(table.entries.length).toBeGreaterThan(5)
  const deepseek = table.entries.find(e => e.id === "deepseek-v4.1-flash")!
  expect(deepseek.provenance).toBe("vendor")
  expect(deepseek.passAt1.unstated).toBeCloseTo(0.742, 5)
  for (const entry of table.entries) expect(entry.source).toMatch(/^https:\/\//)
})

test("a live candidate needs the access policy, one connected account, known billing and a published score", () => {
  const table = readBenchmarkTable()
  const catalog = [
    { providerID: "opencode-go", modelID: "deepseek-v4.1-flash", efforts: ["low", "high", "max"] },
    { providerID: "opencode-go", modelID: "kimi-k3", efforts: ["max"] },
    { providerID: "opencode-go", modelID: "hy4-preview", efforts: ["max"] },
    // Permitted identity, live model, real account -- but nobody has published a score for it.
    { providerID: "openrouter", modelID: "glm-5.3", efforts: ["max"] },
  ]
  const derived = deriveBenchmarkRoutes({ catalog, table, snapshot, policy: { routes: [], billing: { go: "subscription" } } })
  const identities = derived.routes.map(r => r.providerID + "/" + r.modelID + "#" + r.reasoning)
  // openrouter is outside access-policy.json; hy4-preview has no benchmark row; both are vetoed.
  expect(identities.sort()).toEqual(["opencode-go/deepseek-v4.1-flash#max", "opencode-go/kimi-k3#max"])
  // A vendor headline with no stated effort is attributed to the highest effort, never a cheap one.
  const deepseek = derived.routes.find(r => r.modelID === "deepseek-v4.1-flash")!
  expect(deepseek.benchmark!.provenance).toBe("vendor")
  expect(deepseek.benchmark!.attribution).toContain("highest effort")
  // An identity the policy already curates keeps its curated route instead of gaining a twin.
  const curated = { accountID: "go", providerID: "opencode-go", modelID: "kimi-k3", reasoning: "max" } as Route
  expect(deriveBenchmarkRoutes({ catalog, table, snapshot, policy: { routes: [curated], billing: { go: "subscription" } } })
    .routes.some(r => r.modelID === "kimi-k3")).toBe(false)
})

test("published priors rank only what has nothing measured, and never override a named route", () => {
  const base = { accountID: "go", harness: "native", serviceTier: "default", verified: true, admission: "benchmark-ranked" as const, evidence: [], quotaPerTask: {} }
  const prior = (passAt1: number, provenance: "independent" | "vendor" = "independent") =>
    ({ suite: "DeepSWE", passAt1, effort: "max", provenance, source: "https://example.invalid", measuredAt: "2026-09-03" })
  const routes: Route[] = [
    { ...base, id: "weak", providerID: "opencode-go", modelID: "a", reasoning: "max", benchmark: prior(0.60) },
    { ...base, id: "strong", providerID: "opencode-go", modelID: "b", reasoning: "max", benchmark: prior(0.74) },
    { ...base, id: "floor", providerID: "opencode-go", modelID: "c", reasoning: "max", benchmark: prior(0.30) },
  ]
  const accounts: Account[] = [{ id: "go", billing: "subscription", authenticated: true, observedAt: "2026-09-10T00:00:00Z", capacity: "available", windows: [{ id: "rolling", remaining: 90, reserved: 0, resetAt: "2026-09-10T05:00:00Z" }] }]
  const request = { task: "coding" as const, now: "2026-09-10T00:00:30Z", minSuccessRate: 0.9, minTrials: 5, qualityTolerance: 0.02, maxUsageAgeSeconds: 120, maxEvidenceAgeDays: 30, minBenchmarkPassAt1: 0.5, reserveFraction: 0, subscriptionConcurrency: "unlimited" as const, allowedRouteIDs: ["weak", "strong", "floor"] }

  const ranked = planRoutes({ request, accounts, routes })
  expect(ranked.selected!.routeID).toBe("strong")
  expect(ranked.excluded.find(x => x.routeID === "floor")!.reasons.join()).toContain("below the task floor")

  // Naming a route is its own authorization: the floor does not veto it and nothing replaces it.
  const named = planRoutes({ request: { ...request, explicitRouteID: "floor" }, accounts, routes })
  expect(named.selected!.routeID).toBe("floor")

  // Anything measured on this exact route wins the field; a public prior is not compared to it.
  const measured: Route[] = [...routes, { ...base, id: "measured", providerID: "opencode-go", modelID: "d", reasoning: "max", quotaPerTask: { rolling: 1 },
    evidence: [{ task: "coding", source: "local", measuredAt: "2026-09-09T00:00:00Z", trials: 10, passed: 10, totalMilliseconds: 1000, totalCash: null, p95Milliseconds: 200 }] }]
  const withMeasured = planRoutes({ request: { ...request, allowedRouteIDs: [...request.allowedRouteIDs, "measured"] }, accounts, routes: measured })
  expect(withMeasured.selected!.routeID).toBe("measured")
  expect(withMeasured.excluded.find(x => x.routeID === "strong")!.reasons.join()).toContain("only a published benchmark prior")
})
