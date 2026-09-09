import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { claimConflicts } from "../quest/claims"
import { newQuest } from "../quest/schema"
import { QuestStore } from "../quest/store"
import { QuestTracker } from "../quest/tracker"
import { createQuestAgentAPI } from "../quest/agent-api"
import { DEFAULT_COMPLETION_POLICY, type FileClaim, type Quest } from "../quest/types"
import { ensureDeclaredWorktree, validateDeclaredWorktree } from "../quest/worktree"
import { normalizeScope } from "../orchestration/task-scope"
import { canonicalizeDispatch } from "../orchestration/dispatch"
import { installSubagentGateway } from "../plugins-active/quests"

const id = "01j00000000000000000000000"
const policy = { requireSessions: false, requireCommits: false, requireTests: false, requireReview: false, requireArtifacts: false, requirePublish: false, requireWorktreeEquality: false }

test("admission is durable, concurrent-safe, and duplicate requests are idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-admission-")), tracker = new QuestTracker(new QuestStore(root))
  const request = { prompt: "separate usage investigation" }
  const first = tracker.admit({ title: "Usage", objective: "investigate", request, kind: "investigation", scope: { blastRadius: "isolated", risk: "low", repos: [root], include: ["usage"], exclude: [] } })
  const second = tracker.admit({ title: "Usage", objective: "investigate", request, kind: "investigation", scope: { blastRadius: "isolated", risk: "low", repos: [root], include: ["usage"], exclude: [] } })
  expect(second.id).toBe(first.id)
  expect(new QuestStore(root).read(first.id)?.state).not.toBe("Archived")
  rmSync(root, { recursive: true, force: true })
})

test("concurrent admission and replay preserves every accepted request", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-admission-stress-")), modulePath = resolve(process.cwd(), "quest", "tracker.ts").replaceAll("\\", "\\\\")
  const script = `import { QuestStore } from "${resolve(process.cwd(), "quest", "store.ts").replaceAll("\\", "\\\\")}"; import { QuestTracker } from "${modulePath}"; const t=new QuestTracker(new QuestStore(process.argv[2])); t.admit({title:process.argv[1],objective:process.argv[1],request:{requestID:process.argv[1]}})`
  const workers = Array.from({ length: 8 }, (_, lane) => Bun.spawn(["bun", "-e", script, `request-${lane}`, root], { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true }))
  const outcomes=await Promise.all(workers.map(async worker=>{const [code,stderr]=await Promise.all([worker.exited,new Response(worker.stderr).text()]);return {code,stderr}}))
  expect(outcomes.filter(result=>result.code!==0)).toEqual([])
  expect(readdirSync(join(root, ".opencode", "quests")).filter((name) => name.endsWith(".md")).length).toBe(8)
  expect(readFileSync(join(root, ".opencode", "quests", readdirSync(join(root, ".opencode", "quests")).find((name) => name.includes("request-0"))!), "utf8")).toContain("request-0")
  rmSync(root, { recursive: true, force: true })
})

test("separate requests remain visible after one completes", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-multi-")), tracker = new QuestTracker(new QuestStore(root))
  const a = tracker.admit({ title: "A", objective: "a", request: "a", kind: "investigation" }), b = tracker.admit({ title: "B", objective: "b", request: "b", kind: "investigation" })
  const store = new QuestStore(root)
  store.apply(a.id, "patched", { completionPolicy: policy, usageInstructions: ["Use A"] })
  store.apply(a.id, "complete", {})
  expect(store.read(a.id)?.state).toBe("Complete")
  expect(store.read(b.id)?.state).not.toBe("Archived")
  rmSync(root, { recursive: true, force: true })
})

function claimed(id: string, claim: FileClaim): Quest {
  return { ...newQuest({ id, title: id, objective: "x" }), claims: [claim] }
}

test("shared tree is valid: repo===worktree, omitted worktree means repo, create is never called", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-shared-")), repo = resolve(join(root, "repo"))
  mkdirSync(repo)
  expect(DEFAULT_COMPLETION_POLICY.requireWorktreeEquality).toBe(false)
  expect(validateDeclaredWorktree({ repo, branch: "quest/a", worktree: repo })).toEqual([])
  expect(validateDeclaredWorktree({ repo, branch: "quest/a" })).toEqual([])
  let created = 0
  ensureDeclaredWorktree({ repo, branch: "quest/a" }, () => { created++ })
  ensureDeclaredWorktree({ repo, branch: "quest/a", worktree: repo }, () => { created++ })
  expect(created).toBe(0)
  expect(() => ensureDeclaredWorktree({ repo, branch: "" }, () => { created++ })).toThrow()
  expect(created).toBe(0)
  const source = readFileSync(resolve(process.cwd(), "quest", "worktree.ts"), "utf8")
  expect(source).not.toContain("must be isolated from repo")
  expect(source).not.toContain("git worktree")
  expect(source).not.toContain("quest-")
  rmSync(root, { recursive: true, force: true })
})

