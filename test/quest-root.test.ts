import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir, homedir } from "node:os"
import { questRoot, questRootSource } from "../quest/root"
import { QuestStore } from "../quest/store"
import { listQuestFiles } from "../quest/index"
import { prepareNativeSubagent } from "../quest/spawn"
import { createQuestAgentAPI } from "../quest/agent-api"
import { questTool } from "../plugins-active/quests"

function content(result: any) { return JSON.parse(result.content) }

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prior = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(vars)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  try { return fn() } finally {
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
}

test("questRoot ignores cwd and session dir entirely, resolving only an explicit ledger pin or homedir", () => {
  const pinned = mkdtempSync(join(tmpdir(), "quest-root-pin-"))
  const foreignCwd = mkdtempSync(join(tmpdir(), "quest-root-foreign-"))
  const priorCwd = process.cwd()
  try {
    process.chdir(foreignCwd)
    withEnv({ OPENCODE_QUEST_ROOT: pinned, OPENCODE_PROJECT_ROOT: undefined }, () => {
      expect(questRoot()).toBe(pinned)
      expect(questRootSource()).toEqual({ root: pinned, pinned: true, pinVar: "OPENCODE_QUEST_ROOT" })
    })
    withEnv({ OPENCODE_QUEST_ROOT: undefined, OPENCODE_PROJECT_ROOT: undefined }, () => {
      // Never the foreign cwd we just chdir'd into -- only the pin or homedir.
      expect(questRoot()).not.toBe(foreignCwd)
      expect(questRootSource().pinned).toBe(false)
    })
  } finally {
    process.chdir(priorCwd)
    rmSync(pinned, { recursive: true, force: true })
    rmSync(foreignCwd, { recursive: true, force: true })
  }
})

test("a dispatched worker's target cwd in a foreign project dir does not change which ledger the Quest is read from", () => {
  const canonical = mkdtempSync(join(tmpdir(), "quest-root-canonical-"))
  const foreignCwd = mkdtempSync(join(tmpdir(), "quest-root-dispatch-foreign-"))
  try {
    const quest = new QuestStore(canonical).create({ id: "01j0rtregress0000000000001", title: "Regression", objective: "Dispatch must not guess a root from cwd" })
    withEnv({ OPENCODE_QUEST_ROOT: canonical }, () => {
      // The Quest exists only under `canonical`; a foreign target cwd must not
      // cause dispatch to look there (or anywhere else) for it.
      const prepared = prepareNativeSubagent({ questID: quest.id, task: "continue the work", cwd: foreignCwd })
      expect(prepared.prompt).toContain(quest.id)
      expect(existsSync(join(foreignCwd, ".opencode", "quests"))).toBe(false)
    })
  } finally {
    rmSync(canonical, { recursive: true, force: true })
    rmSync(foreignCwd, { recursive: true, force: true })
  }
})

test("a broken ledger root surfaces its error instead of silently reporting zero Quests", () => {
  const broken = mkdtempSync(join(tmpdir(), "quest-root-broken-"))
  try {
    // .opencode/quests exists as a *file*, not a directory: readdirSync must
    // throw ENOTDIR, not be swallowed into the same empty list a genuinely
    // fresh, never-initialized root would deterministically return.
    mkdirSync(join(broken, ".opencode"), { recursive: true })
    writeFileSync(join(broken, ".opencode", "quests"), "not a directory")
    expect(() => listQuestFiles(broken)).toThrow()

    const fresh = mkdtempSync(join(tmpdir(), "quest-root-fresh-"))
    try { expect(listQuestFiles(fresh)).toEqual([]) } finally { rmSync(fresh, { recursive: true, force: true }) }
  } finally {
    rmSync(broken, { recursive: true, force: true })
  }
})

test("the quest tool's get/list/board/create outputs disclose which ledger root answered", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-root-disclose-"))
  try {
    const tool = questTool(createQuestAgentAPI(root))
    const created = content(await tool.execute({ action: "create", input: { title: "Disclosed", objective: "Root is visible" } }))
    expect(created.ledgerRoot).toBe(root)
    expect(content(await tool.execute({ action: "get", id: created.id })).ledgerRoot).toBe(root)
    expect(content(await tool.execute({ action: "list" })).ledgerRoot).toBe(root)
    expect(content(await tool.execute({ action: "board" })).ledgerRoot).toBe(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test("legacy project roots and relative pins cannot redirect the global ledger", () => {
  withEnv({ OPENCODE_QUEST_ROOT: undefined, OPENCODE_PROJECT_ROOT: process.cwd() }, () => {
    expect(questRootSource()).toEqual({ root: homedir(), pinned: false })
  })
  for (const pin of process.platform === "win32" ? [".", "C:ledger", "\\ledger"] : ["."]) {
    withEnv({ OPENCODE_QUEST_ROOT: pin, OPENCODE_PROJECT_ROOT: undefined }, () => {
      expect(() => questRoot()).toThrow("absolute")
    })
  }
})

test("fix_papercut writes to the canonical ledger from a foreign project and deduplicates", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-papercut-global-"))
  const foreign = mkdtempSync(join(tmpdir(), "quest-papercut-project-"))
  const oldCwd = process.cwd()
  const oldRoot = process.env.OPENCODE_QUEST_ROOT, oldFile = process.env.OPENCODE_PAPERCUT_FILE
  try {
    process.env.OPENCODE_QUEST_ROOT = root
    process.env.OPENCODE_PAPERCUT_FILE = join(root, "papercuts.json")
    process.chdir(foreign)
    const { default: plugin, recordShell, queryPapercuts } = await import("../papercut/server")
    recordShell({ tool: "shell", sessionID: "fixture", input: { command: "git status", cwd: foreign } }, { error: "Working directory does not exist" })
    const row = queryPapercuts()[0]
    const tools: any[] = []
    await (plugin as any).setup({ tool: { transform: async (fn: any) => fn({ add: (t: any) => tools.push(t) }) } })
    const fix = tools.find(t => t.name === "fix_papercut")
    await fix.execute({ id: row.id })
    await fix.execute({ id: row.id })
    expect(listQuestFiles(root)).toHaveLength(1)
    expect(existsSync(join(foreign, ".opencode"))).toBe(false)
  } finally {
    process.chdir(oldCwd)
    for (const [key, value] of Object.entries({ OPENCODE_QUEST_ROOT: oldRoot, OPENCODE_PAPERCUT_FILE: oldFile })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
    rmSync(foreign, { recursive: true, force: true })
  }
})
