/**
 * A spent provider window must fail over, and must never look like a defect
 * in the model. Quota is not a model-quality failure — never drop favorites.
 *
 * This was test/go-cap.test.ts, testing one provider by name, against a policy
 * layer that special-cased that provider. Both are now driven by the provider
 * on the spawn and the usage-reached vocabulary, so the cases below are about
 * caps and failover rather than about OpenCode Go.
 *
 * Lives under test/ so the plugin loader cannot evaluate bun:test.
 */
import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { goApiCapFromUsage } from "../usage/usage-collector.ts"
import { installSpawnGuard } from "../plugins-active/models"
import { formatAgentLabel, formatTaskDescription, normalizeTaskDisplay } from "../orchestration/orchestration"
import {
  blockedCappedSpawn,
  favoritesFromJsonc,
  QUOTA_LANE,
  capMessage,
  sourceCapHit,
  quotaLaneNotice,
  spawnFailoverBefore,
  mergeFavs,
  pickModel,
  rewriteLegacyModelAgent,
  solAutomaticSelectionAllowed,
  splitProviderModel,
} from "../models/model-routing.ts"
import { usageSummaryLine, windowCapped } from "../usage/usage-lib.ts"
import { parse as parseJson5 } from "json5"
import { openRouterTwinFavorites, readJsoncModelAgents } from "../models/favorite-agents.ts"

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
const ROUTER_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "harnesses", "server.ts"), "utf8")

/** Host Tool.execute event from opencode2.exe: { tool, sessionID, agent, messageID, id, input } */
function hostExecuteBefore(tool: string, input: Record<string, unknown>) {
  return { tool, sessionID: "ses_test", agent: "quest-giver", messageID: "msg_test", id: "call_test", input }
}