test("isolated missing worktree calls create; fake strings still conflict; real trees do not", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-variant-")), repo = resolve(join(root, "repo"))
  mkdirSync(repo)
  const missing = resolve(join(root, "var-a"))
  let created = 0
  expect(() => ensureDeclaredWorktree({ repo, branch: "quest/a", worktree: missing }, () => { created++ })).toThrow()
  expect(created).toBe(1)
  ensureDeclaredWorktree({ repo, branch: "quest/a", worktree: missing }, () => { mkdirSync(missing); created++ })
  expect(created).toBe(2)
  const fakeA = claimed("01j00000000000000000000010", { repo, worktree: resolve(join(root, "nope-a")), include: ["quest/worktree.ts"], exclude: [], state: "active" })
  const fakeB = claimed("01j00000000000000000000011", { repo, worktree: resolve(join(root, "nope-b")), include: ["quest/worktree.ts"], exclude: [], state: "active" })
  expect(claimConflicts([fakeA, fakeB])).toEqual([{ a: fakeA.id, b: fakeB.id, reason: `overlapping claims in ${repo}` }])
  const treeB = resolve(join(root, "var-b"))
  mkdirSync(treeB)
  const realA = claimed("01j00000000000000000000014", { repo, worktree: missing, include: ["quest/worktree.ts"], exclude: [], state: "active" })
  const realB = claimed("01j00000000000000000000015", { repo, worktree: treeB, include: ["quest/worktree.ts"], exclude: [], state: "active" })
  expect(claimConflicts([realA, realB])).toEqual([])
  const shared = claimed("01j00000000000000000000012", { repo, include: ["quest/worktree.ts"], exclude: [], state: "active" })
  const other = claimed("01j00000000000000000000013", { repo, include: ["plugins-active/papercut-memory.ts"], exclude: [], state: "active" })
  expect(claimConflicts([shared, other])).toEqual([])
  rmSync(root, { recursive: true, force: true })
})

test("session planning preserves model and optional shared-tree identity", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-session-")), store = new QuestStore(root), tracker = new QuestTracker(store)
  const q = store.create({ id, title: "Exact", objective: "x", requestFingerprint: "fp", completionPolicy: policy })
  tracker.beforeDispatch({ questID: q.id, callID: "call-1", role: "worker", model: "openai/gpt-5.6-luna", branch: "quest/exact", worktree: root })
  tracker.bind(q.id, "call-1", "ses_exact")
  const session = store.read(q.id)!.sessions[0]
  expect(session).toMatchObject({ callID: "call-1", sessionID: "ses_exact", model: "openai/gpt-5.6-luna", branch: "quest/exact", worktree: root })
  tracker.beforeDispatch({ questID: q.id, callID: "call-2", role: "worker", model: "openai/gpt-5.6-luna", branch: "quest/exact" })
  expect(store.read(q.id)!.sessions[1].worktree).toBeUndefined()
  const omitted = { taskId: "t", questId: "q", workUnitId: "u", role: "worker", domains: ["d"], components: ["c"], ownedPaths: ["quest/worktree.ts"], prohibitedPaths: ["AGENTS.md"], branch: "main", parentId: "p", ownerId: "o", integrationId: "i", modelPin: "grok-sub/grok-4.6", lifecycle: "running", deliverables: ["shared-tree"], allowedFollowUpKinds: ["fix"] }
  expect(normalizeScope(omitted)?.worktree).toBeUndefined()
  expect(normalizeScope({ ...omitted, worktree: root })?.worktree).toBe(root)
  rmSync(root, { recursive: true, force: true })
})

test("admission accepts canonical Task title and prompt fields", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-task-text-")), tracker = new QuestTracker(new QuestStore(root))
  const title = tracker.admit({ title: "Task title", objective: "Task title", request: { requestID: "title-request" } })
  const prompt = tracker.admit({ title: "Task prompt", objective: "Task prompt", request: { requestID: "prompt-request" } })
  expect(title.title).toBe("Task title"); expect(prompt.title).toBe("Task prompt")
  rmSync(root, { recursive: true, force: true })
})

