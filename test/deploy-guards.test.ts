/**
 * Regression guards for the ways deployment broke in practice. Each of these
 * cost a debugging session; none of them announced itself as what it was.
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { VALIDATION_MODELS, bootHang, exhausted, pluginFault, stageEntryAllowed } from "../scripts/plugin-deploy"
import { assertSafeShell, isTempPath, workspaceViolations } from "../scripts/shell-guard"

const root = join(import.meta.dir, "..")

test("promotion uses one deterministic local fixture instead of a user-model fallback chain", () => {
  expect(VALIDATION_MODELS).toEqual(["validation-fixture/model"])
})

test("an exhausted plan is inconclusive, a plugin fault is a defect", () => {
  for (const out of ["Error: The usage limit has been reached", "Usage reached — grok-sub/grok-4.6", "status 429"]) {
    expect(`${out}: ${exhausted(out)}`).toBe(`${out}: true`)
    expect(`${out}: ${pluginFault(out)}`).toBe(`${out}: false`)
  }
  expect(pluginFault("Plugin failed to load")).toBe(true)
  expect(pluginFault("Invalid V2 TUI plugin module")).toBe(true)
})

test("pruning refuses to run while a host is live", () => {
  // A prune deleted the generation a running TUI had resolved at boot; the
  // next turn failed with no usable message and looked like a harness bug.
  const src = readFileSync(join(root, "scripts", "plugin-deploy.ts"), "utf8")
  expect(src).toMatch(/if\s*\(hostsRunning\(\)\)\s*return\s*\[\]/)
  // Fails closed: if it cannot tell, it does not delete.
  expect(src).toMatch(/catch\s*\{[\s\S]*?return true/)
})

test("ordinary prompts cannot create a Quest, including the promotion probe", () => {
  const deploy = readFileSync(join(root, "scripts", "plugin-deploy.ts"), "utf8")
  const plugin = readFileSync(join(root, "quest", "server.ts"), "utf8")
  expect(deploy).not.toMatch(/OPENCODE_QUEST_MODE:"off"|OPENCODE_QUEST_MODE:\s*"off"/)
  expect(plugin).not.toMatch(/session\?\.hook|hook\(["']context["']|admitUserContext/)
})

test("the smoke test fails loud when the plugin directory is missing", () => {
  // It scanned `plugins/`, renamed to `plugins-active/` long ago.
  // Get-ChildItem -Recurse on a missing path costs ~25s and returns nothing,
  // so two stale scans ate the 45s watchdog and every later gate never ran.
  const smoke = readFileSync(join(root, "smoke-test.ps1"), "utf8")
  expect(smoke).toContain('@("plugins-active", "quest", "orchestration", "models", "usage", "harnesses", "papercut")')
  expect(smoke).toContain("foreach ($pluginRoot in $plugins)")
  expect(smoke).toContain("Test-Path -LiteralPath $pluginRoot")
  expect(smoke).toContain("plugin directory not found")
})

const TEMP_DIR = String.raw`C:\Users\dev\AppData\Local\Temp\scratch`

test("a temp working directory is refused outright", () => {
  expect(isTempPath(String.raw`C:\Users\dev\AppData\Local\Temp\opencode\x`)).toBe(true)
  expect(isTempPath("C:/Users/dev/AppData/Local/Temp/x")).toBe(true)
  expect(isTempPath(String.raw`C:\Users\dev\.config\opencode`)).toBe(false)
  expect(workspaceViolations(TEMP_DIR)[0]?.rule).toBe("temp-workspace")
})

test("builds and clones into temp are refused, reads are not", () => {
  expect(() => assertSafeShell("bun install", TEMP_DIR)).toThrow(/temp/i)
  expect(() => assertSafeShell(`git clone https://x/y ${TEMP_DIR}`)).toThrow(/temp/i)
  expect(() => assertSafeShell(`Get-Content ${TEMP_DIR}\\probe.log`)).not.toThrow()
})

test("the shell guard receives the working directory, not just the command", () => {
  const router = readFileSync(join(root, "harnesses", "server.ts"), "utf8")
  expect(router).toMatch(/assertSafeShell\(command,\s*cwd\)/)
})

test("leaked test scratch directories are swept, live ones are not", () => {
  const { mkdtempSync, existsSync, utimesSync, rmSync } = require("node:fs")
  const { tmpdir } = require("node:os")
  const { join } = require("node:path")
  const { sweepScratch } = require("./scratch-sweep")

  const root = mkdtempSync(join(tmpdir(), "sweep-root-"))
  try {
    const stale = mkdtempSync(join(root, "quest-"))
    const fresh = mkdtempSync(join(root, "quest-"))
    const unrelated = mkdtempSync(join(root, "my-real-work-"))
    // Age the stale one past the grace period.
    const old = new Date(Date.now() - 60 * 60 * 1000)
    utimesSync(stale, old, old)

    expect(sweepScratch(root)).toBe(1)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(unrelated)).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the candidate is validated on its own bridge port, unconditionally", async () => {
  // The gate gives every candidate an OS-confirmed free port, rewrites the
  // candidate's provider baseURLs to it, and passes CLAUDE_CODE_BRIDGE_PORT so
  // the candidate's own bridge binds that port. A probe server on the rewritten
  // URL receives every chat completion, so the rewrite is what routes the
  // candidate's completions to its own bridge — no shared-port requirement,
  // which formerly made promotion impossible while the live host held 3012.
  const { portInUse, freePort } = await import("../scripts/plugin-deploy")
  const src = readFileSync(join(root, "scripts", "plugin-deploy.ts"), "utf8")
  expect(src).toMatch(/CLAUDE_CODE_BRIDGE_PORT:String\(bridgePort\)/)
  expect(src).toMatch(/const bridgePort=await freePort\(\)/)
  // Isolation is unconditional: the shared port is never required to be free.
  expect(src).not.toMatch(/if\(await portInUse\(bridgePort\)\)/)

  const port = await freePort()
  expect(await portInUse(port)).toBe(false)
  const held = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("x") })
  try { expect(await portInUse(port)).toBe(true) } finally { held.stop(true) }
})

test("harness provider baseURLs all point at the one bridge port", () => {
  const config = require("json5").parse(readFileSync(join(root, "opencode.jsonc"), "utf8"))
  for (const id of ["claude-code", "grok-build", "codex"]) {
    expect(`${id}: ${config.providers[id].settings.baseURL}`).toBe(`${id}: http://127.0.0.1:3012/v1`)
  }
})

test("no reserved DOS device name sits in the repo", async () => {
  // A file called `nul` (or con/prn/aux/com1/lpt1) cannot be read by git:
  // every commit afterwards dies with "fatal: mmap failed: Invalid argument".
  // Bun writes one when --outfile=/dev/null is passed under Git Bash, because
  // MSYS rewrites /dev/null in an argument to `nul`.
  const { RESERVED_NAMES } = await import("../scripts/shell-guard")
  const { readdirSync } = require("node:fs")
  const offenders = readdirSync(root).filter((n: string) => RESERVED_NAMES.test(n))
  expect(`reserved-name files: ${offenders.join(", ")}`).toBe("reserved-name files: ")
})

test("reserved DOS names are ignored and never copied into a generation candidate", async () => {
  const ignore = readFileSync(join(root, ".gitignore"), "utf8")
  for (const name of ["nul", "NUL.txt", "con", "prn.log", "aux", "com1", "LPT9.tmp"]) {
    expect(`${name}: ${stageEntryAllowed(name)}`).toBe(`${name}: false`)
  }
  expect(stageEntryAllowed("usage.tsx")).toBe(true)
  expect(ignore).toMatch(/^\/nul$/m)
  expect(ignore).toMatch(/^\/com\[1-9\]$/m)
})

test("candidate staging excludes live state, secrets, gates and generated caches", () => {
  for (const name of ["plugin-activation.json", "service.json", "smoke-test.ps1", "quest-smoke.ps1", "migration-reports", ".candidate-health-42.json", "bundle.cache", "state.tsbuildinfo"]) {
    expect(`${name}: ${stageEntryAllowed(name)}`).toBe(`${name}: false`)
  }
})

test("candidate validation keeps cli.json bootstrap directories and preflights TUI sources as extras", () => {
  const deploy = readFileSync(join(root, "scripts", "plugin-deploy.ts"), "utf8")
  expect(deploy).toMatch(/originalCli=readFileSync\(join\(candidate,"cli\.json"\)/)
  // beta-19059 skips cli.json FILE entries silently, so the candidate's
  // cli.json is never rewritten to point at tui-active files.
  expect(deploy).not.toMatch(/parsedCli\.plugins=/)
  expect(deploy).toMatch(/validateConfiguredPlugins\(candidate,healthFile,tuis\)/)
  expect(deploy).not.toMatch(/writeFileSync\(join\(candidate,"tui\.json"\)/)
  expect(deploy).toMatch(/rmSync\(healthFile,\{force:true\}\)/)
  expect(deploy).toMatch(/if\(linkedModules\)rmSync\(candidateModules,\{recursive:true,force:true\}\)/)
})

test("smoke uses the renamed quota test and fails before Bun when a path is missing", () => {
  const smoke = readFileSync(join(root, "smoke-test.ps1"), "utf8")
  expect(smoke).toContain("test/quota-cap-failover.test.ts")
  expect(smoke).not.toContain('"test/go-cap.test.ts"')
  expect(smoke).toMatch(/missingUsageTests[\s\S]*?Test-Path -LiteralPath[\s\S]*?exit 1/)
})

test("/dev/null as an argument is refused before it creates that file", async () => {
  const { shellViolations } = await import("../scripts/shell-guard")
  const rules = (cmd: string) => shellViolations(cmd).map((v) => v.rule)
  expect(rules("bun build a.ts --outfile=/dev/null")).toContain("devnull-argument")
  expect(rules("tsc --out /dev/null")).toContain("devnull-argument")
  // A redirect is fine — the shell handles it, no file is created.
  expect(rules("bun test 2>/dev/null")).not.toContain("devnull-argument")
})

test("legacy timeout classification remains diagnostic only", async () => {
  // A 180s timeout on the first model aborted the whole walk and quarantined a
  // healthy candidate, with "timeout" as the only evidence.
  const { inconclusive, pluginFault } = await import("../scripts/plugin-deploy")
  for (const out of ["timeout", "request timed out", "ECONNREFUSED 127.0.0.1:3012", "fetch failed", "socket hang up"]) {
    expect(`${out}: ${inconclusive(out)}`).toBe(`${out}: true`)
    expect(`${out}: ${pluginFault(out)}`).toBe(`${out}: false`)
  }
  // A real defect is still a defect.
  expect(inconclusive("Plugin failed to load")).toBe(false)
})

test("inconclusive output cannot authorize promotion", async () => {
  // 2026-09-03: the local CLIProxyAPI was down, every model printed
  // "ConnectionRefused: Unable to connect", and a candidate with zero static
  // failures was quarantined. That is a provider outage, not a plugin defect.
  const { inconclusive } = await import("../scripts/plugin-deploy")
  expect(inconclusive("Error: ConnectionRefused: Unable to connect. Is the computer able to access the url?")).toBe(true)
  const deploy = readFileSync(join(root, "scripts", "plugin-deploy.ts"), "utf8")
  expect(deploy).toContain("const promotable=validation.ok;")
  expect(deploy).not.toContain("for(const model of VALIDATION_MODELS)")
})

test("a silent timeout is a plugin fault, not an inconclusive one", () => {
  // The orchestration plugin awaited a never-ending event subscription in
  // setup(). The host hung before printing anything, every validation model
  // reported a bare "timeout", and the gate called it inconclusive — blaming
  // spent plans for a defect that was sitting in the candidate.
  expect(bootHang({ code: 124, out: "\n[timeout after 180000ms]" })).toBe(true)
  expect(bootHang({ code: 124, out: "" })).toBe(true)
  // A host that booted and then stalled waiting on a provider is a different
  // animal: it got far enough to print, so the candidate loaded.
  expect(bootHang({ code: 124, out: "> general · sonnet\n[timeout after 180000ms]" })).toBe(false)
  expect(bootHang({ code: 1, out: "" })).toBe(false)
})

test("output collected before a timeout is not discarded", () => {
  // hiddenRun used to replace everything it had read with the bare string
  // "timeout", which is why a boot hang and a stalled provider were
  // indistinguishable from the outside.
  const src = readFileSync(join(root, "scripts", "plugin-deploy.ts"), "utf8")
  expect(src).not.toMatch(/done\(\{code:124,out:"timeout"\}\)/)
  expect(src).toMatch(/timeout after \$\{timeout\}ms/)
})