const FAVS = [
  { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
  { providerID: "opencode-go", modelID: "glm-5.3-flash" },
  { providerID: "opencode-go", modelID: "deepseek-v4-flash-vision-exp" },
  { providerID: "opencode-go", modelID: "kimi-k3" },
  { providerID: "grok-sub", modelID: "grok-4.6" },
  { providerID: "openai", modelID: "gpt-5.6-luna-fast" },
  { providerID: "openai", modelID: "gpt-5.6-sol" },
  { providerID: "opencode", modelID: "x-preview-f-free" },
]

const TWIN_FAVS = [
  ...FAVS,
  { providerID: "openrouter", modelID: "z-ai/glm-5.3-flash" },
  { providerID: "openrouter", modelID: "meta/muse-spark-1.2-contributor" },
]

const TWIN_KEYS = [
  "openrouter/z-ai/glm-5.3-flash",
  "openrouter/meta/muse-spark-1.2-contributor",
  "openrouter/deepseek/deepseek-v4-flash-vision-exp",
  "openrouter/moonshotai/kimi-k3",
  "openrouter/x-ai/grok-4.6",
]

function cache(opts: {
  h5?: { status?: string; pct?: number | null; used?: number; cap?: number | null }
  d7?: { status?: string; pct?: number | null; used?: number; cap?: number | null }
  d30?: { status?: string; pct?: number | null; used?: number; cap?: number | null }
  apiCapHit?: boolean
}) {
  const win = (
    label: string,
    w?: { status?: string; pct?: number | null; used?: number; cap?: number | null },
  ) => ({
    label,
    usedTokens: 0,
    used: w?.used ?? 0,
    cap: w?.cap ?? null,
    pct: w?.pct ?? null,
    resetsInSeconds: null,
    status: w?.status,
  })
  return {
    updated: new Date().toISOString(),
    sources: [
      {
        id: "opencode-go",
        windows: [win("5h", opts.h5), win("7d", opts.d7), win("30d", opts.d30)],
        apiCapHit: opts.apiCapHit,
      },
    ],
  }
}

test("weekly rate-limited is a cap even when 5h is ok (the production bug)", () => {
  const c = cache({
    h5: { status: "ok", pct: 61, used: 3.7, cap: 12 },
    d7: { status: "rate-limited", pct: 100, used: 11.64, cap: 30 },
    d30: { status: "ok", pct: 56, used: 12.34, cap: 60 },
  })
  const cap = sourceCapHit(QUOTA_LANE.providerID, c)
  expect(cap.hit).toBe(true)
  expect(cap.windows).toContain("7d")
  expect(cap.windows).not.toContain("5h")
  // One vocabulary for exhaustion, whatever ran out: what is spent, which
  // window, and who picks the work up. No status codes, no provider prose.
  const msg = capMessage(QUOTA_LANE.providerID, cap, { providerID: "grok-sub", modelID: "grok-4.6" })
  expect(msg).toMatch(/Usage reached/)
  expect(msg).toMatch(/opencode-go/)
  expect(msg).toMatch(/7d spent/)
  expect(msg).toMatch(/grok-sub\/grok-4\.6/)
  expect(msg).toMatch(/do not unfavorite/i)
})

test("5h rate-limited is still a cap", () => {
  const cap = sourceCapHit(QUOTA_LANE.providerID, 
    cache({
      h5: { status: "rate-limited", pct: 100, used: 12, cap: 12 },
      d7: { status: "ok", pct: 40, used: 10, cap: 30 },
    }),
  )
  expect(cap.hit).toBe(true)
  expect(cap.windows).toContain("5h")
})

test("healthy 5h+weekly is not a cap", () => {
  const cap = sourceCapHit(QUOTA_LANE.providerID, 
    cache({
      h5: { status: "ok", pct: 61, used: 3.7, cap: 12 },
      d7: { status: "ok", pct: 40, used: 10, cap: 30 },
      d30: { status: "ok", pct: 20, used: 12, cap: 60 },
    }),
  )
  expect(cap.hit).toBe(false)
  expect(cap.windows).toEqual([])
})

test("apiCapHit alone is a cap", () => {
  const cap = sourceCapHit(QUOTA_LANE.providerID, cache({ h5: { status: "ok", pct: 10, used: 1, cap: 12 }, apiCapHit: true }))
  expect(cap.hit).toBe(true)
})

test("Go API weekly rate-limited stamps apiCapHit even when rolling is ok", () => {
  const usage = {
    rolling: { status: "ok", percent: 61, resetsAt: "2026-08-27T05:47:55.874Z" },
    weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-31T00:00:00.874Z" },
    monthly: { status: "ok", percent: 56, resetsAt: "2026-09-15T20:12:27.874Z" },
  }
  const cap = goApiCapFromUsage(usage)
  expect(cap.apiCapHit).toBe(true)
  expect(cap.windows).toContain("7d")
  expect(cap.windows).not.toContain("5h")
  expect(cap.apiCapDetail).toMatch(/weekly 7d 100% rate-limited/)
})

test("Go API rolling-only ok is not a cap", () => {
  const cap = goApiCapFromUsage({
    rolling: { status: "ok", percent: 61 },
    weekly: { status: "ok", percent: 40 },
    monthly: { status: "ok", percent: 20 },
  })
  expect(cap.apiCapHit).toBe(false)
  expect(cap.windows).toEqual([])
})

test("usage summary surfaces weekly CAP next to 5h", () => {
  const line = usageSummaryLine(
    cache({
      h5: { status: "ok", pct: 61, used: 3.7, cap: 12 },
      d7: { status: "rate-limited", pct: 100, used: 11.64, cap: 30 },
    }),
  )
  expect(line).toMatch(/7d CAP/)
  expect(line).toMatch(/100%/)
})

test("usage summary tags 5h CAP only when 5h/rolling is capped", () => {
  const weeklyOnly = usageSummaryLine(
    cache({
      h5: { status: "ok", pct: 61, used: 3.7, cap: 12 },
      d7: { status: "rate-limited", pct: 100, used: 11.64, cap: 30 },
    }),
  )
  expect(weeklyOnly).toMatch(/7d CAP 100%/)
  const weeklyH5 = weeklyOnly.match(/5h [^()]+(?:\(([^)]*)\))?/)
  expect(weeklyH5?.[1] ?? "").not.toMatch(/\bCAP\b/)

  const both = usageSummaryLine(
    cache({
      h5: { status: "rate-limited", pct: 100, used: 12, cap: 12 },
      d7: { status: "rate-limited", pct: 100, used: 30, cap: 30 },
    }),
  )
  expect(both).toMatch(/5h 100% CAP/)
  expect(both).not.toContain("$12.00")
  expect(both).toMatch(/7d CAP 100%/)
})