test("subagent gateway requires canonical original chip fields", async () => {
  const tools = new Map<string, any>([["subagent", {
    name: "subagent",
    description: "old",
    input: { type: "object", properties: { agent: {}, description: {}, prompt: {} }, required: ["agent", "description", "prompt"] },
    execute: async (input: any) => input,
  }]])
  await installSubagentGateway({
    tool: {
      transform: async (callback: (draft: { get: Function; update: Function }) => void) => callback({
        get: (id: string) => tools.get(id),
        update: (id: string, update: (tool: any) => void) => { const tool = tools.get(id); if (tool) update(tool) },
      }),
    },
  })
  const tool = tools.get("subagent")
  expect(tool.input.required).toEqual(["questID", "task", "agent", "description"])
  expect(tool.input.properties).toHaveProperty("questID")
  expect(tool.input.properties).toHaveProperty("cwd")
  expect(tool.input.properties).toHaveProperty("agent")
  expect(tool.description).toContain("quest action=run"); expect(tool.description).not.toContain("prepare-dispatch")

})

test("unbound subagent calls are rejected and queued notifications create zero Quests", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-task-hooks-")), tracker = new QuestTracker(new QuestStore(root))
  for (const description of ["Implement helper extraction", "<task>queued worker finished</task>"]) {
    const input: Record<string, unknown> = { task: description }
    expect(() => tracker.onTaskBefore({ tool: "subagent", callID: `call-${description.length}`, input })).toThrow(/questID|Quest binding/)
    expect(() => tracker.onTaskAfter({ tool: "subagent", input }, { content: [{ type: "text", text: "Session: ses_child" }] })).toThrow(/Quest binding/)
    expect(input.questID).toBeUndefined()
  }
  expect(existsSync(join(root, ".opencode", "quests"))).toBe(false)
  rmSync(root, { recursive: true, force: true })
})

test("the Quest giver can dispatch multiple implementers and workers cannot spawn", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-one-orchestrator-")), tracker = new QuestTracker(new QuestStore(root))
  const q = tracker.admit({ title: "One owner", objective: "x", request: "one-owner" })
  const first = { questID: q.id, task: "Implement routing" }
  const ownerEvent = { tool: "subagent", sessionID: "ses_giver", callID: "call-owner", input: first }
  canonicalizeDispatch(ownerEvent); tracker.onTaskBefore(ownerEvent)
  tracker.onTaskAfter(ownerEvent, { content: [{ type: "text", text: "Session: ses_worker_one" }] })
  const second = { tool: "subagent", sessionID: "ses_giver", callID: "call-two", input: { questID: q.id, task: "Implement tests" } }
  canonicalizeDispatch(second)
  expect(() => tracker.onTaskBefore(second)).not.toThrow()
  const nested = { tool: "subagent", sessionID: "ses_worker_one", callID: "call-nested", input: { questID: q.id, task: "Nested" } }
  canonicalizeDispatch(nested)
  expect(() => tracker.onTaskBefore(nested)).toThrow(/workers cannot spawn/)
  const stored = tracker.store.read(q.id)!
  expect(stored.integrationOwner).toBe("ses_giver")
  expect(stored.sessions.map((session) => session.role)).toEqual(["worker", "worker"])
  expect(stored.sessions[0]).toMatchObject({ sessionID: "ses_worker_one", role: "worker" })
  rmSync(root, { recursive: true, force: true })
})

test("a failed subagent call terminalizes its planned owner so retry is possible", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-mcp-retry-")), tracker = new QuestTracker(new QuestStore(root))
  const q = tracker.admit({ title: "Retry owner", objective: "x", request: "retry-owner" })
  const input = { questID: q.id, task: "Own quest" }
  const failed = { tool: "subagent", sessionID: "ses_giver", callID: "call-failed", input }
  canonicalizeDispatch(failed); tracker.onTaskBefore(failed); tracker.onTaskAfter(failed, { isError: true, content: [{ text: "Error: create failed" }] })
  expect(tracker.store.read(q.id)?.sessions[0].state).toBe("failed")
  const retry = { tool: "subagent", sessionID: "ses_giver", callID: "call-retry", input: { ...input } }
  canonicalizeDispatch(retry)
  expect(() => tracker.onTaskBefore(retry)).not.toThrow()
  rmSync(root, { recursive: true, force: true })
})

