import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { queryPapercuts, recordShell, markPapercut } from "../plugins-active/papercut-memory"
import { createPapercutFollowup, renderPapercutScreen, renderPapercutText, replayPapercut } from "../papercut/papercut-ui"

function fixture() { const dir = mkdtempSync(join(tmpdir(), "papercut-ui-")); return { dir, file: join(dir, "papercuts.json") } }
describe("papercut UI and safe replay", () => {
  test("captures and deduplicates missing worktree failures with linkage", () => {
    const x = fixture(), event = { tool: "shell", sessionID: "ses_missing", questID: "quest_missing", input: { command: "cd AppData\\Local\\Temp\\opencode\\quest-multirequest-orchestration-hardening && Get-ChildItem -Force; git status --short --branch; git log --oneline -5", cwd: "C:\\Users\\dev\\AppData\\Local\\Temp\\opencode\\quest-multirequest-orchestration-hardening", shell: "powershell" } }
    recordShell(event, { error: "Working directory does not exist: C:\\Users\\dev\\AppData\\Local\\Temp\\opencode\\quest-multirequest-orchestration-hardening" }, x.file)
    recordShell({ ...event, sessionID: "ses_missing_again" }, { error: "Working directory does not exist: C:\\Users\\dev\\AppData\\Local\\Temp\\opencode\\quest-multirequest-orchestration-hardening" }, x.file)
    const rows = queryPapercuts({ state: "unresolved", family: "workspace" }, x.file)
    expect(rows).toHaveLength(1); expect(rows[0].occurrences).toBe(2); expect(rows[0].errorSignature).toBe("missing-working-directory"); expect(rows[0].cwd).toContain("quest-multirequest"); expect(rows[0].failure.questID).toBe("quest_missing"); expect(rows[0].suggestedRemediation).toContain("validate"); expect(rows[0].failure.excerpt.length).toBeLessThanOrEqual(240); expect(rows[0].command).not.toContain("C:\\Users")
    const text = renderPapercutText(renderPapercutScreen({ state: "unresolved", family: "workspace" }, x.file, rows[0].id)); expect(text).toContain("missing-working-directory"); expect(text).toContain("Suggested remediation"); rmSync(x.dir, { recursive: true, force: true })
  })
  test("replay previews, declines, fails closed, and records explicit evidence", async () => {
    const x = fixture(); recordShell({ tool: "shell", sessionID: "s", input: { command: "npm test", cwd: "/repo" } }, { exitCode: 1, stderr: "missing working directory" }, x.file); const row = queryPapercuts({}, x.file)[0]; markPapercut(row.id, "npm install", "operator approved", x.file)
    const declined = await replayPapercut(row.id, { file: x.file }); expect(declined.status).toBe("declined"); const blocked = await replayPapercut(row.id, { file: x.file, confirm: "APPLY" }); expect(blocked.status).toBe("unavailable"); const failed = await replayPapercut(row.id, { file: x.file, confirm: "APPLY", allowExecution: true, execute: () => { throw new Error("no") } }); expect(failed.status).toBe("failed"); const updated = queryPapercuts({}, x.file)[0]; expect(updated.evidence?.map(e => e.outcome)).toEqual(["declined", "unavailable", "failed"]); rmSync(x.dir, { recursive: true, force: true })
  })
  test("creates an unresolved follow-up Quest only when requested", () => {
    const x = fixture(); recordShell({ tool: "shell", sessionID: "s", input: { command: "git status", cwd: x.dir } }, { error: "Working directory does not exist" }, x.file); const row = queryPapercuts({}, x.file)[0]; const q = createPapercutFollowup(row.id, x.dir, x.file); expect(q?.state).toBe("Waiting"); expect(q?.extensions.papercutID).toBe(row.id); expect(createPapercutFollowup(row.id, x.dir, x.file)?.id).toBe(q?.id); rmSync(x.dir, { recursive: true, force: true })
  })
})