test("pickModel failovers to grok-sub on weekly cap, not Muse", () => {
  const weekly = cache({
    h5: { status: "ok", pct: 61, used: 3.7, cap: 12 },
    d7: { status: "rate-limited", pct: 100, used: 11, cap: 30 },
  })
  const picked = pickModel("implement the feature and write tests", FAVS, weekly)
  expect(picked).toBeDefined()
  expect(picked!.agent).toBe("build")
  expect(picked!.model).toBe("cliproxyapi/grok-4.6")
  expect(picked!.profile.lane).not.toBe("go-quota")
  expect(picked!.reason).toMatch(/Usage reached/)
})

test("pickModel still picks Muse when Go has quota", () => {
  const ok = cache({
    h5: { status: "ok", pct: 10, used: 1, cap: 12 },
    d7: { status: "ok", pct: 20, used: 5, cap: 30 },
  })
  const picked = pickModel("implement the feature and write tests", FAVS, ok)
  expect(picked).toBeDefined()
  expect(picked!.agent).toBe("build")
  expect(picked!.model).toBe("opencode-go/muse-spark-1.2-contributor")
})

test("pickModel never falls back to Go when the only favorites are Go and cap is hit", () => {
  const weekly = cache({ d7: { status: "rate-limited", pct: 100, used: 30, cap: 30 } })
  const goOnly = FAVS.filter((f) => f.providerID === "opencode-go")
  const picked = pickModel("implement tests", goOnly, weekly)
  expect(picked).toBeDefined()
  expect(picked!.agent).toBe("build")
  expect(picked!.model).toBe("cliproxyapi/grok-4.6")
})

test("blockedCappedSpawn fail-loud on model-opencode-go-* when capped", () => {
  const weekly = cache({ d7: { status: "rate-limited", pct: 100 } })
  const msg = blockedCappedSpawn({ agent: "model-opencode-go-muse-spark-1-2-contributor" }, weekly)
  expect(msg).toBeDefined()
  expect(msg).toMatch(/Usage reached/)
  expect(msg).toMatch(/cliproxyapi\/grok-4\.6/)
  expect(blockedCappedSpawn({ agent: "build", model: "opencode-go/muse-spark-1.2-contributor" }, weekly)).toMatch(/Usage reached/)
})

test("blockedCappedSpawn does not block grok-sub or luna when Go is capped", () => {
  const weekly = cache({ d7: { status: "rate-limited", pct: 100 } })
  expect(blockedCappedSpawn({ agent: "model-grok-sub-grok-4-6" }, weekly)).toBeUndefined()
  expect(blockedCappedSpawn({ agent: "model-openai-gpt-5-6-luna-fast" }, weekly)).toBeUndefined()
  expect(blockedCappedSpawn({ agent: "build" }, weekly)).toBeUndefined()
})

test("blockedCappedSpawn is silent when Go has quota", () => {
  const ok = cache({ h5: { status: "ok", pct: 10 }, d7: { status: "ok", pct: 20 } })
  expect(blockedCappedSpawn({ agent: "model-opencode-go-muse-spark-1-2-contributor" }, ok)).toBeUndefined()
})

