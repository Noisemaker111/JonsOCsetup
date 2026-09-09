import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createQuestAgentAPI } from "../quest/agent-api"
import { questTool } from "../plugins-active/quests"

function content(result: any) {
  return JSON.parse(result.content)
}

test("the Quest tool explicitly creates and manages many sessions and lifecycle actions", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-tool-"))
  try {
    const tool = questTool(createQuestAgentAPI(root))
    const created = content(await tool.execute({ action: "create", verbose: true, input: { title: "Explicit", objective: "Only by tool" } }))
    expect(content(await tool.execute({ action: "accept", id: created.id, verbose: true, input: { owner: "owner" } })).sessions).toEqual([])
    await tool.execute({ action: "start-session", id: created.id, input: { sessionID: "ses_one" } })
    const parallel = content(await tool.execute({ action: "start-session", id: created.id, verbose: true, input: { sessionID: "ses_two" } }))
    expect(parallel.sessions.map((session: any) => session.sessionID)).toEqual(["ses_one", "ses_two"])
    const reviewed = content(await tool.execute({ action: "evidence", id: created.id, verbose: true, kind: "review", value: JSON.stringify({ verdict: "CLEAN", at: "2026-08-30T00:00:00.000Z", evidence: "verified" }) }))
    expect(reviewed.evidence.review).toEqual({ verdict: "CLEAN", at: "2026-08-30T00:00:00.000Z", evidence: "verified" })
    const published = content(await tool.execute({ action: "evidence", id: created.id, verbose: true, kind: "publish", value: JSON.stringify({ target: "github", result: "succeeded", at: "2026-09-03T00:00:00.000Z" }) }))
    expect(published.evidence.publish[0]).toMatchObject({ target: "github", result: "succeeded" })
    expect(content(await tool.execute({ action: "archive", id: created.id })).state).toBe("Archived")
    expect(content(await tool.execute({ action: "reopen", id: created.id })).state).toBe("Working")
    expect(content(await tool.execute({ action: "abandon", id: created.id })).abandoned).toBe(true)
    await expect(tool.execute({ action: "delete", id: created.id })).rejects.toThrow("confirmed=true")
    await tool.execute({ action: "delete", id: created.id, confirmed: true })
    expect(content(await tool.execute({ action: "get", id: created.id }))).toBeNull()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("action=admit folds board+search+create into one call and discloses the outcome", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-admit-"))
  try {
    const tool = questTool(createQuestAgentAPI(root))
    const first = content(await tool.execute({ action: "admit", verbose: true, input: { title: "Fold intake", objective: "fold the intake pattern", steps: ["Wire it", "Verify it"], usageInstructions: ["Run it"] } }))
    expect(first.outcome).toBe("created")
    expect(first.quest.stages.map((stage: any) => stage.title)).toEqual(["Wire it", "Verify it"])
    expect(first.quest.usageInstructions).toEqual(["Run it"])
    expect(first.ledgerRoot).toBe(root)

    const second = content(await tool.execute({ action: "admit", verbose: true, input: { title: "Fold intake", objective: "fold the intake pattern" } }))
    expect(second.outcome).toBe("existing")
    expect(second.quest.id).toBe(first.quest.id)

    expect(content(await tool.execute({ action: "list" })).items.length).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

async function cli(root: string, ...args: string[]) {
  const child = Bun.spawn(["bun", join(process.cwd(), "quest", "quest-cli.ts"), ...args], {
    cwd: process.cwd(), env: { ...process.env, OPENCODE_QUEST_ROOT: root }, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true,
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stdout, stderr }
}

test("the CLI exposes explicit create, lifecycle, session and confirmed delete", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-cli-"))
  try {
    const created = await cli(root, "create", "CLI Quest")
    expect(created.code).toBe(0)
    const id = JSON.parse(created.stdout).id
    expect((await cli(root, "accept", id, "cli-owner")).code).toBe(0)
    expect((await cli(root, "start-session", id, "ses_cli")).stdout).toContain("ses_cli")
    expect((await cli(root, "reopen", id)).code).not.toBe(0)
    expect((await cli(root, "archive", id)).code).toBe(0)
    expect((await cli(root, "reopen", id)).code).toBe(0)
    expect((await cli(root, "abandon", id)).code).toBe(0)
    expect((await cli(root, "delete", id)).code).not.toBe(0)
    expect((await cli(root, "delete", id, "--confirm")).code).toBe(0)
    expect(existsSync(join(root, ".opencode", ".quest-runtime", "deleted", `${id}.md`))).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
