import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commandFamily, formatFixPlan, formatPapercuts, markPapercut, queryPapercuts, recordShell } from "../plugins-active/papercut-memory"
import papercutPlugin, { hangThresholdMs, recordHang, setHangClock, type HangClock } from "../plugins-active/papercut-memory"

function fixture() { const dir = mkdtempSync(join(tmpdir(), "papercut-")); return { file: join(dir, "ledger.json"), dir } }
describe("papercut memory", () => {
  test("dedupes failures, redacts secrets, and links conservative success", () => {
    const x = fixture(); const base = { tool: "shell", sessionID: "ses_fail", input: { command: "git checkout -b feature", cwd: "C:\\work\\repo", shell: "powershell" }, id: "a" }
    recordShell(base, { exitCode: 1, stderr: "Filename too long token=supersecretvalue123456789012345678901234" }, x.file)
    recordShell({ ...base, id: "b", sessionID: "ses_fail2" }, { exitCode: 1, stderr: "Filename too long token=supersecretvalue123456789012345678901234" }, x.file)
    recordShell({ tool: "shell", id: "c", sessionID: "ses_ok", input: { command: "git -c core.longpaths=true checkout -b feature", cwd: "C:\\work\\repo" } }, { exitCode: 0, stdout: "ok" }, x.file)
    const rows = queryPapercuts({ repo: "c:\\work\\repo" }, x.file); expect(rows).toHaveLength(1); expect(rows[0].occurrences).toBe(2); expect(rows[0].state).toBe("resolved"); expect(rows[0].solutions[0].command).toContain("core.longpaths"); expect(JSON.stringify(rows)).not.toContain("supersecret")
    rmSync(x.dir, { recursive: true, force: true })
  })
  test("does not pair unrelated successes and supports explicit links", () => { const x = fixture(); recordShell({ tool: "shell", id: "a", sessionID: "ses_a", input: { command: "npm test", cwd: "/repo" } }, { exitCode: 1, stderr: "cannot find module" }, x.file); recordShell({ tool: "shell", id: "b", sessionID: "ses_b", input: { command: "git status", cwd: "/repo" } }, { exitCode: 0, stdout: "clean" }, x.file); let rows = queryPapercuts({ repo: "/repo" }, x.file); expect(rows[0].state).toBe("unresolved"); markPapercut(rows[0].id, "node_modules junction", "operator confirmed", x.file); rows = queryPapercuts({ state: "resolved", repo: "/repo" }, x.file); expect(rows[0].solutions[0].evidence).toBe("operator confirmed"); rmSync(x.dir, { recursive: true, force: true }) })
  test("handles timeout, masking, filters, and friendly empty output", () => { const x = fixture(); recordShell({ tool: "pwsh", id: "t", sessionID: "ses_t", input: { command: "npm install", cwd: "/repo" } }, { noResponse: true }, x.file); recordShell({ tool: "shell", id: "m", sessionID: "ses_m", input: { command: "false; exit 0", cwd: "/repo" } }, { exitCode: 0, stderr: "error: masked" }, x.file); expect(queryPapercuts({ errorSignature: "timeout-or-no-response" }, x.file)).toHaveLength(1); expect(formatPapercuts(queryPapercuts({}, x.file))).toContain("occurrence"); expect(formatPapercuts([])).toContain("No papercuts"); rmSync(x.dir, { recursive: true, force: true }) })
  test("classifies command families", () => { expect(commandFamily("git -c core.longpaths=true status")).toBe("git"); expect(commandFamily("npm test")).toBe("node-dependencies") })
  test("records OpenCode V2 {output, metadata.exit} failures with excerpt", () => {
    const x = fixture()
    recordShell({ tool: "shell", sessionID: "ses_v2", callID: "c1", args: { command: "git status", cwd: "/repo" } }, { title: "git status", output: "fatal: not a git repository (or any of the parent directories): .git", metadata: { exit: 128 } }, x.file)
    const rows = queryPapercuts({ repo: "/repo" }, x.file)
    expect(rows).toHaveLength(1)
    expect(rows[0].failure.status).toBe("failed")
    expect(rows[0].failure.excerpt).toContain("fatal: not a git repository")
    expect(rows[0].errorSignature).not.toBe("5d28a90f4498")
    expect(formatFixPlan(rows[0], "quest-1")).toContain("Do the fix yourself")
    expect(formatFixPlan(rows[0], "quest-1")).toContain("quest: quest-1")
    expect(formatPapercuts(rows)).toContain("fix: call fix_papercut")
    rmSync(x.dir, { recursive: true, force: true })
  })
  test("dogfood: timeout then explicit local artifact gate is linked with bounded evidence", () => { const x = fixture(); const cwd = "/repo"; recordShell({ tool: "pwsh", id: "remote", sessionID: "ses_timeout", input: { command: "artifact-gate.ps1 -RepoUrl https://github.com/example/t3code.git", cwd, shell: "powershell" } }, { timeout: true, stderr: "remote source discovery timed out after 120s; " + "x".repeat(10000) }, x.file); recordShell({ tool: "pwsh", id: "local", sessionID: "ses_local", input: { command: "artifact-gate.ps1 -RepoRoot C:\\work\\t3code -ArtifactPath C:\\work\\t3code\\apps\\server\\dist\\bin.mjs -PublishStatus credentials-limitation -VpsRepoRoot C:\\work\\vps-code -ExpectedVpsCommit 43ef4c5", cwd, shell: "powershell" } }, { exitCode: 0, stdout: "ARTIFACT-GATE PASS source; PASS artifact; PASS publish; PASS vps" }, x.file); const rows = queryPapercuts({ repo: cwd, state: "resolved" }, x.file); expect(rows).toHaveLength(1); expect(rows[0].failure.status).toBe("timeout"); expect(rows[0].failure.error).toBeUndefined(); expect(rows[0].solutions[0].command).toContain("-RepoRoot"); expect(rows[0].solutions[0].evidence).toContain("PASS artifact"); expect(rows[0].solutions[0].confidence).toBe(0.65); expect(rows[0].failure.sessionID).toBe("ses_timeout"); expect(rows[0].solutions[0].sessionID).toBe("ses_local"); expect(rows[0].failure.excerpt.length).toBeLessThanOrEqual(240); rmSync(x.dir, { recursive: true, force: true }) })
})

