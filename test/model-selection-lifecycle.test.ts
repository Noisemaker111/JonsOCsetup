import { describe, expect, test } from "bun:test"
import {
  buildPicker,
  canonicalModelID,
  discoverModels,
  discoverModelsText,
  ensureClaudeCodeCatalog,
  exactIdentity,
  isClaudeCodeModel,
  isForbiddenXai,
  openRouterTwin,
  overlayProviderLane,
  splitProviderModel,
} from "../models/model-catalog"
import { pickAvailableModel } from "../models/model-router"
import { assertModelImmutable, ModelChangeError, replaceSession, recoverFailedWorker, runningWorkerIDs } from "../models/session-lifecycle"
import { enforceSessionModelChange } from "../models/model-routing"
import { installSessionModelGuard } from "../plugins-active/models"
import { readFileSync } from "node:fs"

describe("provider catalog picker", () => {
  test("config exposes Luna Max as a future worker without replacing Fast", () => {
    const config = readFileSync(new URL("../opencode.jsonc", import.meta.url), "utf8")
    // OpenCode 2 variants are an array of { id, settings }, not a keyed object.
    expect(config).toMatch(/"variants": \[\s*\{ "id": "max"/)
    expect(config).not.toContain('"model-openai-gpt-5-6-luna-max"')
    expect(config).not.toContain('"model-cursor-gpt-5-6-luna-max"')
    expect(config).toContain('"gpt-5.6-luna-fast":')
  })
  test("runtime JSONC catalog exposes OpenAI base plus separate max variant", () => {
    const models = discoverModelsText(readFileSync(new URL("../opencode.jsonc", import.meta.url), "utf8"))
    expect(models.some((m) => m.providerID === "openai" && m.modelID === "gpt-5.6-luna" && m.variant === "max")).toBe(true)
    expect(models.some((m) => m.providerID === "cursor" && m.modelID === "gpt-5.6-luna" && m.variant === "max")).toBe(false)
  })
  test("keeps 200+ models searchable and groups duplicate families by provider", () => {
    const models = Array.from({ length: 205 }, (_, i) => ({ providerID: i % 2 ? "alpha" : "beta", modelID: `family-${i}`, family: "family", favorite: i === 1 }))
    const picker = buildPicker(models, { query: "family-204" })
    expect(picker.groups.flatMap((g) => g.models).length).toBe(1)
    expect(picker.groups.map((g) => g.providerID).sort()).toEqual(["beta"])
  })

  test("discovers Terra from authoritative provider config, without guessing", () => {
    const models = discoverModels({ providers: { cursor: { models: { "gpt-5.6-terra": { name: "Terra", variant: "reasoning" } } } } })
    expect(models[0].modelID).toBe("gpt-5.6-terra")
    expect(exactIdentity(models[0])).toContain("cursor/gpt-5.6-terra")
  })
  test("distinguishes subscription Luna Max from Luna Fast", () => {
    const models = discoverModels({ providers: { cursor: { models: {
      "gpt-5.6-luna-medium-fast": { name: "GPT-5.6 Luna Fast" },
      "gpt-5.6-luna-max": { name: "GPT-5.6 Luna 1M Max" },
    } } } })
    expect(models.map((m) => [m.modelID, m.variant])).toEqual([["gpt-5.6-luna", "medium-fast"], ["gpt-5.6-luna", "max"]])
    expect(exactIdentity(models[1])).toContain("variant=max")
  })

  test("provider-native Luna Fast is not rendered as an extra #fast variant", () => {
    const config = readFileSync(new URL("../opencode.jsonc", import.meta.url), "utf8")
    const fast = discoverModelsText(config).find((model) => model.providerID === "openai" && model.modelID === "gpt-5.6-luna-fast")
    expect(fast).toMatchObject({ providerID: "openai", modelID: "gpt-5.6-luna-fast" })
    expect(fast?.variant).toBeUndefined()
  })

  test("does not hide unfavorited models and nests variants", () => {
    const models = [{ providerID: "p", modelID: "x-fast", family: "x", variant: "fast" }, { providerID: "p", modelID: "x-pro", family: "x", variant: "pro" }, { providerID: "p", modelID: "x-mini", family: "x", variant: "mini" }, { providerID: "p", modelID: "x-thinking", family: "x", variant: "thinking" }]
    expect(buildPicker(models).groups[0].models).toHaveLength(4)
  })

  test("canonical identity finds OpenRouter twins and forbids xai", () => {
    const keys = [
      "openrouter/z-ai/glm-5.3-flash",
      "openrouter/meta/muse-spark-1.2-contributor",
      "openrouter/x-ai/grok-4.6",
    ]
    expect(canonicalModelID("openrouter/z-ai/glm-5.3-flash")).toBe("glm-5.3-flash")
    expect(splitProviderModel("openrouter/z-ai/glm-5.3-flash")).toEqual({
      providerID: "openrouter",
      modelID: "z-ai/glm-5.3-flash",
    })
    expect(openRouterTwin("glm-5.3-flash", keys)).toEqual({ providerID: "openrouter", modelID: "z-ai/glm-5.3-flash" })
    expect(openRouterTwin("glm-5-3-flash", keys)).toEqual({ providerID: "openrouter", modelID: "z-ai/glm-5.3-flash" })
    expect(openRouterTwin("grok-4.6", keys)).toBeUndefined()
    expect(isForbiddenXai("openrouter/x-ai/grok-4.6")).toBe(true)
    expect(isForbiddenXai("xai/grok-4.6")).toBe(true)
    expect(isForbiddenXai("grok-sub/grok-4.6")).toBe(false)
    expect(overlayProviderLane("openrouter")).toBe("metered")
    expect(overlayProviderLane("opencode-go")).toBe("go-quota")
  })

  test("catalog search claude/claude code/sonnet/opus/haiku hits claude-code/*", () => {
    const models = ensureClaudeCodeCatalog(discoverModelsText(readFileSync(new URL("../opencode.jsonc", import.meta.url), "utf8")))
    for (const query of ["claude", "claude code", "sonnet", "opus", "haiku"]) {
      const hits = buildPicker(models, { query }).groups.flatMap((group) => group.models).filter((model) => model.providerID === "claude-code")
      expect(hits.length).toBeGreaterThan(0)
      expect(hits.every((model) => !model.harness)).toBe(true)
    }
    expect(buildPicker(models, { query: "claude code" }).groups.flatMap((group) => group.models).map((model) => model.modelID).sort()).toEqual(["claude", "haiku", "opus", "sonnet"])
  })

  test("buildPicker includes Claude Code in the main picker, not harness-only", () => {
    const hidden = [{ providerID: "claude-code" as const, modelID: "claude", name: "Claude Code", harness: true, favorite: false }]
    const picker = buildPicker(ensureClaudeCodeCatalog(hidden))
    expect(picker.harnesses.some((model) => model.providerID === "claude-code")).toBe(false)
    expect(picker.favorites.some((model) => model.providerID === "claude-code" && model.modelID === "claude" && !model.harness)).toBe(true)
    expect(picker.groups.flatMap((group) => group.models).some((model) => model.providerID === "claude-code")).toBe(true)
  })

  test("jsonc exposes claude-code as an openai-compatible local CLI bridge", () => {
    const config = readFileSync(new URL("../opencode.jsonc", import.meta.url), "utf8")
    expect(config).toContain('"claude-code"')
    expect(config).toContain("http://127.0.0.1:3012/v1")
    expect(config).toContain('"env": []')
    const models = discoverModelsText(config)
    expect(models.some((model) => model.providerID === "claude-code" && model.modelID === "claude")).toBe(true)
    expect(isClaudeCodeModel("claude-code/claude")).toBe(true)
    expect(isClaudeCodeModel("opencode/x-preview-f-free")).toBe(false)
  })
})

describe("dynamic routing and lifecycle", () => {
  test("active runtime hook rejects model and variant mutation", () => {
    expect(() => enforceSessionModelChange({ sessionModel: "openai/gpt-5.6-luna", sessionVariant: "medium-fast", historyCount: 1, workerStarted: true, input: { model: "openai/gpt-5.6-luna", variant: "max" } })).toThrow(ModelChangeError)
    expect(() => enforceSessionModelChange({ sessionModel: "openai/gpt-5.6-luna", sessionVariant: "max", historyCount: 1, workerStarted: true, input: { model: "openai/gpt-5.6-luna", variant: "max" } })).not.toThrow()
  })
  test("runtime execute.before registration enforces the same pin", async () => {
    let callback: ((event: unknown) => void) | undefined
    await installSessionModelGuard({ tool: { hook: async (_name: string, cb: (event: unknown) => void) => { callback = cb } } })
    expect(callback).toBeDefined()
    expect(() => callback?.({ sessionModel: "openai/gpt-5.6-luna", sessionVariant: "medium-fast", historyCount: 1, input: { model: "openai/gpt-5.6-luna", variant: "max" } })).toThrow(ModelChangeError)
  })
  test("uses explicit unfavorited choice and keeps unknown capacity distinct", () => {
    const models = [{ providerID: "cliproxyapi", modelID: "terra", favorite: false }]
    expect(pickAvailableModel("bulk implementation", models, { "cliproxyapi/terra": { capacity: "unknown" } }, "cliproxyapi/terra")?.model.modelID).toBe("terra")
  })
  test("exhausted is skipped but soon-resetting is usable", () => {
    const models = [{ providerID: "a", modelID: "cheap", priceOutput: 0 }, { providerID: "b", modelID: "reset", priceOutput: 5 }]
    const result = pickAvailableModel("code", models, { "a/cheap": { capacity: "exhausted" }, "b/reset": { capacity: "resetting", resetAt: Date.now() + 60_000 } })
    expect(result?.model.modelID).toBe("reset")
  })
  test("rejects in-place changes and creates linked checkpoint replacement", () => {
    const old = { id: "s1", model: "a/x", state: "active" as const, historyCount: 1, workerStarted: true, questID: "q1", taskID: "t1" }
    expect(() => assertModelImmutable(old, "b/y")).toThrow(ModelChangeError)
    const next = replaceSession(old, "b/y", { summary: "compact quest checkpoint", taskID: "t1" })
    expect(old.state).toBe("superseded"); expect(next.parentID).toBe("s1"); expect(next.questID).toBe("q1")
  })
  test("Luna Max replacement is a new linked session; Fast remains unchanged", () => {
    const fast = { id: "luna-fast-session", model: "openai/gpt-5.6-luna", variant: "medium-fast", state: "active" as const, historyCount: 3, workerStarted: true, questID: "q-luna" }
    expect(() => assertModelImmutable(fast, "openai/gpt-5.6-luna", "max")).toThrow(ModelChangeError)
    const max = replaceSession(fast, "openai/gpt-5.6-luna", { summary: "checkpoint before Max", createdAt: "2026-08-27T00:00:00.000Z" }, undefined, "max")
    expect(fast.model).toBe("openai/gpt-5.6-luna"); expect(fast.variant).toBe("medium-fast"); expect(fast.state).toBe("superseded")
    expect(max.id).not.toBe(fast.id); expect(max.parentID).toBe(fast.id); expect(max.model).toBe("openai/gpt-5.6-luna"); expect(max.variant).toBe("max")
  })
  test("failed worker recovery is explicit and has no phantom running duplicate", () => {
    const stopped = { id: "w1", model: "a/x", state: "stopped" as const, historyCount: 2, workerStarted: true }
    const recovery = recoverFailedWorker(stopped, { summary: "retry checkpoint" }, "b/y")
    expect(stopped.state).toBe("stopped"); expect(recovery.parentID).toBe("w1"); expect(runningWorkerIDs([stopped, recovery])).toEqual([])
  })
})
