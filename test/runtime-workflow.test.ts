import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runtimePrepareArgs, activeSessionID, generationRoot, recordRuntimeLoad, requestManagedRestart } from "../scripts/runtime-contract.mjs"
import { stageEntryAllowed } from "../scripts/plugin-deploy"

const root = join(import.meta.dir, "..")
test("runtime generation pin is exact, rejects traversal and missing generations", () => {
  const fixture = mkdtempSync(join(root, ".candidates", "runtime-test-"))
  try {
    const gen = join(fixture, "generations", "gen-test")
    mkdirSync(gen, { recursive: true }); writeFileSync(join(gen, "plugin-set.json"), "{}")
    expect(generationRoot(fixture, "gen-test")).toBe(gen)
    for (const value of ["..", "../gen-test", "gen-missing", "", "gen/other"]) expect(() => generationRoot(fixture, value)).toThrow()
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
test("managed slash request carries only the current session and owner token; loads record the actual generation", () => {
  const fixture = mkdtempSync(join(root, ".candidates", "runtime-test-"))
  const keys = ["OPENCODE_RUNTIME_CONTROL", "OPENCODE_RUNTIME_TOKEN", "OPENCODE_RUNTIME_RECEIPT", "OPENCODE_PLUGIN_GENERATION"]
  const prior = keys.map((key) => process.env[key])
  try {
    delete process.env.OPENCODE_RUNTIME_CONTROL
    expect(requestManagedRestart("ses_test")).toBe(false)
    process.env.OPENCODE_RUNTIME_CONTROL = fixture
    delete process.env.OPENCODE_RUNTIME_TOKEN
    expect(() => requestManagedRestart("ses_test")).toThrow("token missing")
    process.env.OPENCODE_RUNTIME_TOKEN = "test-owner"
    expect(requestManagedRestart("ses_test")).toBe(true)
    expect(JSON.parse(readFileSync(join(fixture, "restart.json"), "utf8"))).toEqual({ action: "restart", sessionID: "ses_test", token: "test-owner" })
    process.env.OPENCODE_PLUGIN_GENERATION = "gen-test"
    process.env.OPENCODE_RUNTIME_RECEIPT = join(fixture, "loads.jsonl")
    writeFileSync(join(fixture, ".deployment-source.json"), JSON.stringify({ commit: "source-sha" }))
    recordRuntimeLoad("server", fixture)
    expect(JSON.parse(readFileSync(join(fixture, "loads.jsonl"), "utf8"))).toMatchObject({ component: "server", generation: "gen-test", sourceCommit: "source-sha", pid: process.pid, root: fixture })
  } finally {
    keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i] })
    rmSync(fixture, { recursive: true, force: true })
  }
})
test("runtime verification artifacts never enter a promoted generation", () => {
  for (const path of ["run", ".visual-e2e", ".cache", "tmp"]) expect(stageEntryAllowed(path)).toBe(false)
})

test("restart takes the live host route over stale context and preserves a board return session", () => {
  const context = { sessionID: "ses_stale", ui: { router: { current: () => ({ type: "session", sessionID: "ses_live" }) } } }
  expect(activeSessionID(context)).toBe("ses_live")
  expect(activeSessionID({ ui: { router: { current: () => ({ type: "plugin", data: { returnRoute: { type: "session", sessionID: "ses_board" } } }) } } })).toBe("ses_board")
  expect(activeSessionID({ ui: { router: { current: () => ({ type: "home" }) } } })).toBeUndefined()
})

test("managed launch can retain its verified selection without staging dirty source",()=>{expect(runtimePrepareArgs(root,true)).toEqual(["-NoProfile","-File",join(root,"scripts/restart-opencode.ps1"),"-PrepareOnly","-NoDeploy"]);expect(runtimePrepareArgs(root)).not.toContain("-NoDeploy")})
