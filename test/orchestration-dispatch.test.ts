import { expect, test } from "bun:test"
import { canonicalWorkerTitle, canonicalizeDispatch, nativeSessionNavigation, reasoningEffortFor, subagentChipLabel } from "../orchestration/dispatch"

function event(input: Record<string, unknown>, tool = "subagent") {
  return { tool, sessionID: "ses_parent", callID: "run_1", input }
}

test("subagent derives the hidden runtime from provider/model when given", () => {
  for (const [model, runtime] of [["grok-sub/grok-4.6", "native"], ["claude-code/sonnet", "native"]] as const) {
    const ev = event({ questID: "01j00000000000000000000000", model, task: "Implement routing" })
    const identity = canonicalizeDispatch(ev)!
    expect(identity).toMatchObject({ agentRole: "worker", runtime, parentID: "ses_parent", runID: "run_1", task: "Implement routing" })
    expect(`${identity.providerID}/${identity.modelID}`).toBe(model)
    expect((ev as any).metadata.worker).toEqual({ ...identity, title: `${model} - Implement routing` })
  }
})

test("subagent without a model is native and still requires Quest lineage", () => {
  const ev = event({ questID: "01j00000000000000000000000", cwd: "C:/repo", task: "Own quest" })
  const identity = canonicalizeDispatch(ev)!
  expect(identity).toMatchObject({ agentRole: "worker", runtime: "native", providerID: "opencode", modelID: "muse-spark-1.3-contributor-free", reasoningEffort: "medium", task: "Own quest" })
  expect((ev as any).metadata.worker.title).toBe("opencode/muse-spark-1.3-contributor-free - Own quest")
})

test("Task and subagent without questID fail closed", () => {
  for (const tool of ["Task", "subagent"]) {
    expect(() => canonicalizeDispatch(event({ task: "x" }, tool))).toThrow(/questID/)
  }
})

test("Quest dispatch rejects missing lineage and caller-selected role/runtime", () => {
  expect(() => canonicalizeDispatch(event({ model: "openai/gpt-5.6-luna-fast", task: "x" }))).toThrow(/questID/)
  expect(() => canonicalizeDispatch(event({ questID: "q" }))).toThrow(/task/)
  expect(() => canonicalizeDispatch(event({ questID: "q", task: "x", model: "grok-4.6" }))).toThrow(/provider\/model/)
  for (const field of ["agent", "agentRole", "role", "runtime", "subagent_type"]) {
    expect(() => canonicalizeDispatch(event({ questID: "q", task: "x", [field]: "worker" }))).toThrow(new RegExp(`field ${field}`))
  }
})

test("the mcp_agent gateway's fixed agent=build envelope is allowed only paired with an explicit model hint", () => {
  const ev = event({ questID: "01j00000000000000000000000", task: "Implement routing", model: "openai/gpt-5.6-luna", agent: "build" })
  const identity = canonicalizeDispatch(ev)!
  expect(identity).toMatchObject({ agentRole: "worker", runtime: "native", providerID: "openai", modelID: "gpt-5.6-luna", task: "Implement routing" })

  expect(() => canonicalizeDispatch(event({ questID: "q", task: "x", agent: "build" }))).toThrow(/field agent/)
  expect(() => canonicalizeDispatch(event({ questID: "q", task: "x", model: "openai/gpt-5.6-luna", agent: "orchestrator" }))).toThrow(/field agent/)
})

test("an explicit variant hint sets the reasoning effort and fast flag on dispatch", () => {
  const ev = event({ questID: "01j00000000000000000000000", model: "cliproxyapi/gpt-5.6-sol", variant: "xhigh-fast", task: "Plan migration" })
  const identity = canonicalizeDispatch(ev)!
  expect(identity).toMatchObject({ reasoningEffort: "xhigh", fast: true })
})

test("absent a variant hint, dispatch falls back to the model's lane default", () => {
  const ev = event({ questID: "01j00000000000000000000000", model: "cliproxyapi/gpt-5.6-sol", task: "Plan migration" })
  expect(canonicalizeDispatch(ev)).toMatchObject({ reasoningEffort: "xhigh", fast: false })
})

