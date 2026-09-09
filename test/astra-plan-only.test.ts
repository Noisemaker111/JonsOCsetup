/**
 * Astra (openai/gpt-6-astra) is plan-only escalation per Jk (2026-09-04):
 * dispatch it only to plan against vague mandates, never for execution.
 * cliproxyapi/gpt-6-astra remains only a back-compat dispatch alias to the
 * same worker — Jk: "use astra through openai not through cli".
 *
 * Both automatic pickers must treat it as named-only, exactly like the Sol
 * gate — without a gate Astra wins heavy tasks by default, partly because it
 * carries no price record and so dodges the cost penalty every priced model
 * pays. An explicit name still routes (named path / explicit param).
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pickModel } from "../models/model-routing"
import { pickAvailableModel } from "../models/model-router"
import type { CatalogModel } from "../models/model-catalog"

const root = join(import.meta.dir, "..")
const doc = JSON.parse(readFileSync(join(root, "models", "model-profiles.json"), "utf8")) as {
  profiles: Array<{ id: string; model?: string | string[]; lane?: string; tier?: string; best?: string; avoid?: string }>
}
const astra = doc.profiles.find((p) => p.id === "gpt-6-astra")!

test("the astra profile declares the plan-only lane", () => {
  expect(astra.model).toEqual(["openai/gpt-6-astra", "cliproxyapi/gpt-6-astra"])
  expect(astra.lane).toBe("sub")
  expect(astra.tier).toBe("escalate")
  expect(`${astra.best} ${astra.avoid}`.toLowerCase()).toMatch(/plan-only/)
  expect(astra.avoid!.toLowerCase()).toMatch(/never.*default|default.*never/)
})

const cappedGo = {
  updated: new Date().toISOString(),
  sources: [
    {
      id: "opencode-go",
      windows: [
        { label: "5h", used: 100, cap: 100, pct: 100, resetsInSeconds: 3600 },
        { label: "7d", used: 1, cap: 100, pct: 1, resetsInSeconds: 3600 },
        { label: "30d", used: 1, cap: 100, pct: 1, resetsInSeconds: 3600 },
      ],
    },
  ],
}
const favs = [
  { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
  { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" },
  // Roster order mirrors model-profiles.json (astra above luna/sol/grok):
  // named matching is first-match substring, so the explicit astra name wins.
  { providerID: "openai", modelID: "gpt-6-astra" },
  { providerID: "cliproxyapi", modelID: "gpt-6-astra" },
  { providerID: "cliproxyapi", modelID: "grok-4.6" },
  { providerID: "openai", modelID: "gpt-5.6-sol" },
]

test("pickModel never auto-picks astra — grunt, heavy, or planning-shaped", () => {
  for (const usage of [undefined, cappedGo]) {
    for (const task of [
      "implement the tests",
      "huge context hard agentic reasoning-heavy rewrite",
      "plan the architecture overhaul",
      "orchestrate and plan hard reasoning",
    ]) {
      const picked = pickModel(task, favs, usage)?.model ?? ""
      expect(`task=${task} usage=${usage ? "capped" : "none"} picked=${picked}`).not.toContain("gpt-6-astra")
    }
  }
})

test("pickModel with only astra in the pool never spends astra (like sol)", () => {
  for (const solo of [{ providerID: "openai", modelID: "gpt-6-astra" }, { providerID: "cliproxyapi", modelID: "gpt-6-astra" }]) {
    // Uncapped: nothing automatic to pick — same as a sol-only pool.
    expect(pickModel("implement the tests", [solo], undefined)?.model).toBeUndefined()
  }
  // Capped: the Go hard-failover fires, and it must land on grok — never astra.
  expect(pickModel("implement the tests", [{ providerID: "openai", modelID: "gpt-6-astra" }], cappedGo)?.model).toBe("cliproxyapi/grok-4.6")
})

test("pickModel still routes an explicit astra name, capped or not", () => {
  for (const usage of [undefined, cappedGo]) {
    expect(pickModel("use openai/gpt-6-astra to plan the quest system overhaul", favs, usage)?.model).toBe("openai/gpt-6-astra")
    // Exact broker identity wins even when the OpenAI entry appears first.
    expect(pickModel("use cliproxyapi/gpt-6-astra to plan the quest system overhaul", favs, usage)?.model).toBe("cliproxyapi/gpt-6-astra")
  }
})

const catalogModel = (providerID: string, modelID: string): CatalogModel => ({
  providerID,
  modelID,
  name: modelID,
  capabilities: { tools: true, reasoning: true },
})
const catalog = [
  catalogModel("openai", "gpt-5.6-luna-fast"),
  catalogModel("cliproxyapi", "grok-4.6"),
  catalogModel("openai", "gpt-6-astra"),
  // Back-compat alias entry: the automatic scorer must skip it too.
  catalogModel("cliproxyapi", "gpt-6-astra"),
]

test("pickAvailableModel never auto-picks astra, even for planning tasks", () => {
  for (const task of ["implement code", "orchestrate and plan hard reasoning", "plan the architecture"]) {
    const picked = pickAvailableModel(task, catalog, {})?.model
    expect(`task=${task} picked=${picked?.providerID}/${picked?.modelID}`).not.toContain("gpt-6-astra")
  }
})

test("pickAvailableModel still honors an explicit astra request", () => {
  const picked = pickAvailableModel("anything", catalog, {}, "openai/gpt-6-astra")
  expect(`${picked?.model.providerID}/${picked?.model.modelID}`).toBe("openai/gpt-6-astra")
})