async function captureHooks() {
  const hooks: Record<string, (e: any, out?: any) => void> = {}
  await (papercutPlugin as any).setup({ tool: { hook: async (name: string, fn: any) => { hooks[name] = fn } } })
  return hooks
}
function immediateClock(): { clock: HangClock; fire: () => void } {
  let fire: (() => void) | undefined
  const clock: HangClock = { now: Date.now, setTimeout: ((fn: any) => { fire = fn; return { unref() {} } }) as any, clearTimeout: () => {} }
  return { clock, fire: () => fire?.() }
}

describe("papercut hang detection", () => {
  test("hang timer records a no-response papercut; late completion reconciles evidence and links the solution", async () => {
    const x = fixture()
    setHangClock(undefined)
    const { clock, fire } = immediateClock()
    setHangClock(clock)
    try {
      const hooks = await captureHooks()
      const ev = { tool: "shell", callID: "k1", sessionID: "ses_hang", input: { command: "git fetch --all", cwd: "C:\\work\\repo", shell: "powershell" } }
      process.env.OPENCODE_PAPERCUT_FILE = x.file
      hooks["execute.before"](ev)
      fire() // hang threshold elapses while the call is still pending
      let rows = queryPapercuts({ errorSignature: "timeout-or-no-response", repo: "c:\\work\\repo" }, x.file)
      expect(rows).toHaveLength(1)
      expect(rows[0].failure.status).toBe("no-response")
      expect(rows[0].failure.excerpt).toContain("no output for")
      expect(rows[0].failure.excerpt).toContain("git fetch --all")
      hooks["execute.after"](ev, { exitCode: 0, stdout: "fetched" }) // the command eventually finished
      rows = queryPapercuts({ repo: "c:\\work\\repo" }, x.file)
      expect(rows).toHaveLength(1)
      expect(rows[0].evidence?.some((e) => e.kind === "note" && e.detail.includes("eventually exited 0 after"))).toBe(true)
      expect(rows[0].state).toBe("resolved")
      expect(rows[0].solutions[0]?.evidence).toBe("completed after hang")
      expect(rows[0].solutions[0]?.confidence).toBe(0.4)
      expect(rows[0].solutions[0]?.command).toContain("git fetch --all")
    } finally { setHangClock(undefined); delete process.env.OPENCODE_PAPERCUT_FILE; rmSync(x.dir, { recursive: true, force: true }) }
  })
  test("non-hang path is unchanged: the hooked path records exactly what recordShell records", async () => {
    const hooked = fixture(), direct = fixture()
    setHangClock(undefined)
    try {
      const hooks = await captureHooks()
      const ev = { tool: "shell", callID: "c9", sessionID: "ses_same", input: { command: "git status --short", cwd: "/repo" } }
      process.env.OPENCODE_PAPERCUT_FILE = hooked.file
      hooks["execute.before"](ev)
      hooks["execute.after"](ev, { exitCode: 1, stderr: "fatal: bad object HEAD" })
      recordShell(ev, { exitCode: 1, stderr: "fatal: bad object HEAD" }, direct.file)
      const a = queryPapercuts({ repo: "/repo" }, hooked.file), b = queryPapercuts({ repo: "/repo" }, direct.file)
      expect(a).toHaveLength(1)
      expect(queryPapercuts({ errorSignature: "timeout-or-no-response" }, hooked.file)).toHaveLength(0)
      const strip = (r: any) => { const c = JSON.parse(JSON.stringify(r)); c.failure.at = ""; c.failure.endedAt = ""; c.lastSeen = ""; return c }
      expect(strip(a[0])).toEqual(strip(b[0]))
    } finally { delete process.env.OPENCODE_PAPERCUT_FILE; rmSync(hooked.dir, { recursive: true, force: true }); rmSync(direct.dir, { recursive: true, force: true }) }
  })
  test("recordHang maps a supervisor BLOCKED/HUNG event into the timeout-or-no-response bucket", () => {
    const x = fixture()
    try {
      const fingerprint = recordHang({ command: "claude.exe --print do the thing", cwd: "/repo", sessionID: "ses_blk" }, 45_000, x.file)
      expect(fingerprint).toBeTruthy()
      const rows = queryPapercuts({ errorSignature: "timeout-or-no-response", repo: "/repo" }, x.file)
      expect(rows).toHaveLength(1)
      expect(rows[0].failure.status).toBe("no-response")
      expect(rows[0].failure.excerpt).toContain("no output for 45s while running: claude.exe")
      expect(rows[0].failure.durationMs).toBe(45_000)
      expect(rows[0].failure.sessionID).toBe("ses_blk")
    } finally { rmSync(x.dir, { recursive: true, force: true }) }
  })
  test("hang threshold honors the env override and clamps to 10s", () => {
    const prev = process.env.OPENCODE_PAPERCUT_HANG_MS
    try {
      process.env.OPENCODE_PAPERCUT_HANG_MS = "50"; expect(hangThresholdMs()).toBe(10_000)
      process.env.OPENCODE_PAPERCUT_HANG_MS = "30000"; expect(hangThresholdMs()).toBe(30_000)
      delete process.env.OPENCODE_PAPERCUT_HANG_MS; expect(hangThresholdMs()).toBe(120_000)
    } finally { if (prev === undefined) delete process.env.OPENCODE_PAPERCUT_HANG_MS; else process.env.OPENCODE_PAPERCUT_HANG_MS = prev }
  })
})