test("a -fast model id is a fast variant even with no separate variant hint", () => {
  const ev = event({ questID: "01j00000000000000000000000", model: "openai/gpt-5.6-luna-fast", task: "Plan migration" })
  expect(canonicalizeDispatch(ev)).toMatchObject({ fast: true })
})

test("a model with no lane default and no hint carries no reasoning effort — never a guessed label", () => {
  const ev = event({ questID: "01j00000000000000000000000", model: "grok-sub/grok-4.6", task: "Plan migration" })
  expect(canonicalizeDispatch(ev)).toMatchObject({ reasoningEffort: undefined, fast: false })
})

test("reasoningEffortFor: explicit hint beats lane default, non-fast is never labeled fast", () => {
  expect(reasoningEffortFor("cliproxyapi", "gpt-5.6-sol", "high")).toEqual({ reasoningEffort: "high", fast: false })
  expect(reasoningEffortFor("cliproxyapi", "gpt-5.6-sol", undefined)).toEqual({ reasoningEffort: "xhigh", fast: false })
  expect(reasoningEffortFor("openai", "gpt-5.6-luna", "max-fast")).toEqual({ reasoningEffort: "max", fast: true })
})

test("visible title is exactly provider/model - task", () => {
  expect(canonicalWorkerTitle({ providerID: "openai", modelID: "gpt-5.6-sol", task: "Plan migration" })).toBe("openai/gpt-5.6-sol - Plan migration")
})

test("the chip is the bare live line: (quest title, model, reasoning[, fast]), unknown parts omitted, never placeholders", () => {
  const quest = { title: "Ship it" }
  expect(subagentChipLabel(quest, { providerID: "openai", modelID: "gpt-5.6-sol", reasoningEffort: "xhigh" }))
    .toBe("(Ship it, openai/gpt-5.6-sol, xhigh)")
  expect(subagentChipLabel(quest, { providerID: "openai", modelID: "gpt-5.6-luna-fast", reasoningEffort: "medium", fast: true }))
    .toBe("(Ship it, openai/gpt-5.6-luna-fast, medium, fast)")
  // A non-fast worker never gets a "fast" label; unknown parts are omitted, not "pending".
  expect(subagentChipLabel(quest, { providerID: "grok-sub", modelID: "grok-4.6", fast: false })).toBe("(Ship it, grok-sub/grok-4.6)")
  expect(subagentChipLabel(quest, {})).toBe("(Ship it)")
  expect(subagentChipLabel(quest, { model: "custom-name" } as any)).toBe("(Ship it, custom-name)")
})

test("a native worker's session id resolves to a real session route", () => {
  const identity = { agentRole: "worker", providerID: "claude-code", modelID: "sonnet", runtime: "native", openCodeSessionId: "ses_child", parentID: "ses_parent", runID: "run_1", task: "x" }
  expect(nativeSessionNavigation(identity, { id: "ses_child", parentID: "ses_parent" })).toEqual({ type: "session", sessionID: "ses_child" })
})

test("an external harness session (runtime claude-code, off the bridge) has no OpenCode route", () => {
  const identity = { agentRole: "worker", providerID: "claude-code", modelID: "sonnet", runtime: "claude-code", openCodeSessionId: "ses_child", parentID: "ses_parent", runID: "run_1", task: "x" }
  expect(nativeSessionNavigation(identity, { id: "ses_child", parentID: "ses_parent" })).toBeUndefined()
})

test("nativeSessionNavigation refuses to route to an id the live session.get row does not confirm", () => {
  const identity = { agentRole: "worker", providerID: "claude-code", modelID: "sonnet", runtime: "native", openCodeSessionId: "ses_child", parentID: "ses_parent", runID: "run_1", task: "x" }
  expect(nativeSessionNavigation(identity, { id: "ses_other", parentID: "ses_parent" })).toBeUndefined()
  expect(nativeSessionNavigation(identity, { id: "ses_child", parentID: "ses_someone_else" })).toBeUndefined()
})
