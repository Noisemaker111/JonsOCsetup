import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createQuestAgentAPI } from "../quest/agent-api"
import { QuestStore } from "../quest/store"
import { QuestTracker } from "../quest/tracker"
import { canonicalizeDispatch } from "../orchestration/dispatch"
import { looksLikeTranscript, progressGlyph, progressRing, questProgress, ringTone, stagesFromSteps } from "../quest/steps"
import { compactQuestDispatch } from "../quest/context"
import { questTool } from "../plugins-active/quests"

function scratch(prefix: string) { return mkdtempSync(join(tmpdir(), prefix)) }

// Token-aware budget: roughly 4 chars per token (see quest-context-budget.test.ts).
const estimateTokens = (text: string) => Math.ceil(text.length / 4)

test("a Quest is created with steps: explicit, or derived from what the objective states", () => {
  const root = scratch("quest-steps-")
  try {
    const api = createQuestAgentAPI(root)
    const explicit = api.create({ title: "Board", objective: "Fix the board", steps: ["Fix row clicks", { title: "Bigger composer", todos: ["textarea", "enter sends"] }] })
    expect(explicit.stages.map((s) => s.id)).toEqual(["fix-row-clicks", "bigger-composer"])
    expect(explicit.stages[1].todos).toHaveLength(2)
    expect(questProgress(explicit)).toEqual({ done: 0, total: 2, ratio: 0 })
    const derived = api.create({ title: "Restart", objective: "- add a /restart command\n- update opencode2 to the current beta\nTake a screenshot after." })
    expect(derived.stages.map((s) => s.title)).toEqual(["add a /restart command", "update opencode2 to the current beta"])
    const bare = api.create({ title: "Vague", objective: "Vague" })
    expect(bare.stages).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("plan and step drive the done/total count the board shows", async () => {
  const root = scratch("quest-plan-")
  try {
    const tool = questTool(createQuestAgentAPI(root))
    const created = JSON.parse((await tool.execute({ action: "create", input: { title: "Plan me", objective: "Plan me" } })).content)
    expect(created.steps).toEqual([])
    const planned = JSON.parse((await tool.execute({ action: "plan", id: created.id, input: { steps: ["Write hook", "Write test", "Deploy"] } })).content)
    expect(planned.steps.map((s: any) => s.status)).toEqual(["pending", "pending", "pending"])
    expect(planned.nextAction).toBe("Step 1/3: Write hook")
    await tool.execute({ action: "step", id: created.id, input: { stepID: "write-hook" }, state: "working" })
    const one = JSON.parse((await tool.execute({ action: "step", id: created.id, input: { stepID: "1" }, state: "done", value: "bun test passed" })).content)
    expect(one.stage).toBe("2/3")
    expect(one.nextAction).toBe("Step 2/3: Write test")
    const full = JSON.parse((await tool.execute({ action: "get", id: created.id, verbose: true })).content)
    expect(questProgress(full)).toMatchObject({ done: 1, total: 3 })
    expect(progressGlyph(questProgress(full))).toBe("◔")
    const replanned = JSON.parse((await tool.execute({ action: "plan", id: created.id, input: { steps: ["Write hook", "Write test", "Deploy", "Announce"] } })).content)
    expect(replanned.steps[0].status).toBe("done")
    await expect(tool.execute({ action: "step", id: created.id, input: { stepID: "nope" }, state: "done" })).rejects.toThrow(/Quest step not found: nope\. Steps: 1=write-hook/)
    await expect(tool.execute({ action: "step", id: created.id, input: { stepID: "deploy" }, state: "finished" })).rejects.toThrow(/step state must be one of/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("transcripts, tool results and subagent notifications never become Quests", () => {
  const root = scratch("quest-junk-")
  try {
    const api = createQuestAgentAPI(root)
    const junk = [
      "<subagent sessionID=\"ses_x\" state=\"cancelled\" description=\"Design\"> Subagent cancelled",
      "You are a subagent spawned by another session. ONE Quest: 0001",
      "<conversation-checkpoint> The following is a summary",
      "<task id=\"ses_1\" state=\"completed\"> <summary>",
    ]
    for (const title of junk) {
      expect(looksLikeTranscript(title)).toBe(true)
      expect(() => api.create({ title, objective: title })).toThrow(/Refusing to create a Quest from a transcript/)
    }
    expect(looksLikeTranscript("Design safe slash restart")).toBe(false)
    expect(api.create({ title: "Design safe slash restart", objective: "Design safe slash restart" }).title).toBe("Design safe slash restart")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the host's single-object execute.after result binds the worker session", () => {
  const root = scratch("quest-after-")
  try {
    const tracker = new QuestTracker(new QuestStore(root))
    const q = tracker.admit({ title: "Bind", objective: "x", request: "bind" })
    const event: Record<string, unknown> = { tool: "subagent", sessionID: "ses_giver", callID: "call-1", agent: "quest-giver", input: { questID: q.id, task: "Do step 1" } }
    canonicalizeDispatch(event); tracker.onTaskBefore(event)
    tracker.onTaskAfter({ ...event, status: "completed", result: { output: { sessionID: "ses_worker", status: "completed" }, content: "<subagent sessionID=\"ses_worker\" state=\"completed\">" } })
    const session = tracker.store.read(q.id)!.sessions[0]
    expect(session).toMatchObject({ sessionID: "ses_worker", state: "executing", task: "Do step 1" })
    const failed = { tool: "subagent", sessionID: "ses_giver", callID: "call-2", input: { questID: q.id, task: "Do step 2" } }
    canonicalizeDispatch(failed); tracker.onTaskBefore(failed)
    tracker.onTaskAfter({ ...failed, status: "error", error: { message: "provider down" } })
    expect(tracker.store.read(q.id)!.sessions[1]).toMatchObject({ state: "failed" })
    expect(tracker.store.read(q.id)!.sessions[1].evidence.at(-1)).toBe("provider down")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("host events name the model that actually answered and end the worker turn", () => {
  const root = scratch("quest-host-events-")
  try {
    const tracker = new QuestTracker(new QuestStore(root))
    const q = tracker.admit({ title: "Identify", objective: "x", request: "identify" })
    const event = { tool: "subagent", sessionID: "ses_giver", callID: "call-1", input: { questID: q.id, task: "Implement" } }
    canonicalizeDispatch(event); tracker.onTaskBefore(event)
    tracker.onTaskAfter(event, { content: [{ type: "text", text: "Session: ses_worker" }] })
    const assistant = { role: "assistant", sessionID: "ses_worker", providerID: "cliproxyapi", modelID: "grok-4.6", agent: "build" }
    expect(tracker.onHostEvent({ type: "message.updated", data: { sessionID: "ses_worker", info: { role: "user", sessionID: "ses_worker" } } })).toBeUndefined()
    expect(tracker.onHostEvent({ type: "message.updated", data: { sessionID: "ses_worker", info: assistant } })).toBe("identified")
    expect(tracker.onHostEvent({ type: "message.updated", data: { sessionID: "ses_worker", info: assistant } })).toBeUndefined()
    let session = tracker.store.read(q.id)!.sessions[0]
    expect(session).toMatchObject({ providerID: "cliproxyapi", modelID: "grok-4.6", model: "cliproxyapi/grok-4.6", state: "executing" })
    expect(tracker.onHostEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_unrelated" } })).toBeUndefined()
    expect(tracker.onHostEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_worker" } })).toBe("settled")
    session = tracker.store.read(q.id)!.sessions[0]
    expect(session.state).toBe("completed")
    expect(tracker.store.read(q.id)!.state).not.toBe("Working")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("legacy unbound launches retain uncertainty after the grace period", () => {
  const root = scratch("quest-reconcile-")
  try {
    const tracker = new QuestTracker(new QuestStore(root))
    const q = tracker.admit({ title: "Stuck", objective: "x", request: "stuck" })
    tracker.beforeDispatch({ questID: q.id, callID: "call-old", role: "worker" })
    tracker.beforeDispatch({ questID: q.id, callID: "call-bound", role: "worker" })
    tracker.bind(q.id, "call-bound", "ses_live")
    expect(tracker.reconcileUnbound(60_000)).toBe(0)
    expect(tracker.reconcileUnbound(60_000, Date.now() + 120_000)).toBe(0)
    const sessions = tracker.store.read(q.id)!.sessions
    expect(sessions.find((s) => s.callID === "call-old")?.state).toBe("planned")
    expect(sessions.find((s) => s.callID === "call-bound")?.state).toBe("executing")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a model hint picks the worker agent pinned to that model, Claude Code included", async () => {
  const { agentForModel, QUEST_SUBAGENT_INPUT } = await import("../quest/spawn")
  const { aliasModel } = await import("../orchestration/dispatch")
  expect(QUEST_SUBAGENT_INPUT.properties).toHaveProperty("model")
  expect(agentForModel(undefined)).toBe("build")
  expect(agentForModel("claude")).toBe("proxy-claude")
  expect(agentForModel("opus")).toBe("proxy-claude")
  expect(agentForModel("claude-code/sonnet")).toBe("claude-sonnet")
  expect(agentForModel("haiku")).toBe("proxy-haiku")
  expect(agentForModel("grok")).toBe("grok")
  expect(agentForModel("codex")).toBe("proxy-sol")
  expect(agentForModel("openai/gpt-6-astra")).toBe("astra")
  // Explicit broker requests retain their own pin.
  expect(agentForModel("cliproxyapi/gpt-6-astra")).toBe("astra-proxy")
  expect(agentForModel("openai/gpt-5.6-luna-fast")).toBe("luna")
  expect(() => agentForModel("banana")).toThrow(/claude, sonnet, haiku, grok, codex/)
  expect(aliasModel("Claude")).toEqual({ providerID: "cliproxyapi", modelID: "claude-opus-5" })
  const ev: Record<string, unknown> = { tool: "subagent", sessionID: "ses_giver", callID: "call-1", input: { questID: "01j00000000000000000000000", task: "Review the diff", model: "claude" } }
  const identity = canonicalizeDispatch(ev)!
  expect(identity).toMatchObject({ providerID: "cliproxyapi", modelID: "claude-opus-5", runtime: "native" })
  expect((ev.input as any).model).toBe("cliproxyapi/claude-opus-5")
  const config = require("json5").parse(require("node:fs").readFileSync(join(import.meta.dir, "..", "opencode.jsonc"), "utf8"))
  for (const [agent, model] of [["claude", "claude-code/opus"], ["claude-sonnet", "claude-code/sonnet"], ["claude-haiku", "claude-code/haiku"], ["grok", "cliproxyapi/grok-4.6"], ["astra", "openai/gpt-6-astra"], ["codex", "codex/default"]]) {
    expect(`${agent}: ${config.agents[agent]?.model} hidden=${config.agents[agent]?.hidden}`).toBe(`${agent}: ${model} hidden=true`)
  }
  expect(config.providers["claude-code"].settings.baseURL).toBe("http://127.0.0.1:3012/v1")
})

test("the worker prompt lists the steps and tells the worker how to report them", () => {
  const root = scratch("quest-prompt-")
  try {
    const api = createQuestAgentAPI(root)
    const quest = api.create({ title: "Prompt", objective: "Prompt me", steps: ["Wire hook", "Add test"] })
    const prompt = compactQuestDispatch(quest, "Do step 1")
    expect(prompt).toContain("Steps:\n1. [wire-hook] Wire hook\n2. [add-test] Add test")
    expect(prompt).toContain(`quest(action="step", id="${quest.id}"`)
    expect(prompt).toMatch(/STEP <id>: done/)
    expect(prompt).toContain("Task: Do step 1")
    expect(estimateTokens(prompt)).toBeLessThan(1_100)
    expect(stagesFromSteps(["Wire hook"])[0].id).toBe("wire-hook")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("reporting every step done with tests and a payout makes the Quest Ready to complete", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-steps-ready-"))
  const api = createQuestAgentAPI(root)
  const q = api.create({ title: "Ship it", objective: "Ship the thing", steps: ["Write code", "Run tests"], usageInstructions: ["Run bun test"] })
  api.claim(q.id, { callID: "call-1", taskID: "t1", sessionID: "ses_w1", role: "worker" })
  api.step(q.id, 1, "working")
  expect(api.get(q.id)!.state).toBe("Working")
  api.step(q.id, 1, "blocked", "needs a token")
  const blocked = api.get(q.id)!
  expect(blocked.state).toBe("Needs attention")
  expect(blocked.reason).toMatch(/blocked/)
  api.step(q.id, 1, "done", "bun test: 12 pass")
  const unblocked = api.get(q.id)!
  expect(unblocked.state).toBe("Working")
  expect(unblocked.reason).not.toMatch(/blocked/)
  expect(unblocked.stages[0].proofs.some((proof) => proof.kind === "command" && proof.result === "passed")).toBe(true)
  api.step(q.id, "run-tests", "done", "bun test: 12 pass")
  api.evidence(q.id, "tests", { command: "bun test", result: "passed", at: new Date().toISOString() })
  api.progress(q.id, "call-1", "finished", "completed")
  api.verifyLive(q.id, "passed", "restarted host, re-ran the shipped path", "confirmed working live")
  const ready = api.get(q.id)!
  expect(ready.missingRequirements).toEqual([])
  expect(ready.state).toBe("Ready to complete")
  expect(() => api.complete(q.id)).not.toThrow()
  rmSync(root, { recursive: true, force: true })
})

test("progressRing draws a rounded border that fills clockwise with done/total centered", () => {
  const palette = { green: "#0f0", yellow: "#ff0", dim: "#555" }
  const empty = progressRing({ done: 0, total: 5, ratio: 0 })
  expect(empty.center).toBe("0/5")
  expect(empty.empty).toBe(true)
  expect(empty.complete).toBe(false)
  expect(empty.rows[0].every((cell) => !cell.lit)).toBe(true)
  expect(empty.rows[0][0].char).toBe("╭")
  expect(empty.rows[1].map((cell) => cell.char).join("")).toBe("│0/5│")
  expect(ringTone({ done: 0, total: 5, ratio: 0 }, palette)).toBe(palette.dim)

  const partial = progressRing({ done: 2, total: 5, ratio: 0.4 })
  const litCells = partial.rows.flat().filter((cell) => cell.lit)
  expect(litCells.length).toBeGreaterThan(0)
  expect(partial.rows[0][0].lit).toBe(true)
  expect(ringTone({ done: 2, total: 5, ratio: 0.4 }, palette)).toBe(palette.yellow)

  const full = progressRing({ done: 5, total: 5, ratio: 1 })
  expect(full.complete).toBe(true)
  expect(full.rows.flat().every((cell) => cell.lit || cell.char === " " || cell.char === "5" || cell.char === "/" )).toBe(true)
  expect(ringTone({ done: 5, total: 5, ratio: 1 }, palette)).toBe(palette.green)

  const wide = progressRing({ done: 12, total: 12, ratio: 1 })
  expect(wide.center).toBe("12/12")
  expect(wide.rows[1].map((cell) => cell.char).join("")).toBe("│12/12│")
})

test("evidence accepts kind/value nested under input, as models send it", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-evidence-shape-"))
  const tool = questTool(createQuestAgentAPI(root))
  const created = JSON.parse((await tool.execute({ action: "create", input: { title: "Shape", objective: "x", steps: ["Do", "Verify"] } })).content)
  await tool.execute({ action: "evidence", id: created.id, input: { kind: "tests", value: { command: "bun test", result: "passed", at: new Date().toISOString() } } })
  const q = JSON.parse((await tool.execute({ action: "get", id: created.id, verbose: true })).content)
  expect(q.evidence.tests).toHaveLength(1)
  expect(q.evidence.tests[0].command).toBe("bun test")
  rmSync(root, { recursive: true, force: true })
})

 test("host failure preserves the actionable cause with secret redaction", () => {
 const root=scratch("quest-host-failure-")
 try {const tracker=new QuestTracker(new QuestStore(root));const q=tracker.admit({title:"Failure",objective:"x",request:"failure"});tracker.beforeDispatch({questID:q.id,callID:"failed-call",role:"worker"});tracker.bind(q.id,"failed-call","ses_failed");
 tracker.onHostEvent({type:"session.execution.failed",data:{sessionID:"ses_failed",error:{data:{message:"Route unavailable apiKey=private-value"}}}})
 const run=tracker.store.read(q.id)!.sessions[0];expect(run.state).toBe("failed");expect(run.result).toContain("Route unavailable");expect(run.result).not.toContain("private-value");expect(run.evidence.at(-1)).toBe(run.result)
 } finally {rmSync(root,{recursive:true,force:true})}
 })
