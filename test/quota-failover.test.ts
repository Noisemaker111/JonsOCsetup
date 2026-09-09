/**
 * Provider-cap matrix: rewrite Task agent/model at execute.before.
 * Quota is not a model failure — never throw, never unfavorite.
 */
import { beforeEach, expect, test } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  drainFailoverNotices,
  failoverSystemParts,
  spawnFailoverBefore,
  nextHealthyFallback,
  providerCapBlocked,
  rememberFailoverNotice,
  sourceCapHit,
  capResetAt,
} from "../models/model-routing.ts"
import { windowCapped } from "../usage/usage-lib.ts"

/**
 * Every case starts from clean lane state.
 *
 * A capped provider now gets its lane blocked whatever it is; that used to
 * happen only for opencode-go. So one case's failover was silently deciding
 * the next case's fallback — the xai case "expected" grok-sub only because
 * nothing had ever blocked grok-sub before it ran.
 */
beforeEach(() => {
  const file = process.env.OPENCODE_CAPACITY_FILE
  if (file) try { rmSync(file, { force: true }) } catch {}
})

const HERE = dirname(fileURLToPath(import.meta.url))
const JSONC = readFileSync(join(HERE, "..", "opencode.jsonc"), "utf8")
const TWIN_KEYS = [
  "openrouter/z-ai/glm-5.3-flash",
  "openrouter/meta/muse-spark-1.2-contributor",
  "openrouter/moonshotai/kimi-k3",
  "openrouter/x-ai/grok-4.6",
]

function host(input: Record<string, unknown>) {
  return { tool: "task", sessionID: "ses_test", agent: "quest-giver", id: "call_test", input }
}

function win(label: string, w: { status?: string; pct?: number | null; used?: number; cap?: number | null; estimated?: boolean }) {
  return {
    label,
    usedTokens: 0,
    used: w.used ?? 0,
    cap: w.cap ?? null,
    pct: w.pct ?? null,
    resetsInSeconds: null,
    status: w.status,
    estimated: w.estimated,
  }
}

function usage(sources: Array<{ id: string; status?: string; pct?: number; estimated?: boolean; apiCapHit?: boolean }>) {
  return {
    updated: new Date().toISOString(),
    sources: sources.map((s) => ({
      id: s.id,
      windows: [win("5h", { status: "ok", pct: 10, used: 1, cap: 12 }), win("7d", { status: s.status, pct: s.pct, used: 30, cap: 30, estimated: s.estimated }), win("30d", { status: "ok", pct: 20, used: 12, cap: 60 })],
      apiCapHit: s.apiCapHit,
    })),
  }
}

test("sourceCapHit: missing source is not a cap; estimated-only 100% is not a cap", () => {
  expect(sourceCapHit("openai", usage([{ id: "opencode-go", status: "ok", pct: 10 }])).hit).toBe(false)
  expect(sourceCapHit("grok-sub", usage([{ id: "grok-sub", status: "ok", pct: 100, estimated: true }])).hit).toBe(false)
  expect(sourceCapHit("grok-sub", usage([{ id: "grok-sub", status: "rate-limited", pct: 100 }])).hit).toBe(true)
  expect(windowCapped(win("7d", { pct: 100, used: 30, cap: 30, estimated: true }))).toBe(false)
})

test("providerCapBlocked: xai always; others follow hard caps only", () => {
  expect(providerCapBlocked("xai")).toBe(true)
  const weekly = usage([{ id: "opencode-go", status: "rate-limited", pct: 100 }])
  expect(providerCapBlocked("opencode-go", weekly)).toBe(true)
  expect(providerCapBlocked("grok-sub", weekly)).toBe(false)
})

