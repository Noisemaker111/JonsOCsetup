import { expect, test } from "bun:test"
import { planRoutes, type PlannerInput } from "../models/route-planner"
import example from "./fixtures/routing-19h.json"
const input = () => structuredClone(example) as PlannerInput
const reasons = (value: PlannerInput, id = "claude-code-high") =>
  planRoutes(value).excluded.find(x => x.routeID === id)?.reasons.join("; ") ?? ""

test("19-hour weekly reset prioritizes qualified Claude work over cheaper-list-price alternatives", () => {
  const result = planRoutes(input())
  expect(result.selected?.routeID).toBe("claude-code-high")
  expect(result.selected?.expiryOpportunity).toBeGreaterThan(result.ranked[1].expiryOpportunity)
  expect(result.summary.length).toBeLessThan(240)
})
test("weekly headroom changes urgency even with identical current session headroom", () => {
  const value = input()
  const first = planRoutes(value).selected!.expiryOpportunity
  value.accounts[0].windows[1].remaining = 100
  const second = planRoutes(value).ranked.find(x => x.routeID === "claude-code-high")!.expiryOpportunity
  expect(first).toBeGreaterThan(second)
})
test("every shared window gates admission; session room cannot override a spent week", () => {
  const value = input()
  value.accounts[0].windows[1].remaining = 0
  expect(planRoutes(value).selected?.routeID).toBe("codex-medium")
  expect(reasons(value)).toContain("weekly")
})
test("reserve and in-flight work are subtracted before admitting another task", () => {
  const value = input()
  value.accounts[0].windows[0].reserved = 70
  expect(reasons(value)).toContain("insufficient unreserved quota")
})
test("stale or future quota is never treated as available", () => {
  const value = input()
  value.accounts[0].observedAt = "2026-09-04T11:00:00.000Z"
  expect(reasons(value)).toContain("stale")
  value.accounts[0].observedAt = "2026-09-04T13:00:00.000Z"
  expect(reasons(value)).toContain("invalid")
})
test("crossing a reset requires another observation, not an invented full balance", () => {
  const value = input()
  value.accounts[0].windows[0].resetAt = value.request.now
  expect(reasons(value)).toContain("invalid quota/reset")
})
test("lack of benchmark evidence cannot win just because capacity is expiring", () => {
  const value = input()
  value.routes[0].evidence = []
  expect(reasons(value)).toContain("no evidence")
  expect(planRoutes(value).selected?.routeID).not.toBe("claude-code-high")
})
test("quality floor and quality tolerance precede subscription expiry", () => {
  const value = input()
  value.routes[0].evidence[0].passed = 80
  expect(reasons(value)).toContain("quality floor")
  value.routes[0].evidence[0].passed = 88
  expect(reasons(value)).toContain("quality tolerance")
})
test("a reasoning or harness variant without its own evidence cannot inherit another route's outcomes", () => {
  const value = input()
  value.routes.unshift({ ...structuredClone(value.routes[0]), id: "claude-code-low", reasoning: "low", evidence: [] })
  value.routes.push({ ...structuredClone(value.routes[1]), id: "opencode-medium", harness: "opencode@example", evidence: [] })
  const result = planRoutes(value)
  expect(result.excluded.filter(x => x.reasons.includes("no evidence for this task and exact route"))).toHaveLength(2)
})
test("explicit paid route is preserved within budget and missing routes never fall back", () => {
  const value = input()
  value.request.explicitRouteID = "codex-medium"
  expect(planRoutes(value).selected?.routeID).toBe("codex-medium")
  value.accounts[1].billing = "metered"
  expect(planRoutes(value).selected?.routeID).toBe("codex-medium")
  value.request.explicitRouteID = "missing"
  expect(planRoutes(value).excluded[0].reasons).toContain("explicit route is not registered")
})
test("free models can win when qualified subscription accounts are unavailable", () => {
  const value = input()
  value.accounts[0].capacity = "exhausted"
  value.accounts[1].authenticated = false
  expect(planRoutes(value).selected?.routeID).toBe("free-high")
})
test("unknown task consumption and unknown subscription windows block ranking", () => {
  const value = input()
  delete value.routes[0].quotaPerTask.weekly
  expect(reasons(value)).toContain("consumption")
  value.accounts[0].windows = []
  expect(reasons(value)).toContain("windows are unknown")
})
test("task cost and time include failed attempts; a deadline excludes slow routes", () => {
  const value = input()
  const result = planRoutes(value)
  expect(result.selected?.millisecondsPerSuccess).toBe(100000)
  value.request.maxTaskMilliseconds = 110000
  expect(reasons(value)).toContain("deadline")
  value.routes[1].evidence[0].totalCash = 1
  expect(reasons(value, "codex-medium")).toContain("cash per success")
})
test("newer regressions supersede old wins and expired evidence is rejected", () => {
  const value = input()
  value.routes[0].evidence.push({ ...value.routes[0].evidence[0], measuredAt: "2026-09-04T10:00:00.000Z", passed: 40 })
  expect(reasons(value)).toContain("quality floor")
  value.routes[1].evidence[0].measuredAt = "2025-01-01T00:00:00.000Z"
  expect(reasons(value, "codex-medium")).toContain("evidence is stale")
})
test("shared account routes see the same reservations", () => {
  const value = input()
  value.routes.push({ ...structuredClone(value.routes[0]), id: "claude-other-route" })
  value.accounts[0].windows[0].reserved = 80
  expect(reasons(value, "claude-other-route")).toContain("insufficient unreserved quota")
  expect(reasons(value)).toContain("insufficient unreserved quota")
})
test("malformed policy, duplicate identities, and invalid observations fail closed", () => {
  const value = input()
  value.request.qualityTolerance = NaN
  expect(() => planRoutes(value)).toThrow("Invalid routing request")
  value.request.qualityTolerance = .02
  value.accounts.push(value.accounts[0])
  expect(() => planRoutes(value)).toThrow("Duplicate")
  const other = input()
  other.accounts[0].windows[0].remaining = NaN
  expect(reasons(other)).toContain("invalid quota")
})
test("planner is deterministic and leaves the caller's snapshot untouched", () => {
  const value = input()
  const before = structuredClone(value)
  expect(planRoutes(value)).toEqual(planRoutes(value))
  expect(value).toEqual(before)
})