test("live host ctx.tool has hook+transform; transform draft is add-only", () => {
  const ctxDump = JSON.parse(readFileSync(join(FIXTURES, "plugin-ctx-dump.json"), "utf8"))
  const draftDump = JSON.parse(readFileSync(join(FIXTURES, "plugin-tool-draft-dump.json"), "utf8"))
  expect(ctxDump.toolKeys).toEqual(["hook", "transform"])
  expect(ctxDump.toolHook).toBe("function")
  expect(draftDump.draftKeys).toEqual(["add"])
  expect(draftDump.hasUpdate).toBe(false)
  expect(draftDump.hasList).toBe(false)
  expect(ROUTER_SRC).toMatch(/safeToolHook\(toolHook, "execute\.before"/)
  expect(ROUTER_SRC).not.toMatch(/session\.hook\("tool\.execute\.before"/)
  expect(ROUTER_SRC).not.toMatch(/draft\.update\(["']task/)
})

test("live spawn guard preserves exact choices and refuses implicit fallback", async () => {
  let handler: Function | undefined
  await installSpawnGuard({tool:{hook:async (_:string,fn:Function)=>{handler=fn}}})
  const input={model:"openai/gpt-6-astra"};await handler!(hostExecuteBefore("task",input));expect(input.model).toBe("openai/gpt-6-astra")
  await expect(handler!(hostExecuteBefore("task",{agent:"build"}))).rejects.toThrow("quest run")
  await handler!(hostExecuteBefore("write",{path:"x"}))
})

test("spawnFailoverBefore rewrites host input.agent to a subscription fallback when Go is capped", () => {
  const weekly = cache({ d7: { status: "rate-limited", pct: 100 } })
  const input = { agent: "model-opencode-go-muse-spark-1-2-contributor" }
  expect(() => spawnFailoverBefore(hostExecuteBefore("task", input), weekly)).not.toThrow()
  expect(input.agent).toBe("build")
  expect(input.model).toBe("cliproxyapi/grok-4.6")
  expect(() =>
    spawnFailoverBefore(
      { tool: "task", agent: "quest-giver", input: { agent: "model-openai-gpt-5-6-luna-fast" } },
      weekly,
    ),
  ).not.toThrow()
  expect(() =>
    spawnFailoverBefore(hostExecuteBefore("task", { agent: "model-openrouter-z-ai-glm-5-3-flash" }), weekly),
  ).not.toThrow()
})

test("jsonc has no leftover model-* fake agents", () => {
  expect(favoritesFromJsonc()).toEqual([])
  expect(readJsoncModelAgents()).toEqual([])
  const config = parseJson5(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "opencode.jsonc"), "utf8"))
  expect(Object.keys(config.agents).filter((key: string) => key.startsWith("model-"))).toEqual([])
  expect(config.default_agent).toBe("quest-giver")
  expect(config.agents["quest-giver"]).toBeDefined()
  expect(config.agents.orchestrator).toBeUndefined()
  expect(config.agents.build).toMatchObject({ mode: "subagent", hidden: true })
  expect(config.agents.build.permissions).toContainEqual({ action: "task", resource: "*", effect: "deny" })
  for (const id of ["general", "explore", "plan"]) expect(config.agents[id]).toMatchObject({ mode: "subagent", hidden: true })
  expect(ROUTER_SRC).not.toMatch(/systemPart\(routingCard/)
  expect(ROUTER_SRC).not.toMatch(/systemPart\(FANOUT_RULES/)
  expect(ROUTER_SRC).not.toMatch(/systemPart\(XAI_NEVER_MSG/)
})

test("rewriteLegacyModelAgent maps cloned names to role + provider/model", () => {
  const input = { agent: "model-grok-sub-grok-4-6", prompt: "fix it" }
  rewriteLegacyModelAgent(input, [{ providerID: "grok-sub", modelID: "grok-4.6" }, { providerID: "opencode", modelID: "x-preview-f-free" }])
  expect(input.agent).toBe("build")
  expect(input.model).toBe("grok-sub/grok-4.6")
  const preview = { agent: "model-opencode-x-preview-f-free" }
  rewriteLegacyModelAgent(preview, [{ providerID: "opencode", modelID: "x-preview-f-free" }])
  expect(preview.agent).toBe("explore")
  expect(preview.model).toBe("opencode/x-preview-f-free")
})

test("mergeFavs keeps jsonc Go models when model.json is Muse-only", () => {
  const museOnly = [{ providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" }]
  const jsonc = [
    ...museOnly,
    { providerID: "opencode-go", modelID: "kimi-k3" },
    { providerID: "opencode-go", modelID: "glm-5.3-flash" },
    { providerID: "grok-sub", modelID: "grok-4.6" },
    { providerID: "openai", modelID: "gpt-5.6-luna-fast" },
  ]
  const merged = mergeFavs(museOnly, jsonc)
  expect(merged.some((f) => f.modelID === "kimi-k3")).toBe(true)
  expect(merged.some((f) => f.modelID === "glm-5.3-flash")).toBe(true)
  expect(merged.some((f) => f.providerID === "cliproxyapi" || f.providerID === "grok-sub")).toBe(true)
  expect(merged.filter((f) => f.providerID === "opencode-go").length).toBe(3)
})

test("quest giver dispatches implementers", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..")
  const giver = readFileSync(join(root, "agent", "quest-giver.md"), "utf8")
  expect(existsSync(join(root, "agent", "orchestrator.md"))).toBe(false)
  expect(existsSync(join(root, "agent", "build.md"))).toBe(false)
  expect(giver).toContain("Never paste Quest fields or routing policy")
  expect(giver).toContain("Runtime handles dispatch")
  expect(giver).toContain("Delegate sufficiently specified, verifiable work")
  expect(giver).toContain("Preserve uncertain launches")
  expect(giver).toContain("action=run")
  expect(giver).not.toContain("artifact-gate")
})

test("Task display uses friendly model names and hides internal labels", () => {
  expect(formatAgentLabel("model-openai-gpt-5-6-luna-fast", "check-lean-fixes")).toBe("OpenAI/GPT-5.6 Luna Fast")
  expect(formatAgentLabel("model-grok-sub-grok-4-6")).toBe("Grok 4.6")
  expect(formatTaskDescription("check-lean-fixes")).toBe("Checking implementation")
  expect(formatTaskDescription("integrate-lean-unstaged")).toBe("Updating orchestrator scaling (3 → N)")
  expect(formatTaskDescription("verify-shell-guards")).toBe("Verifying shell guards")
})

test("splitProviderModel keeps nested OpenRouter ids and rejects invalid refs", () => {
  expect(splitProviderModel("openrouter/z-ai/glm-5.3-flash")).toEqual({
    providerID: "openrouter",
    modelID: "z-ai/glm-5.3-flash",
  })
  expect(splitProviderModel("opencode-go/muse-spark-1.2-contributor")).toEqual({
    providerID: "opencode-go",
    modelID: "muse-spark-1.2-contributor",
  })
  expect(splitProviderModel("grok-sub/grok-4.6")).toEqual({
    providerID: "grok-sub",
    modelID: "grok-4.6",
  })
  expect(splitProviderModel("")).toBeUndefined()
  expect(splitProviderModel("noslash")).toBeUndefined()
  expect(splitProviderModel("/leading")).toBeUndefined()
  expect(splitProviderModel("trailing/")).toBeUndefined()
})

test("normalizeTaskDisplay preserves the actual Task prompt and target", () => {
  const input = {
    agent: "model-openai-gpt-5-6-luna-fast",
    description: "check-lean-fixes",
    prompt: "Apply the requested fixes exactly.",
  }
  normalizeTaskDisplay(input)
  expect(input.agent).toBe("model-openai-gpt-5-6-luna-fast")
  expect(input.prompt).toBe("Apply the requested fixes exactly.")
  expect(input.description).toBe("Checking implementation")
})

test("estimated-only 100% is not a hard cap; rate-limited still is", () => {
  const estimated = {
    label: "7d",
    usedTokens: 0,
    used: 30,
    cap: 30,
    pct: 100,
    resetsInSeconds: null,
    estimated: true,
  }
  expect(windowCapped(estimated)).toBe(false)
  expect(windowCapped({ ...estimated, status: "rate-limited" })).toBe(true)
  expect(windowCapped({ ...estimated, estimated: false, status: "ok" })).toBe(true)
})

test("paid twins are never a quota fallback", () => {
  const weekly = cache({ d7: { status: "rate-limited", pct: 100 } })
  const input = { model: "opencode-go/glm-5.3-flash", agent: "build" }
  spawnFailoverBefore(hostExecuteBefore("task", input), weekly, TWIN_KEYS)
  expect(input.model).toBe("cliproxyapi/grok-4.6")
})

test("pickModel preserves named GLM when Go is capped", () => {
  const weekly = cache({ d7: { status: "rate-limited", pct: 100 } })
  const picked = pickModel("use glm-5.3-flash for this tiny util", FAVS, weekly)
  expect(picked).toBeDefined()
  expect(picked!.agent).toBe("build")
  expect(picked!.model).toBe("opencode-go/glm-5.3-flash")
  expect(picked!.profile.lane).toBe("go-quota")
  expect(picked!.reason).toMatch(/user named/)
})

test("pickModel automatic pool does not pick metered OpenRouter when Go is capped", () => {
  const weekly = cache({ d7: { status: "rate-limited", pct: 100 } })
  const picked = pickModel("implement the feature and write tests", TWIN_FAVS, weekly)
  expect(picked).toBeDefined()
  expect(picked!.agent).toBe("build")
  expect(picked!.model).toBe("cliproxyapi/grok-4.6")
  expect(picked!.model).not.toMatch(/openrouter/)
  expect(picked!.profile.lane).not.toBe("metered")
})

test("pickModel still picks Go GLM when named and Go has quota, not the OpenRouter twin", () => {
  const ok = cache({
    h5: { status: "ok", pct: 10, used: 1, cap: 12 },
    d7: { status: "ok", pct: 20, used: 5, cap: 30 },
  })
  const picked = pickModel("use glm-5.3-flash for this tiny util", TWIN_FAVS, ok)
  expect(picked).toBeDefined()
  expect(picked!.agent).toBe("build")
  expect(picked!.model).toBe("opencode-go/glm-5.3-flash")
  expect(picked!.profile.lane).toBe("go-quota")
})

test("openRouterTwinFavorites registers GLM and skips xai grok", () => {
  const twins = openRouterTwinFavorites(FAVS, { models: TWIN_KEYS.map((key) => ({ key })) } as any)
  expect(twins.some((f) => f.providerID === "openrouter" && f.modelID === "z-ai/glm-5.3-flash")).toBe(true)
  expect(twins.some((f) => f.modelID.includes("muse-spark"))).toBe(true)
  expect(twins.some((f) => /x-ai|xai/i.test(`${f.providerID}/${f.modelID}`))).toBe(false)
})

test("blockedCappedSpawn does not treat OpenRouter twins as Go", () => {
  const weekly = cache({ d7: { status: "rate-limited", pct: 100 } })
  expect(blockedCappedSpawn({ agent: "model-openrouter-z-ai-glm-5-3-flash" }, weekly)).toBeUndefined()
  expect(blockedCappedSpawn({ model: "openrouter/z-ai/glm-5.3-flash" }, weekly)).toBeUndefined()
})
