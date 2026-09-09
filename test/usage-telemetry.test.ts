import { expect, test } from "bun:test"
import { aggregateTelemetry, normalizeTokens, requestTiming, valueRequest, type RequestRecord } from "../usage/telemetry"
const request = (id: string, sessionID = "parent"): RequestRecord => ({ id, sessionID, kind: "chat", route: { providerID: "test", modelID: "model" }, state: "completed", startedAt: 1000, completedAt: 5000, firstVisibleAt: 2000, lastOutputAt: 4000, tokens: { input: 100, cacheRead: 200, cacheWrite: 50, output: 60, reasoning: 20 }, price: { version: "v1", provider: "test", model: "model", date: "2026-09-05", currency: "USD", perMillion: { input: 2, cacheRead: .5, cacheWrite: 3, output: 8, reasoning: 8 } } })
test("normalization separates cached input and reasoning without double counting", () => {
  expect(normalizeTokens({ input: 350, cacheRead: 200, cacheWrite: 50, output: 80, reasoning: 20 }, { inputIncludesCache: true, outputIncludesReasoning: true })).toEqual(request("a").tokens)
  expect(() => normalizeTokens({ input: 1, cacheRead: 2, cacheWrite: 0 }, { inputIncludesCache: true, outputIncludesReasoning: false })).toThrow("Inconsistent")
})
test("each request uses its versioned rates and missing rates remain unavailable", () => {
  const r = request("a")
  expect(valueRequest(r).value).toBeCloseTo(.00109)
  delete r.price!.perMillion.cacheWrite
  expect(valueRequest(r).value).toBeNull()
  expect(valueRequest(r).missing).toContain("cacheWrite price")
})
test("worker-inclusive totals deduplicate and distinguish overlap from compute time", () => {
  const a = request("a"), b = { ...request("b", "child"), parentID: "parent", startedAt: 3000, completedAt: 7000 }
  const total = aggregateTelemetry([a,a,b], { sessionID: "parent", includeWorkers: true })
  expect(total.requests).toBe(2)
  expect(total.tokens.knownTotals.input).toBe(200)
  expect(total.timing).toEqual({ summedRequestMilliseconds: 8000, activeMilliseconds: 6000, wallMilliseconds: 6000 })
  expect(aggregateTelemetry([a,b], { sessionID: "parent" }).requests).toBe(1)
})
test("throughput uses visible tokens and observed streaming time; nonstreaming stays unknown", () => {
  const r = request("a")
  expect(requestTiming(r).visibleOutputTokensPerSecond).toBe(30)
  delete r.firstVisibleAt; delete r.lastOutputAt
  expect(requestTiming(r).visibleOutputTokensPerSecond).toBeNull()
  expect(requestTiming(r).elapsedMilliseconds).toBe(4000)
})