test("user allowlists survive inventory changes and absolute frontier reserves", () => {
  const value = input()
  value.request.allowedRouteIDs = ["codex-medium"]
  expect(planRoutes(value).selected?.routeID).toBe("codex-medium")
  expect(reasons(value)).toContain("not allowed")
  value.request.allowedRouteIDs = ["claude-code-high"]
  value.request.reserveByAccount = { [value.accounts[0].id]: { [value.accounts[0].windows[0].id]: 100 } }
  expect(planRoutes(value).selected).toBeNull()
})
test("paid-only, subscription-only and free-only selection follow configured routes", () => {
  for (const index of [0, 1, 2]) {
    const value = input()
    if (index === 1) value.accounts[index].billing = "metered"
    value.request.allowedRouteIDs = [value.routes[index].id]
    expect(planRoutes(value).selected?.routeID).toBe(value.routes[index].id)
  }
})

test("only configured admission fallback can replace a primary; explicit runs stay exact",()=>{
 const value=input(),primary=value.routes[0],alternative=value.routes[1];value.request.allowedRouteIDs=[primary.id,alternative.id];value.request.primaryRouteID=primary.id
 expect(planRoutes(value).selected?.routeID).toBe(primary.id)
 value.accounts.find(a=>a.id===primary.accountID)!.capacity="exhausted"
 expect(planRoutes(value).selected).toBeNull()
 value.request.fallback={when:"admission-unavailable",routeIDs:[alternative.id]}
 const result=planRoutes(value);expect(result.selected?.routeID).toBe(alternative.id);expect(result.fallback?.fromRouteID).toBe(primary.id);expect(result.summary).toContain("exhausted")
 value.request.explicitRouteID=primary.id;expect(planRoutes(value).selected).toBeNull()
 delete value.request.explicitRouteID;value.request.fallback.routeIDs.push("new-inventory-model");expect(()=>planRoutes(value)).toThrow("explicitly allowed")
})
test("fixed paid, subscription and free policies survive inventory changes",()=>{
 for(const billing of ["metered","subscription","free"] as const){const value=input(),route=value.routes[0];value.request.allowedRouteIDs=[route.id];value.request.primaryRouteID=route.id;value.accounts.find(a=>a.id===route.accountID)!.billing=billing;expect(planRoutes(value).selected?.routeID).toBe(route.id);value.routes.push({...value.routes[1],id:"new-catalog-route"});expect(planRoutes(value).selected?.routeID).toBe(route.id)}
})
