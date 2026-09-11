/**
 * @core-prevents an unclassified or cheaply-classified dispatch silently buying a cheaper reasoning effort, and a route with no recorded turns ranking as if it were the cheapest
 * @core-observed Every dispatch sent task "coding" and ranked on pass@1 alone, so automatic selection could only ever pick the top of each model's effort curve: a 16m53s Quest Giver session on 2026-09-11 spent 4m39s (28%) in reasoning whether it was planning a Quest or deciding to call `quest get`.
 */
import { test, expect } from "bun:test"
import { planRoutes, type Account, type Route, type RouteCost } from "../models/route-planner"
import { classifyDispatch, applyTaskDemand, DEFAULT_TASK } from "../models/task-demand"

const base = { accountID: "go", harness: "native", serviceTier: "default", verified: true, admission: "benchmark-ranked" as const, evidence: [], quotaPerTask: {} }
const prior = (passAt1: number, effort: string) =>
  ({ suite: "DeepSWE", passAt1, effort, provenance: "independent" as const, source: "https://example.invalid", measuredAt: "2026-09-03" })
const cost = (reasoningTokensPerTurn: number, cacheReadRate = 0.5): RouteCost =>
  ({ source: "host.db", observedAt: "2026-09-10T00:00:00Z", turns: 200, reasoningTokensPerTurn, outputTokensPerTurn: 400, sentTokensPerTurn: 20000, cacheReadRate })

// One model at three published efforts, mirroring the shape of the real board: the curve is nearly
// flat at the top and the cheap tier still scores respectably. A second, weaker model exists so the
// tolerance is doing real work rather than trivially admitting everything.
const routes: Route[] = [
  { ...base, id: "astra-xhigh", providerID: "openai", modelID: "gpt-6-astra", reasoning: "xhigh", benchmark: prior(0.7412, "xhigh"), cost: cost(240) },
  { ...base, id: "astra-medium", providerID: "openai", modelID: "gpt-6-astra", reasoning: "medium", benchmark: prior(0.7279, "medium"), cost: cost(68.9) },
  { ...base, id: "astra-low", providerID: "openai", modelID: "gpt-6-astra", reasoning: "low", benchmark: prior(0.6704, "low"), cost: cost(6.2) },
  // Published numbers collapse below max on this one, exactly as gpt-5.6-luna does on the live board.
  { ...base, id: "luna-low", providerID: "openai", modelID: "gpt-5.6-luna", reasoning: "low", benchmark: prior(0.0155, "low"), cost: cost(0.1) },
]
const accounts: Account[] = [{ id: "go", billing: "subscription", authenticated: true, observedAt: "2026-09-10T00:00:00Z", capacity: "available", windows: [{ id: "rolling", remaining: 90, reserved: 0, resetAt: "2026-09-10T05:00:00Z" }] }]
const request = {
  task: "coding" as const, now: "2026-09-10T00:00:30Z", minSuccessRate: 0.9, minTrials: 5, qualityTolerance: 0.02,
  maxUsageAgeSeconds: 120, maxEvidenceAgeDays: 30, reserveFraction: 0, subscriptionConcurrency: "unlimited" as const,
  allowedRouteIDs: routes.map(r => r.id),
}
const demands = { planning: { qualityTolerance: 0 }, coding: { qualityTolerance: 0.02 }, review: { qualityTolerance: 0.1 }, utility: { qualityTolerance: 0.2 } }
const selectFor = (task: Parameters<typeof applyTaskDemand>[2], overrides: Partial<typeof request> = {}) =>
  planRoutes({ request: { ...applyTaskDemand(request, demands, task), ...overrides }, accounts, routes })

test("the task class decides how much of the effort curve is admitted, and the cheap tier is never free", () => {
  // Planning takes the top of the curve; nothing cheaper is even admitted.
  expect(selectFor("planning").selected!.routeID).toBe("astra-xhigh")
  // A routine class admits the cheap tier and then takes it, because it bills 6.2 reasoning tokens
  // a turn against 240 -- and it is still a 67% route, which is the only reason it qualified.
  expect(selectFor("review").selected!.routeID).toBe("astra-low")
  // The collapsed model is the control: widening the tolerance must not turn "cheapest recorded"
  // into "cheapest at any published score". Its 1.55% never clears any class's demand.
  for (const task of ["planning", "coding", "review", "utility"] as const) {
    expect(selectFor(task).selected!.routeID).not.toBe("luna-low")
  }
})

test("an unclassified dispatch gets the default demand, and only a stated or enforced fact buys a cheaper one", () => {
  expect(classifyDispatch({}).task).toBe(DEFAULT_TASK)
  expect(classifyDispatch({ questKind: "feature" }).task).toBe(DEFAULT_TASK)
  // A read-only run cannot edit or run commands, so its class comes from the enforced access mode.
  expect(classifyDispatch({ readOnly: true }).task).toBe("review")
  // The Quest kind is a regex fallback, so it is only ever read in the tightening direction.
  expect(classifyDispatch({ questKind: "investigation" }).task).toBe("planning")
  // A stated class must be one of the four; an unrecognised one fails closed instead of defaulting.
  expect(classifyDispatch({ task: "Utility" }).task).toBe("utility")
  expect(() => classifyDispatch({ task: "cheap" })).toThrow(/Unknown task class/)
  // Unclassified must not be able to reach the cheap tier that `review` reaches above.
  expect(selectFor(classifyDispatch({}).task).selected!.routeID).toBe("astra-medium")
})

test("a route with no recorded turns ranks behind every route that has some, and an explicit choice is untouched", () => {
  const unrecorded: Route[] = routes.map(r => r.id === "astra-low" ? { ...r, cost: undefined } : r)
  const decision = planRoutes({ request: applyTaskDemand(request, demands, "review"), accounts, routes: unrecorded })
  // Unknown consumption is not a zero-cost forecast: astra-low no longer wins on price, and the
  // cheapest route that has actually run does.
  expect(decision.selected!.routeID).toBe("astra-medium")
  expect(decision.ranked.map(c => c.routeID)).toEqual(["astra-medium", "astra-xhigh", "astra-low"])

  // Naming a route is its own authorization. No demand, tolerance or cost ranking substitutes it.
  const named = planRoutes({ request: { ...applyTaskDemand(request, demands, "utility"), explicitRouteID: "luna-low" }, accounts, routes })
  expect(named.selected!.routeID).toBe("luna-low")
  // And a route probed unusable stays excluded however cheap its recorded turns are.
  const probed = planRoutes({
    request: applyTaskDemand(request, demands, "review"), accounts,
    routes: routes.map(r => r.id === "astra-low" ? { ...r, verified: false, outcomeIssue: { task: "review" as const, reason: "Probed unusable" } } : r),
  })
  expect(probed.selected!.routeID).toBe("astra-medium")
  expect(probed.excluded.find(x => x.routeID === "astra-low")!.reasons.join()).toContain("Probed unusable")
})
