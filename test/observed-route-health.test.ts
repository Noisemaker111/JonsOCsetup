/**
 * @core-prevents a model that fails every request it is given staying an eligible candidate
 * @core-observed September 16: cliproxyapi/gpt-5.6-luna#max failed 53 requests across 17 sessions
 * between 00:04 and 10:05, and the OpenAI account failed all 28 of its own — 81 requests to routes that
 * could not answer, in one day. Nothing stopped it. The only writer of route-health.json is
 * scripts/route-preflight.ts, run by hand; that file was recorded 2026-09-12T01:50Z, so the six-hour
 * bound in unusableRoutes() discarded it whole, including the eight routes it already called unusable.
 * Every one of those failures was in the telemetry ledger and none of it reached selection.
 */
import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { failingModels, recentRequests } from "../models/observed-route-health"

const now = Date.parse("2026-09-16T10:30:00.000Z")
const at = (minutesAgo: number) => now - minutesAgo * 60_000
const request = (id: string, model: string, state: string, startedAt: number, providerID = "cliproxyapi") =>
  ({ id, sessionID: "ses_" + id, route: { providerID, modelID: model, variant: "max" }, kind: "primary", state, startedAt, tokens: {} }) as any

test("a model whose recent requests all failed is named unusable, with the count and the time", () => {
  const failing = failingModels([request("a", "gpt-5.6-luna", "failed", at(30)), request("b", "gpt-5.6-luna", "failed", at(20)), request("c", "gpt-5.6-luna", "failed", at(10))], now)

  const observed = failing.get("cliproxyapi/gpt-5.6-luna")!
  expect(observed).toBeDefined()
  expect(observed.failures).toBe(3)
  expect(observed.reason).toContain("3 most recent requests on this model failed")
  expect(observed.reason).toContain("2026-09-16T10:20:00.000Z")
})

test("one success clears it, so a route recovers without anyone editing a file", () => {
  const rows = [request("a", "gpt-5.6-luna", "failed", at(30)), request("b", "gpt-5.6-luna", "failed", at(20)), request("c", "gpt-5.6-luna", "failed", at(15)), request("d", "gpt-5.6-luna", "completed", at(5))]
  expect(failingModels(rows, now).has("cliproxyapi/gpt-5.6-luna")).toBe(false)
})

test("a couple of failures is not a verdict", () => {
  expect(failingModels([request("a", "gpt-5.6-luna", "failed", at(20)), request("b", "gpt-5.6-luna", "failed", at(10))], now).size).toBe(0)
})

test("failures older than the window say nothing about the route now", () => {
  const old = [request("a", "gpt-5.6-luna", "failed", at(7 * 60)), request("b", "gpt-5.6-luna", "failed", at(8 * 60)), request("c", "gpt-5.6-luna", "failed", at(9 * 60))]
  expect(failingModels(old, now).size).toBe(0)
})

test("an interrupt is neither a failure nor a success", () => {
  // A turn the host ended says nothing about whether the provider would have answered.
  const rows = [request("a", "gpt-5.6-luna", "interrupted", at(30)), request("b", "gpt-5.6-luna", "interrupted", at(20)), request("c", "gpt-5.6-luna", "interrupted", at(10))]
  expect(failingModels(rows, now).size).toBe(0)
})

test("the running row is not counted twice against its own terminal row", () => {
  const rows = [request("a", "gpt-5.6-luna", "running", at(30)), request("a", "gpt-5.6-luna", "failed", at(30)),
                request("b", "gpt-5.6-luna", "running", at(20)), request("b", "gpt-5.6-luna", "failed", at(20))]
  // Two real requests, four rows: still below the minimum.
  expect(failingModels(rows, now).size).toBe(0)
})

test("models are judged separately", () => {
  const rows = [request("a", "gpt-5.6-luna", "failed", at(30)), request("b", "gpt-5.6-luna", "failed", at(20)), request("c", "gpt-5.6-luna", "failed", at(10)),
                request("d", "deepseek-v4.1-flash", "completed", at(9), "opencode-go")]
  const failing = failingModels(rows, now)
  expect([...failing.keys()]).toEqual(["cliproxyapi/gpt-5.6-luna"])
})

test("the ledger is read from its tail, and a half line at the boundary is dropped", () => {
  const file = join(mkdtempSync(join(tmpdir(), "observed-health-")), "requests.jsonl")
  const rows = Array.from({ length: 200 }, (_, i) => JSON.stringify({ version: 1, request: request("r" + i, "gpt-5.6-luna", "failed", at(1)) }))
  writeFileSync(file, rows.join("\n") + "\n")

  const all = recentRequests(file)
  expect(all.length).toBe(200)

  const tail = recentRequests(file, 400)
  expect(tail.length).toBeGreaterThan(0)
  expect(tail.length).toBeLessThan(200)
  // Every record that survives the cut is complete; nothing is half-parsed into a wrong route.
  for (const record of tail) expect(record.route.modelID).toBe("gpt-5.6-luna")
})