test("nextHealthyFallback: grok then luna then Muse-free; never xai", () => {
  const ok = usage([{ id: "opencode-go", status: "ok", pct: 10 }])
  const both = usage([
    { id: "grok-sub", status: "rate-limited", pct: 100 },
    { id: "openai", status: "rate-limited", pct: 100 },
  ])
  expect(nextHealthyFallback("opencode-go", ok)).toEqual({ providerID: "cliproxyapi", modelID: "grok-4.6" })
  expect(nextHealthyFallback("openai", ok)).toEqual({ providerID: "cliproxyapi", modelID: "grok-4.6" })
  expect(nextHealthyFallback("grok-sub", ok)).toEqual({ providerID: "openai", modelID: "gpt-5.6-luna-fast" })
  expect(nextHealthyFallback("opencode-go", both)).toEqual({ providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" })
  expect(nextHealthyFallback("xai", both).providerID).not.toBe("xai")
})

test("spawnFailoverBefore rewrites capped Muse to a subscription fallback and never throws", () => {
  drainFailoverNotices()
  const weekly = usage([{ id: "opencode-go", status: "rate-limited", pct: 100 }])
  const input = { agent: "model-opencode-go-muse-spark-1-2-contributor" }
  expect(() => spawnFailoverBefore(host(input), weekly, TWIN_KEYS)).not.toThrow()
  expect(input.agent).toBe("build")
  expect((input as { model?: string }).model).toBe("cliproxyapi/grok-4.6")
  const parts = failoverSystemParts()
  expect(parts.length).toBeGreaterThan(0)
  expect(parts[0]?.type).toBe("text")
  expect(parts[0]?.text).toMatch(/Rewrote Task/)
})

test("spawnFailoverBefore without twin rewrites to grok-sub; unknown Go cache fail-closed rewrite", () => {
  const weekly = usage([{ id: "opencode-go", status: "rate-limited", pct: 100 }])
  const missing = { agent: "model-opencode-go-no-such-model" }
  expect(() => spawnFailoverBefore(host(missing), weekly, TWIN_KEYS)).not.toThrow()
  expect(missing.agent).toBe("build")
  expect(missing.model).toBe("cliproxyapi/grok-4.6")
  const unknown = { agent: "model-opencode-go-muse-spark-1-2-contributor" }
  expect(() => spawnFailoverBefore(host(unknown), { updated: "2000-01-01T00:00:00.000Z", sources: [] }, TWIN_KEYS)).not.toThrow()
  expect(unknown.agent).not.toMatch(/opencode-go/)
})

test("OpenAI cap rewrites to grok-sub; Grok+OpenAI cap rewrites to Muse-free", () => {
  const openaiCap = usage([{ id: "openai", status: "rate-limited", pct: 100 }])
  const openai = { agent: "model-openai-gpt-5-6-luna-fast", model: "openai/gpt-5.6-luna-fast" }
  expect(() => spawnFailoverBefore(host(openai), openaiCap, TWIN_KEYS)).not.toThrow()
  expect(openai.agent).toBe("build")
  expect(openai.model).toBe("cliproxyapi/grok-4.6")
  const both = usage([
    { id: "openai", status: "rate-limited", pct: 100 },
    { id: "grok-sub", status: "rate-limited", pct: 100 },
  ])
  const grok = { agent: "model-grok-sub-grok-4-6", model: "grok-sub/grok-4.6" }
  expect(() => spawnFailoverBefore(host(grok), both, TWIN_KEYS)).not.toThrow()
  expect(grok.agent).toBe("build")
  expect(grok.model).toBe("opencode/muse-spark-1.3-contributor-free")
})

test("xai spawn rewrites to grok-sub and never throws", () => {
  const ok = usage([{ id: "opencode-go", status: "ok", pct: 10 }])
  const input = { agent: "model-xai-grok-4-6", model: "xai/grok-4.6" }
  expect(() => spawnFailoverBefore(host(input), ok)).not.toThrow()
  expect(input.agent).toBe("build")
  expect(input.model).toBe("cliproxyapi/grok-4.6")
})

test("failover notices are SystemPart objects, never raw strings", () => {
  drainFailoverNotices()
  rememberFailoverNotice("Go capped; rewrote Task -> model-grok-sub-grok-4-6")
  const parts = failoverSystemParts()
  expect(parts).toEqual([{ type: "text", text: "Go capped; rewrote Task -> model-grok-sub-grok-4-6" }])
  expect(drainFailoverNotices()).toEqual([])
})

test("opencode.jsonc registers OpenRouter provider env without fake model-* agents", () => {
  expect(JSONC).not.toMatch(/"model-openrouter-/)
  expect(JSONC).toMatch(/"openrouter":\s*\{/)
  expect(JSONC).toMatch(/OPENROUTER_API_KEY/)
})

test("a lane block tracks the real window, not a fixed retry", () => {
  // The 30-minute default in capacity-registry is the blind case only. When
  // telemetry reports the window, the block has to last that long: retrying a
  // 7d lane after half an hour just spends another spawn on a spent plan.
  const week = 7 * 24 * 60 * 60
  const cache = { updated: new Date().toISOString(), sources: [{ id: "opencode-go", windows: [
    { label: "5h", used: 1, cap: 10, pct: 10, status: "ok" },
    { label: "7d", used: 10, cap: 10, pct: 100, status: "rate-limited", resetsInSeconds: week },
  ] }] }
  const resetAt = capResetAt("opencode-go", cache as any)
  expect(resetAt).toBeDefined()
  const hours = (Date.parse(resetAt!) - Date.now()) / 3_600_000
  expect(hours).toBeGreaterThan(167)
  expect(hours).toBeLessThan(169)
  // No capped window with a reset: the caller falls back rather than inventing one.
  expect(capResetAt("opencode-go", { updated: new Date().toISOString(), sources: [{ id: "opencode-go", windows: [
    { label: "5h", used: 1, cap: 10, pct: 10, status: "ok" },
  ] }] } as any)).toBeUndefined()
  expect(capResetAt("never-seen", cache as any)).toBeUndefined()
})
