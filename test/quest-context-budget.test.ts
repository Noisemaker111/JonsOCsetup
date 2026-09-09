import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compactQuestDetail, compactQuestDispatch } from "../quest/context"
import { newQuest } from "../quest/schema"
import { toNativeSubagentInput, preparedDispatch, validatePreparedSubagent } from "../quest/spawn"
import { QuestStore } from "../quest/store"
import { createQuestAgentAPI } from "../quest/agent-api"
import { questTool } from "../plugins-active/quests"

const root = join(import.meta.dir, "..")

// Token-aware budget: roughly 4 chars per token. Content assertions below are
// the primary signal (what must/must not be in the contract); token budgets
// only guard against unbounded bloat, never raw size for its own sake.
const estimateTokens = (text: string) => Math.ceil(text.length / 4)

test("agent contracts stay token-lean and forbid copying the Quest into dispatch", () => {
  const giver = readFileSync(join(root, "agent", "quest-giver.md"), "utf8")
  expect(estimateTokens(giver)).toBeLessThan(500)
  expect(giver).toContain("Never paste Quest fields or routing policy")
  expect(giver).toContain("action=run")
  expect(giver).toContain("Runtime handles dispatch")
  expect(giver).toContain("Workers report steps")
  expect(giver).not.toMatch(/spider hairs|troll thumbs|Wave 1|Wave 2|Wave 3/)
  expect(giver).not.toMatch(/mcp_agent|orchestrator/)
})