test("subagent records workers beneath the Quest giver", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-mcp-bound-")), tracker = new QuestTracker(new QuestStore(root))
  const q = tracker.admit({ title: "Explicit", objective: "x", request: "explicit", owner: "ses_giver" })
  const first = { questID: q.id, task: "Own" }
  const owner = { tool: "subagent", sessionID: "ses_giver", callID: "call-1", input: first }
  canonicalizeDispatch(owner); tracker.onTaskBefore(owner); tracker.onTaskAfter(owner, { content: [{ text: "Session: ses_one" }] })
  const second = { questID: q.id, task: "Implement" }
  const worker = { tool: "subagent", sessionID: "ses_giver", callID: "call-2", input: second }
  canonicalizeDispatch(worker); tracker.onTaskBefore(worker); tracker.onTaskAfter(worker, { content: [{ text: "Session: ses_two" }] })
  const continuation = { tool: "subagent", sessionID: "ses_giver", callID: "call-3", input: { ...second, sessionID: "ses_two", task: "Fix verification" } }
  canonicalizeDispatch(continuation); tracker.onTaskBefore(continuation); tracker.onTaskAfter(continuation, { content: [{ text: "Session: ses_two" }] })
  expect(tracker.store.read(q.id)?.sessions.map((session) => session.sessionID)).toEqual(["ses_one", "ses_two"])
  expect(tracker.store.read(q.id)?.sessions.map((session) => session.role)).toEqual(["worker", "worker"])
  expect(tracker.store.read(q.id)?.integrationOwner).toBe("ses_giver")
  expect(tracker.store.read(q.id)?.state).not.toBe("Archived")
  rmSync(root, { recursive: true, force: true })
})

test("a backgrounded host subagent result binds its session and interrupted settles it", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-bind-background-")), tracker = new QuestTracker(new QuestStore(root))
  const q = tracker.admit({ title: "Bind background", objective: "x", request: "bind-background" })
  const event = { tool: "subagent", sessionID: "ses_giver", callID: "call-bg", input: { questID: q.id, task: "Do step 1" } }
  canonicalizeDispatch(event); tracker.onTaskBefore(event)
  // Exact shape the beta-19059 host returns for `background: true`.
  tracker.onTaskAfter(event, { output: "The subagent is working in the background (sessionID: ses_bgworker1). You will be notified automatically when it finishes.", content: [] })
  const bound = tracker.store.read(q.id)!.sessions[0]
  expect(bound.sessionID).toBe("ses_bgworker1")
  expect(bound.state).toBe("executing")
  expect(tracker.onHostEvent({ type: "session.execution.interrupted", data: { sessionID: "ses_bgworker1" } })).toBe("settled")
  expect(tracker.store.read(q.id)!.sessions[0].state).toBe("cancelled")
  rmSync(root, { recursive: true, force: true })
})

test("a harness worker's plain-text report marks steps done and records tests on completion", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-worker-report-")), tracker = new QuestTracker(new QuestStore(root))
  const api = createQuestAgentAPI(root)
  const q = api.create({ title: "Report", objective: "x", steps: ["Write the file", "Read it back", "Verify"], usageInstructions: ["cat smoke.txt"] })
  const event = { tool: "subagent", sessionID: "ses_giver", callID: "call-rep", input: { questID: q.id, task: "Do steps 1-3" } }
  canonicalizeDispatch(event); tracker.onTaskBefore(event)
  tracker.onTaskAfter(event, { output: "The subagent is working in the background (sessionID: ses_harness1).", content: [] })
  const summary = [
    "Done. Evidence:",
    "STEP write-the-file: done — wrote C:/x/smoke.txt via Write tool",
    "STEP 2: done — `cat smoke.txt` printed ok",
    "STEP verify: blocked — needs the directory to be writable",
    "TESTS: cat smoke.txt — passed",
  ].join("\n")
  expect(tracker.onCompletion({ idempotencyKey: "k1", parentID: "ses_giver", callID: "call-rep", runID: "call-rep", questID: q.id, state: "completed", summary, openCodeSessionId: "ses_harness1" })).toBe("recorded")
  const stored = tracker.store.read(q.id)!
  expect(stored.stages.map((stage) => stage.status)).toEqual(["done", "done", "blocked"])
  expect(stored.stages[0].proofs.some((proof) => proof.kind === "command" && proof.result === "passed")).toBe(true)
  expect(stored.evidence.tests).toHaveLength(1)
  expect(stored.state).toBe("Needs attention")
  expect(stored.reason).toMatch(/verify is blocked/)
  expect(tracker.onHostEvent({ type: "session.updated", data: { info: { id: "ses_harness1", model: { id: "sonnet", providerID: "claude-code" } } } })).toBe("identified")
  expect(tracker.store.read(q.id)!.sessions[0]).toMatchObject({ providerID: "claude-code", modelID: "sonnet" })
  rmSync(root, { recursive: true, force: true })
})

