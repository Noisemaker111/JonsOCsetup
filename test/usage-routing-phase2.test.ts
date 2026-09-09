import { expect, test } from "bun:test"
import { capacitySnapshot, type UsageCache } from "../usage/usage-lib"
import { applyPickedModel, pickAvailableModel, telemetryFromCapacity } from "../models/model-router"
import type { CatalogModel } from "../models/model-catalog"
import { nextHealthyFallback, sourceCapHit } from "../models/model-routing"
import { parseOpenAiWhamUsage } from "../usage/usage-collector"

const updated = "2026-08-30T20:00:00.000Z"
const now = Date.parse(updated) + 60_000
const model = (providerID: string, modelID: string): CatalogModel => ({ providerID, modelID, name: modelID, capabilities: { tools: true, reasoning: true } })
const models = [
  model("openai", "gpt-5.6-luna-fast"),
  model("openai", "gpt-5.6-sol"),
  model("grok-sub", "grok-4.6"),
  { ...model("openrouter", "z-ai/glm-5.3-flash"), priceOutput: 1 },
]
const source = (id: string, pct: number | null, status = "ok", reset = 3600) => ({
  id,
  probe: "ok",
  windows: [{ label: "5h", usedTokens: 0, used: pct ?? 0, cap: null, pct, resetsInSeconds: reset, status, provenance: "provider-observed" as const }],
})

test("newly healthy OpenAI makes Luna the worker default and Sol the planning default", () => {
  const cache: UsageCache = { updated, sources: [source("openai", 30), source("grok-sub", 100, "cap"), source("opencode-go", 100, "cap")] }
  const snapshot = capacitySnapshot(cache, now)
  const telemetry = telemetryFromCapacity(models, snapshot)
  expect(pickAvailableModel("implement and test worker changes", models, telemetry)?.model.modelID).toBe("gpt-5.6-luna-fast")
  expect(pickAvailableModel("orchestrate and plan hard reasoning", models, telemetry)?.model.modelID).toBe("gpt-5.6-sol")
})

test("a healthy subscription prevents a metered OpenRouter route", () => {
  const cache: UsageCache = { updated, sources: [source("openai", 40), source("grok-sub", 100, "cap")] }
  const picked = pickAvailableModel("implement code", models, telemetryFromCapacity(models, capacitySnapshot(cache, now)))
  expect(picked?.model.providerID).toBe("openai")
})

test("confirmed subscription health outranks an unknown subscription during failover", () => {
  const cache: UsageCache = { updated: new Date().toISOString(), sources: [source("openai", 40), { ...source("opencode-go", 100, "cap"), apiCapHit: true }] }
  expect(nextHealthyFallback("opencode-go", cache)).toEqual({ providerID: "openai", modelID: "gpt-5.6-luna-fast" })
})

test("the selected native model reaches worker Task input", () => {
  const telemetry = telemetryFromCapacity(models, capacitySnapshot({ updated, sources: [source("openai", 40)] }, now))
  const worker: Record<string, unknown> = { agent: "build", task: "implement tests" }
  expect(applyPickedModel(worker, models, telemetry)).toBe("openai/gpt-5.6-luna-fast")
  expect(worker.model).toBe("openai/gpt-5.6-luna-fast")
})

test("unknown metrics and reset timestamps alone never establish health", () => {
  const cache: UsageCache = { updated, sources: [{ id: "openai", probe: "ok", windows: [{ label: "5h", usedTokens: 10, used: 10, cap: null, pct: null, resetsInSeconds: 300, provenance: "local-measured" }] }] }
  expect(capacitySnapshot(cache, now).providers.openai.state).toBe("unknown")
})

test("caps expire against collection time and self-heal to unknown pending refresh", () => {
  const active: UsageCache = { updated, sources: [source("grok-sub", 100, "cap", 120)] }
  expect(capacitySnapshot(active, now).providers["grok-sub"]).toMatchObject({ state: "exhausted", resetAt: Date.parse(updated) + 120_000 })
  expect(sourceCapHit("grok-sub", { ...active, updated: new Date(Date.now()).toISOString() }).hit).toBe(true)
  const expired: UsageCache = { updated: new Date(Date.now() - 180_000).toISOString(), sources: [source("grok-sub", 100, "cap", 120)] }
  expect(sourceCapHit("grok-sub", expired).hit).toBe(false)
  expect(capacitySnapshot(expired, Date.now()).providers["grok-sub"].state).toBe("unknown")
})

test("WHAM primary and secondary windows retain official percentages and resets", () => {
  const parsed = parseOpenAiWhamUsage(JSON.stringify({
    plan_type: "plus",
    rate_limit: {
      limit_reached: false,
      primary_window: { limit_window_seconds: 18_000, used_percent: 25, reset_after_seconds: 900 },
      secondary_window: { limit_window_seconds: 604_800, used_percent: 40, reset_after_seconds: 86_400 },
    },
  }))
  expect(parsed).toEqual({
    planType: "plus",
    windows: {
      "5h": { percent: 25, remaining: 75, reset: 900, status: "ok" },
      "7d": { percent: 40, remaining: 60, reset: 86_400, status: "ok" },
    },
  })
})
