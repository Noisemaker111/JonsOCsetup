import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  derivePctFromCap,
  predictWindowExhaustion,
  readUsageCache,
  singleFlight,
  writeJsonAtomic,
} from "../usage/usage-collector"

test("subscription percentages remain unknown without provider data", () => {
  expect(derivePctFromCap("openai")).toBe(false)
  expect(derivePctFromCap("cursor")).toBe(false)
  expect(derivePctFromCap("grok-sub")).toBe(false)
  expect(derivePctFromCap("claude")).toBe(false)
  expect(derivePctFromCap("xai")).toBe(true)
})

test("cache reads expose bounded age and reject clock skew", () => {
  const dir = mkdtempSync(join(process.env.TEMP ?? ".", "usage-test-"))
  const path = join(dir, "cache.json")
  try {
    writeJsonAtomic(path, { updated: "2026-08-28T00:00:00.000Z", sources: [] })
    expect(readUsageCache(path, Date.parse("2026-08-28T00:05:00.000Z"))?.stale).toBe(false)
    expect(readUsageCache(path, Date.parse("2026-08-28T00:16:00.000Z"))?.stale).toBe(true)
    writeJsonAtomic(path, { updated: "2026-08-28T01:00:00.000Z", sources: [] })
    expect(readUsageCache(path, Date.parse("2026-08-28T00:00:00.000Z"))?.stale).toBe(true)
    expect(JSON.parse(readFileSync(path, "utf8")).sources).toEqual([])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("single-flight coalesces concurrent refreshes and propagates failures", async () => {
  let calls = 0
  const task = () => singleFlight("test-refresh", async () => { calls++; await Bun.sleep(5); return 42 })
  expect(await Promise.all([task(), task(), task()])).toEqual([42, 42, 42])
  expect(calls).toBe(1)
})

test("forecast reports horizon only when a measured rate and provider percentage exist", () => {
  const unknown = predictWindowExhaustion({ used: 10, now: 10_000, windowMs: 18_000, pct: null })
  expect(unknown.state).toBe("unknown")
  const forecast = predictWindowExhaustion({ used: 50, priorPct: 25, priorResetAt: 30000, resetAt: 30000, priorAt: 0, now: 10_000, windowMs: 18_000, pct: 50 })
  expect(predictWindowExhaustion({used:50,priorUsed:25,priorAt:0,now:10000,windowMs:18000,pct:50}).state).toBe("unknown")
  expect(forecast.horizonSeconds).toBe(20)
  expect(forecast.basis).toBe("provider-rate")
})