test("a bound worker is identified from the host session row when it binds", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-identify-")), get = async ({ sessionID }: { sessionID: string }) => ({ data: { id: sessionID, model: { id: "sonnet", providerID: "claude-code" } } })
  const tracker = new QuestTracker(new QuestStore(root), { get })
  const q = tracker.admit({ title: "Identify", objective: "x", request: "identify" })
  const event = { tool: "subagent", sessionID: "ses_giver", callID: "call-id", input: { questID: q.id, task: "Do step 1" } }
  canonicalizeDispatch(event); tracker.onTaskBefore(event)
  tracker.onTaskAfter(event, { output: "The subagent is working in the background (sessionID: ses_idworker).", content: [] })
  expect(await tracker.identifyFromHost(q.id, "call-id", "ses_idworker")).toBe(false)
  expect(tracker.store.read(q.id)!.sessions[0]).toMatchObject({ providerID: "claude-code", modelID: "sonnet", model: "claude-code/sonnet" })
  rmSync(root, { recursive: true, force: true })
})

test("a done Verify step with evidence counts as the test run when the worker skipped the TESTS line", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-verify-fallback-")), tracker = new QuestTracker(new QuestStore(root))
  const api = createQuestAgentAPI(root)
  const q = api.create({ title: "Verify fallback", objective: "x", kind: "investigation", steps: ["Write the file", "Verify: read it back and report the command"] })
  const event = { tool: "subagent", sessionID: "ses_giver", callID: "call-vf", input: { questID: q.id, task: "Do steps 1-2" } }
  canonicalizeDispatch(event); tracker.onTaskBefore(event)
  tracker.onTaskAfter(event, { output: "The subagent is working in the background (sessionID: ses_vf1).", content: [] })
  const summary = "STEP 1: done — wrote the file\nSTEP 2: done — Get-Content cheap.txt printed ok"
  tracker.onCompletion({ idempotencyKey: "kvf", parentID: "ses_giver", callID: "call-vf", runID: "call-vf", questID: q.id, state: "completed", summary, openCodeSessionId: "ses_vf1" })
  const stored = tracker.store.read(q.id)!
  expect(stored.evidence.tests).toHaveLength(1)
  expect(stored.evidence.tests[0].command).toMatch(/Get-Content/)
  expect(stored.state).toBe("Ready to complete")
  rmSync(root, { recursive: true, force: true })
})

test("a quota/model-failover terminal ('Usage reached — falling over') stops blocking a Quest once the work is otherwise fully evidenced", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-quota-failover-")), tracker = new QuestTracker(new QuestStore(root))
  const api = createQuestAgentAPI(root)
  const q = api.create({ title: "Usage repro", objective: "x", kind: "investigation", steps: ["Do the work"] })
  const event = { tool: "subagent", sessionID: "ses_giver", callID: "call-quota", input: { questID: q.id, task: "Do step 1" } }
  canonicalizeDispatch(event); tracker.onTaskBefore(event)
  tracker.onTaskAfter(event, { output: "The subagent is working in the background (sessionID: ses_quota1).", content: [] })
  const quotaSummary = "Usage reached — opencode-go. Falling over to openai/gpt-5.6-luna-fast.\nUsage reached — opencode-go (api spent). No healthy failover target is available; this work is paused until the window resets. Quota is not a model failure — do not unfavorite, disable, or drop opencode-go models from use."
  expect(tracker.onCompletion({ idempotencyKey: "kquota", parentID: "ses_giver", callID: "call-quota", runID: "call-quota", questID: q.id, state: "failed", summary: quotaSummary, openCodeSessionId: "ses_quota1" })).toBe("recorded")
  const midway = tracker.store.read(q.id)!
  expect(midway.sessions[0].state).toBe("failed")
  expect(midway.sessions[0].quotaExhausted).toBe(true)
  // Nothing has evidenced the work yet, so the Quest correctly still needs attention.
  expect(midway.state).toBe("Needs attention")
  // The giver reconciles: the same work gets finished and evidenced (by a retry or on-disk artifacts).
  api.step(q.id, "do-the-work", "done", "completed after retry on a healthy lane")
  api.evidence(q.id, "tests", { command: "bun test", result: "passed", at: new Date().toISOString() })
  const stored = tracker.store.read(q.id)!
  expect(stored.sessions[0].state).toBe("failed")
  expect(stored.state).toBe("Ready to complete")
  expect(stored.reason).toBe("All completion gates are verified")
  rmSync(root, { recursive: true, force: true })
})
