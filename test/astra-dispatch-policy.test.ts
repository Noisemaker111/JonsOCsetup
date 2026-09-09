import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { configuredDispatchPolicyFile, reserveDispatch } from "../models/dispatch-planner"

const policyFile = join(import.meta.dir, "../models/dispatch-policy.json")
const policy = JSON.parse(readFileSync(policyFile, "utf8"))

test("the planner defaults to its colocated generation policy", () => {
  const previous = process.env.OPENCODE_DISPATCH_POLICY
  delete process.env.OPENCODE_DISPATCH_POLICY
  try { expect(configuredDispatchPolicyFile()).toBe(policyFile) }
  finally { if (previous === undefined) delete process.env.OPENCODE_DISPATCH_POLICY; else process.env.OPENCODE_DISPATCH_POLICY = previous }
})

test("policy authorizes exactly one native OpenAI Astra medium route", () => {
  const matches = policy.routes.filter((route: any) => route.providerID === "openai" && route.modelID === "gpt-6-astra" && route.reasoning === "medium")
  expect(matches).toHaveLength(1)
  expect(matches[0]).toMatchObject({ id: "openai-astra-medium", accountID: "openai-429c9885edc3fc7113fc", harness: "native", agent: "astra", serviceTier: "default", admission: "configured-choice", verified: true })
  expect(matches[0].evidence).toEqual([])
  expect(matches[0].quotaPerTask).toEqual({})
  expect(policy.request.allowedRouteIDs).toContain(matches[0].id)
  expect(policy.request.fallback).toBeUndefined()
})

test("explicit Astra medium resolves without replacing provider, account, agent, or reasoning", async () => {
  const root = mkdtempSync(join(tmpdir(), "astra-policy-"))
  try {
    const selected = await reserveDispatch({ runID: "astra-medium", model: "openai/gpt-6-astra#medium", policyFile, reservationFile: join(root, "holds.json") }, async () => ({
      schema: 1,
      updatedAt: new Date().toISOString(),
      diagnostics: [],
      accounts: [{
        id: "openai-429c9885edc3fc7113fc", provider: "openai", identity: "account",
        connections: [{ id: "native-openai", owner: "opencode", routeProviders: ["openai"], modelPrefix: null }],
        plan: { name: "pro", rateLimitTier: null, multiplier: null, provenance: "provider-observed", observedAt: new Date().toISOString() },
        windows: [
          { id: "shared", label: "7d", scope: "shared", durationSeconds: 604800, usedPercent: 1, remainingPercent: 99, resetAt: new Date(Date.now() + 3600000).toISOString(), observedAt: new Date().toISOString(), state: "available" },
          { id: "model:gpt-6-astra", label: "model:gpt-6-astra", scope: "model", model: "gpt-6-astra", durationSeconds: null, usedPercent: null, remainingPercent: null, resetAt: null, observedAt: new Date().toISOString(), state: "available" },
        ],
        extraUsage: { enabled: null }, state: "available", observedAt: new Date().toISOString(), attemptedAt: new Date().toISOString(), nextAttemptAt: new Date(Date.now() + 30000).toISOString(), failures: 0, error: null, activeConnectionID: "native-openai",
      }],
    } as any))
    expect(selected.route).toMatchObject({ id: "openai-astra-medium", accountID: "openai-429c9885edc3fc7113fc", providerID: "openai", modelID: "gpt-6-astra", reasoning: "medium", agent: "astra" })
    expect(selected.decision.selected?.routeID).toBe("openai-astra-medium")
    expect(selected.ledger.get("astra-medium")).toMatchObject({ accountID: "openai-429c9885edc3fc7113fc", exclusive: true, windows: {} })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("other Astra reasoning levels remain unauthorized", async () => {
  const root = mkdtempSync(join(tmpdir(), "astra-policy-"))
  try {
    await expect(reserveDispatch({ runID: "astra-high", model: "openai/gpt-6-astra#high", policyFile, reservationFile: join(root, "holds.json") }, async () => ({ schema: 1, updatedAt: new Date().toISOString(), accounts: [], diagnostics: [] }) as any)).rejects.toThrow("AUTHORIZED_ROUTE_UNAVAILABLE")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
