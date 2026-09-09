import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "json5"
import { agentForModel, dispatchChipLabel, WORKER_AGENTS } from "../quest/spawn"
import { aliasModel, reasoningEffortFor } from "../orchestration/dispatch"

const config = parse(readFileSync(join(import.meta.dir, "../opencode.jsonc"), "utf8"))
test("native default, Luna and Astra faces agree with the pinned model and API settings", () => {
  for (const model of ["opencode/muse-spark-1.3-contributor-free", "openai/gpt-5.6-luna-fast", "openai/gpt-6-astra", "cliproxyapi/gpt-6-astra"]) {
    const agent = agentForModel(model)
    expect(config.agents[agent].model).toBe(model)
    const [providerID, modelID] = model.split("/")
    const reasoning = reasoningEffortFor(providerID!, modelID!, undefined)
    expect(reasoning.reasoningEffort).toBe(config.providers[providerID!].models[modelID!].settings.reasoningEffort)
    expect(dispatchChipLabel({ title: "Verify dispatch" } as any, { model })).toContain(`, ${reasoning.reasoningEffort}`)
  }
  expect(config.agents["quest-giver"].model).toBe(config.agents.build.model)
  expect(aliasModel("astra")).toEqual({ providerID: "openai", modelID: "gpt-6-astra" })
  expect(agentForModel("astra")).toBe("astra")
  expect(() => agentForModel("other/named-model")).toThrow("refusing to substitute")
})

import { pickAvailableModel, pickModel as pickFavorite } from "../models/model-router"
import { pickModel } from "../models/model-routing"
test("metered-only pools cannot be auto-picked; a fully named model wins", () => {
  const model = { providerID: "openrouter", modelID: "z-ai/glm-5.3-flash", capabilities: { tools: true } }
  expect(pickAvailableModel("implement code", [model])).toBeUndefined()
  expect(pickFavorite("implement code", [model])).toBeUndefined()
  expect(() => pickAvailableModel("implement code", [model], {}, "openrouter/z-ai/glm-5.3-flash")).toThrow("User access policy")
  const go = { providerID: "opencode-go", modelID: "glm-5.3-flash" }
  expect(() => pickModel("use openrouter/z-ai/glm-5.3-flash", [go, model])).toThrow("User access policy")
})

test("native Astra can execute an authorized Quest while delegation stays denied", () => {
  for (const action of ["edit", "write", "patch", "shell"]) expect(config.agents.astra.permissions.find((rule: any) => rule.action === action)?.effect).toBe("allow")
  for (const action of ["task", "subagent"]) expect(config.agents.astra.permissions.find((rule: any) => rule.action === action)?.effect).toBe("deny")
  for (const action of ["edit", "write", "patch", "shell", "task", "subagent"]) expect(config.agents["astra-proxy"].permissions.find((rule: any) => rule.action === action)?.effect).toBe("deny")
  expect(config.providers.openai.models["gpt-6-astra"].variants).toContainEqual({ id: "medium", settings: { reasoningEffort: "medium" } })
})

test("broker short names and exact pins resolve to native workers with matching configured identities", () => {
  const aliases = {claude:"claude-opus-5",opus:"claude-opus-5",sonnet:"claude-sonnet-5",haiku:"claude-haiku-4-5-20251001",codex:"gpt-5.6-sol"}
  for(const [alias,id] of Object.entries(aliases)) {
    expect(aliasModel(alias)).toEqual({providerID:"cliproxyapi",modelID:id})
    expect(config.agents[agentForModel(alias)].model).toBe(`cliproxyapi/${id}`)
  }
  for(const [model,agent] of Object.entries(WORKER_AGENTS).filter(([model])=>model.startsWith("cliproxyapi/"))) {
    expect(config.agents[agent].model).toBe(model)
    expect(config.agents[agent].hidden).toBe(true)
    expect(config.agents[agent].tools.subagent).toBe(false)
    expect(config.agents[agent].tools.task).toBe(false)
    expect(config.providers.cliproxyapi.models[model.slice("cliproxyapi/".length)]).toBeDefined()
  }
  // Explicit legacy identities are never relabeled as broker models.
  expect(agentForModel("claude-code/opus")).toBe("claude")
  expect(agentForModel("codex/default")).toBe("codex")
})