test("Quest tool defaults to bounded projections while verbose remains explicit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "quest-context-"))
  try {
    const store = new QuestStore(dir)
    const q = store.create({
      id: "01j00000000000000000000420",
      title: "Compact me",
      objective: "x".repeat(5_000),
      scope: { blastRadius: "large", risk: "high", repos: Array.from({ length: 10 }, () => "r".repeat(500)), include: Array.from({ length: 30 }, () => "i".repeat(500)), exclude: Array.from({ length: 20 }, () => "e".repeat(500)) },
      extensions: { designDecisions: ["y".repeat(10_000)] },
      acceptanceCriteria: Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, text: `criterion ${i} ${"z".repeat(300)}`, satisfied: false })),
    })
    expect(estimateTokens(JSON.stringify(compactQuestDetail(q)))).toBeLessThan(1_700)
    const tool = questTool(createQuestAgentAPI(dir))
    const compact = await tool.execute({ action: "get", id: q.id })
    const verbose = await tool.execute({ action: "get", id: q.id, verbose: true })
    expect(estimateTokens(compact.content)).toBeLessThan(1_700)
    expect(compact.content).not.toContain("designDecisions")
    expect(verbose.content.length).toBeGreaterThan(compact.content.length)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("Quest list is active-by-default and paged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "quest-list-context-"))
  try {
    const store = new QuestStore(dir)
    for (let i = 0; i < 30; i++) store.create({ id: `01j00000000000000000001${String(i).padStart(3, "0")}`, title: `Quest ${i}`, objective: "bounded" })
    const archived = store.create({ id: "01j00000000000000000001999", title: "Archived", objective: "hidden" })
    store.apply(archived.id, "archive", { reason: "old" })
    const tool = questTool(createQuestAgentAPI(dir))
    const first = JSON.parse((await tool.execute({ action: "list" })).content)
    expect(first.items).toHaveLength(25)
    expect(first).toMatchObject({ truncated: true, nextOffset: 25 })
    expect(first.items.some((item: any) => item.id === archived.id)).toBe(false)
    const second = JSON.parse((await tool.execute({ action: "list", query: { offset: first.nextOffset } })).content)
    expect(second.items).toHaveLength(5)
    expect(second.truncated).toBe(false)
    const withArchived = JSON.parse((await tool.execute({ action: "list", query: { includeArchived: true, limit: 100 } })).content)
    expect(withArchived.items.some((item: any) => item.id === archived.id)).toBe(true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})


test("native subagent spawn derives a bounded prompt from the canonical Quest", () => {
  const q = newQuest({
    id: "01j00000000000000000000422",
    title: "Compact native",
    objective: "Implement the current stage without duplicating metadata",
    nextAction: "Run focused tests",
    scope: { blastRadius: "isolated", risk: "low", repos: ["repo"], include: ["quest/context.ts"], exclude: ["generations/**"] },
    deliverables: [{ id: "lean", title: "Keep prompts lean", status: "pending" }],
    acceptanceCriteria: [{ id: "budget", text: "Dispatch stays under budget", satisfied: false }],
    usageInstructions: ["Use the Quest board"],
    extensions: { designDecisions: ["DO_NOT_DISPATCH_" + "x".repeat(10_000)] },
  })
  const native = toNativeSubagentInput({ questID: q.id, cwd: "C:/repo", task: "execute " + "t".repeat(10_000) }, q)
  expect(native.agent).toBe("build")
  expect(native.background).toBe(true)
  // The host chip renders this description verbatim: the live line, not the task text.
  expect(native.description).toBe("(Compact native, opencode/muse-spark-1.3-contributor-free, medium)")
  expect(toNativeSubagentInput({ questID: q.id, task: "Implement", model: "claude-code/sonnet" }, q).description)
    .toBe("(Compact native, claude-code/sonnet)")
  expect(toNativeSubagentInput({ questID: q.id, task: "Implement", model: "openai/gpt-5.6-luna-fast" }, q).description)
    .toBe("(Compact native, openai/gpt-5.6-luna-fast, max, fast)")
  expect(() => toNativeSubagentInput({ questID: q.id, task: "Implement", model: "unconfigured/named-model" }, q)).toThrow("No pinned worker agent")
  expect(estimateTokens(native.prompt)).toBeLessThan(1_100)
  expect(native.prompt).toContain(`Quest ${q.id}: Compact native`)
  expect(native.prompt).toContain("Proof: command")
  expect(native.prompt).toContain("Task: execute")
  expect(native.prompt).not.toMatch(/DO_NOT_DISPATCH|designDecisions/)
  expect(estimateTokens(compactQuestDispatch(q, "x"))).toBeLessThan(1_100)
  const owned = { ...q, integrationOwner: "ses_owner" }
  expect(toNativeSubagentInput({ questID: q.id, task: "Implement" }, owned).agent).toBe("build")
})

test("prepared original input carries the host chip before execute-time rewriting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prepared-dispatch-"))
  try {
    const api = createQuestAgentAPI(dir)
    const quest = api.create({ title: "Canonical chip", objective: "Plan only", steps: ["Plan"] })
    const tool = questTool(api)
    const output = await tool.execute({ action: "prepare-dispatch", id: quest.id, input: { task: "Plan", model: "cliproxyapi/gpt-6-astra" } })
    const original = JSON.parse(output.content).dispatch
    expect(validatePreparedSubagent(original, quest).agent).toBe("astra-proxy")
    expect(() => validatePreparedSubagent({ ...original, description: "wrong chip" }, quest)).toThrow("stale")
    expect(() => validatePreparedSubagent(original, { ...quest, title: "Renamed" })).toThrow("stale")
    expect(original.agent).toBe("astra-proxy")
    expect(original.description).toBe("(Canonical chip, cliproxyapi/gpt-6-astra, high)")
    expect(original).toEqual(preparedDispatch({ task: "Plan", model: "cliproxyapi/gpt-6-astra" }, quest))
    const { canonicalizeDispatch } = await import("../orchestration/dispatch")
    expect(canonicalizeDispatch({ tool: "subagent", sessionID: "parent", callID: "call", input: original })?.providerID).toBe("cliproxyapi")
    expect(() => canonicalizeDispatch({ tool: "subagent", sessionID: "parent", callID: "call", input: { ...original, agent: "astra" } })).toThrow("forbidden")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("MCP dispatch derives a bounded current slice and ignores caller context dumps", async () => {
  const dir = mkdtempSync(join(tmpdir(), "quest-mcp-context-"))
  const questID = "01j00000000000000000000421"
  let dispatched = ""
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/api/session" && request.method === "POST") return Response.json({ data: { id: "ses_compact", location: { directory: dir } } })
      if (path === "/api/session/ses_compact/prompt" && request.method === "POST") {
        dispatched = String((await request.json() as { text?: string }).text ?? "")
        return Response.json({ data: {} })
      }
      return new Response("not found", { status: 404 })
    },
  })
  try {
    const quests = join(dir, ".opencode", "quests")
    mkdirSync(quests, { recursive: true })
    const q = newQuest({ id: questID, title: "Compact dispatch", objective: "Implement the current stage without duplicating metadata" })
    writeFileSync(join(quests, `${questID}--compact.md`), [
      "---",
      `id: ${JSON.stringify(q.id)}`,
      `title: ${JSON.stringify(q.title)}`,
      `objective: ${JSON.stringify(q.objective)}`,
      `nextAction: ${JSON.stringify("Run focused tests")}`,
      `scope: ${JSON.stringify({ repos: [dir], include: ["quest/context.ts"], exclude: ["generations/**"] })}`,
      `deliverables: ${JSON.stringify([{ id: "lean", title: "Keep prompts lean", status: "pending" }])}`,
      `acceptanceCriteria: ${JSON.stringify([{ id: "budget", text: "Dispatch stays under budget", satisfied: false }])}`,
      `usageInstructions: ${JSON.stringify(["Use the Quest board"] )}`,
      `extensions: ${JSON.stringify({ designDecisions: ["DO_NOT_DISPATCH_" + "x".repeat(10_000)] })}`,
      `integrationOwner: ${JSON.stringify("ses_owner")}`,
      "---",
    ].join("\n"))
    const child = Bun.spawn(["node", join(root, "harnesses", "opencode-mcp-stdio.mjs")], {
      env: { ...process.env, OPENCODE_SERVER_URL: `http://127.0.0.1:${server.port}`, OPENCODE_CWD: dir },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
      windowsHide: true,
    })
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "agent", arguments: {
      questID, model: "opencode-go/grok-4.6", task: "execute " + "t".repeat(10_000), constraints: "c".repeat(10_000), verification: "v".repeat(10_000),
    } } }) + "\n")
    child.stdin.end()
    await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    expect(estimateTokens(dispatched)).toBeLessThan(1_100)
    expect(dispatched).toContain(`Quest ${questID}: Compact dispatch`)
    expect(dispatched).toContain("Proof: command")
    expect(dispatched).not.toMatch(/DO_NOT_DISPATCH|designDecisions|cccccccccc|vvvvvvvvvv/)
  } finally {
    server.stop(true)
    rmSync(dir, { recursive: true, force: true })
  }
})
