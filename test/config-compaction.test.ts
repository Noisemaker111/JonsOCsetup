import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseJson5 } from "json5"
import { pickModel } from "../models/model-routing.ts"

const root = join(import.meta.dir, "..")

test("V2 config does not overlay a fake Sol 200k cap or 100k compaction buffer", () => {
  const src = readFileSync(join(root, "opencode.jsonc"), "utf8")
  const config = parseJson5(src)
  expect(config.compaction).toBeUndefined()
  expect(config.providers.openai.models["gpt-5.6-sol"].limit).toBeUndefined()
  expect(src).not.toMatch(/Effective Sol policy/)
  expect(src).not.toMatch(/capped at 200k/)
  expect(src).not.toMatch(/compaction starts at 100k/)
})

test("Sol is not selected automatically with unknown OpenAI usage or budget", async () => {
  const { solAutomaticSelectionAllowed } = await import("../plugins-active/favorite-router.ts")
  expect(solAutomaticSelectionAllowed("implement tests", undefined)).toBe(false)
  expect(solAutomaticSelectionAllowed("architecture consultation", { updated: new Date().toISOString(), sources: [{ id: "openai", windows: [] }] })).toBe(false)
  expect(solAutomaticSelectionAllowed("implement tests", { updated: new Date().toISOString(), sources: [{ id: "openai", windows: [{ label: "5h", usedTokens: 1, used: 1, cap: 100, pct: 1, resetsInSeconds: null }] }] })).toBe(false)
  expect(solAutomaticSelectionAllowed("architecture consultation", { updated: new Date().toISOString(), sources: [{ id: "openai", windows: [{ label: "5h", usedTokens: 1, used: 1, cap: 100, pct: 1, resetsInSeconds: null }] }] })).toBe(true)
})

test("automatic implementation routing cannot choose Sol under unknown budget", () => {
  const favorites = [
    { providerID: "openai", modelID: "gpt-5.6-sol" },
    { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
  ]
  expect(pickModel("implement the tests", favorites, undefined).agent).not.toContain("gpt-5.6-sol")
  expect(pickModel("implement the tests", favorites, { updated: new Date().toISOString(), sources: [] }).agent).not.toContain("gpt-5.6-sol")
})
