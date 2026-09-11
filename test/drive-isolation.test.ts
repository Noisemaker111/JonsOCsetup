/**
 * @core-prevents a driven host writing into the real session database, quest ledger or state while it believes it is sandboxed, and its opposite: a drive asked to do real work opening onto an empty ledger, or onto a session that is not the registered Quest Giver and so cannot dispatch at all
 * @core-observed On 2026-09-11 a Claude Code session drove the Quest Giver and asked it to dispatch a step of Quest 7f2d0f457a369ddbcf7a2b5253. The driver sandboxes every home, so the giver reported "Quest not found", confirmed the board was empty, and created a duplicate Quest 63ceca06f0e32ffc86fdaea969 in the sandbox and dispatched a worker against that instead. Pointed at the real homes it then failed the other way: a fresh session saw the real board's nine open Quests and could touch none of them, because the giver is one registered session and every quest tool answers "Continue in your existing Quest Giver".
 */
import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { REDIRECTED_HOMES, isolationEnvironment, driveEnvironment, driveSession } from "../scripts/drive-isolation"

const base = { HOME: "C:/real-home", USERPROFILE: "C:/real-home", PATH: "/usr/bin" } as NodeJS.ProcessEnv
const out = "C:/evidence/run-1"
const build = (live: boolean) => driveEnvironment({ base, root: "C:/release", out, live, bridgePort: 41000 })

test("isolation is all of the real homes or none of them, never a subset", () => {
  const isolated = build(false)
  const live = build(true)

  // A forgotten entry is the whole failure: one home left pointing at the real path turns a check
  // into a session that writes real data. Every declared home must move, and move into `out`.
  for (const key of REDIRECTED_HOMES) {
    expect(isolated[key]).toBeDefined()
    expect(isolated[key]!.replace(/\\/g, "/").startsWith(out)).toBe(true)
  }
  // The table and the redirect cannot drift: isolation sets exactly the declared homes plus the
  // project-config switch, and nothing else that live mode would then fail to restore.
  expect(Object.keys(isolationEnvironment(out)).sort())
    .toEqual([...REDIRECTED_HOMES, "OPENCODE_CONFIG_PROJECT_DISABLE"].sort())

  // Live mode is the exact negation: the host keeps every real home, so the Quest Giver sees the
  // board that actually exists rather than an empty one it will fill with duplicates.
  for (const key of REDIRECTED_HOMES) expect(live[key]).toBeUndefined()
  expect(live.OPENCODE_CONFIG_PROJECT_DISABLE).toBeUndefined()

  // What both modes share is the release under test and no silent self-update mid-drive.
  for (const env of [isolated, live]) {
    expect(env.OPENCODE_CONFIG_DIR).toBe("C:/release")
    expect(env.OPENCODE_RELEASE_CHANNEL).toBe("dev")
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1")
    expect(env.PATH).toBe("/usr/bin")
  }
})

test("a self-cleaning test change is refused against the real ledger", () => {
  // --test-change removes the worker worktrees its quests name and then deletes the evidence.
  // Against the real ledger those worktrees are other sessions' work, so the combination must fail
  // before the host starts rather than be caught by whoever reads the report afterwards.
  const script = join(import.meta.dir, "..", "scripts", "drive-giver.ts")
  const run = spawnSync("bun", [script, "--live", "--test-change"], { encoding: "utf8", windowsHide: true, timeout: 60000 })
  expect(run.status).not.toBe(0)
  expect(run.stderr).toContain("never runs against the real ledger")
})

test("a live drive opens the registered Quest Giver, and an isolated one never does", () => {
  const bound = { state: "bound", sessionID: "ses_f78f74a45ffe21wnaHpKGppeNw" }

  // The whole point of --live: talk to the session that actually holds the giver's tools.
  expect(driveSession({ live: true, registered: bound })).toBe(bound.sessionID)

  // An isolated drive's ledger and database are empty by construction, so there is no giver to
  // attach to and attaching to a real session id would defeat the isolation.
  expect(driveSession({ live: false, registered: bound })).toBeUndefined()

  // A registry mid-write, or one whose last attempt failed, is not a giver to open.
  for (const registered of [undefined, {}, { state: "launching" }, { state: "unknown" }, { state: "bound" }, { state: "bound", sessionID: 42 }, { state: "bound", sessionID: "not-a-session" }])
    expect(driveSession({ live: true, registered: registered as any })).toBeUndefined()

  // Opting out is explicit, and pinning wins in either mode so a specific conversation can be driven.
  expect(driveSession({ live: true, newSession: true, registered: bound })).toBeUndefined()
  expect(driveSession({ live: true, newSession: true, pinned: "ses_other", registered: bound })).toBe("ses_other")
  expect(driveSession({ live: false, pinned: "ses_other" })).toBe("ses_other")

  // A malformed id is refused here rather than reaching the host as a bad argument.
  expect(() => driveSession({ live: true, pinned: "../etc" })).toThrow("ses_ identifier")
})
