/**
 * @core-prevents a driven host writing into the real session database, quest ledger or state while it believes it is sandboxed, and its opposite: a drive asked to do real work opening onto an empty ledger, or onto a session that is not the registered Quest Giver and so cannot dispatch at all, or onto the giver with a model and agent forced over the ones that conversation already had, or reporting success the instant it sees work somebody else finished months ago
 * @core-observed On 2026-09-11 a Claude Code session drove the Quest Giver and asked it to dispatch a step of Quest 7f2d0f457a369ddbcf7a2b5253. The driver sandboxes every home, so the giver reported "Quest not found", confirmed the board was empty, and created a duplicate Quest 63ceca06f0e32ffc86fdaea969 in the sandbox and dispatched a worker against that instead. Pointed at the real homes it then failed the other way: a fresh session saw the real board's nine open Quests and could touch none of them, because the giver is one registered session and every quest tool answers "Continue in your existing Quest Giver". Attaching to that session then imposed the channel model on it, the turn failed with "The usage limit has been reached" on the exhausted openai account, and the host recovered onto the replacement model's default agent: session_v2.agent became "build" and the registered giver failed its own eligibility check. Fixed, the same drive then reported ok after 49s with zero tokens and the step still pending, because a worker session from 2026-09-06 on that Quest was marked completed and the sandbox condition took it for this run's.
 */
import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { REDIRECTED_HOMES, isolationEnvironment, driveEnvironment, driveSession, driveIdentity, conditionMet } from "../scripts/drive-isolation"

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

test("attaching carries no model or agent of its own, and a new session always gets both", () => {
  const none = () => false
  const all = () => true

  // The conversation already has a model and an agent, and they belong to whoever owns it.
  expect(driveIdentity({ attaching: true, model: "opencode-go/deepseek-v4.1-flash#high", chose: none })).toEqual([])
  expect(driveIdentity({ attaching: true, model: "m", agent: "quest-giver", chose: none })).toEqual([])

  // A caller who typed the flag means to change that session, so it is carried.
  expect(driveIdentity({ attaching: true, model: "m", agent: "a", chose: all })).toEqual(["--model", "m", "--agent", "a"])
  expect(driveIdentity({ attaching: true, model: "m", chose: (f) => f === "--model" })).toEqual(["--model", "m"])

  // A conversation being created has neither yet, so both are always chosen for it.
  expect(driveIdentity({ attaching: false, model: "m", chose: none })).toEqual(["--model", "m", "--agent", "quest-giver"])
  expect(driveIdentity({ attaching: false, model: "m", agent: "build", chose: none })).toEqual(["--model", "m", "--agent", "build"])
  expect(() => driveIdentity({ attaching: false, chose: none })).toThrow("--model")
})

test("a live run waits for work it caused, not for work the board already held", () => {
  const OLD = "2026-09-06T05:52:55.201Z"
  const NEW = "2026-09-11T08:41:00.000Z"
  const promptAt = Date.parse("2026-09-11T08:40:00.000Z")
  const historical = {
    stages: [{ status: "done" }, { status: "pending" }],
    sessions: [{ state: "completed", updatedAt: OLD }],
    history: [{ type: "stage-state", at: OLD }],
  }

  // The exact record that fired: one old completed worker and one old done step. A sandbox is
  // allowed to take them, because there everything present is this run's.
  expect(conditionMet({ condition: "worker-completed", live: true, promptAt, quests: [historical] })).toBe(false)
  expect(conditionMet({ condition: "quest-step-done", live: true, promptAt, quests: [historical] })).toBe(false)
  expect(conditionMet({ condition: "worker-completed", live: false, promptAt, quests: [historical] })).toBe(true)
  expect(conditionMet({ condition: "quest-step-done", live: false, promptAt, quests: [historical] })).toBe(true)

  // Work this run caused does satisfy it.
  expect(conditionMet({ condition: "worker-completed", live: true, promptAt, quests: [{ ...historical, sessions: [{ state: "completed", updatedAt: OLD }, { state: "completed", updatedAt: NEW }] }] })).toBe(true)
  expect(conditionMet({ condition: "quest-step-done", live: true, promptAt, quests: [{ ...historical, history: [{ type: "stage-state", at: OLD }, { type: "stage-state", at: NEW }] }] })).toBe(true)

  // A step that moved is not a step that finished: a fresh stage-state with nothing done yet — the
  // giver marking a step working — must not end the wait.
  expect(conditionMet({ condition: "quest-step-done", live: true, promptAt, quests: [{ stages: [{ status: "working" }], history: [{ type: "stage-state", at: NEW }] }] })).toBe(false)

  // Neither does a fresh event of some other kind, nor an unparseable or missing timestamp.
  expect(conditionMet({ condition: "quest-step-done", live: true, promptAt, quests: [{ stages: [{ status: "done" }], history: [{ type: "patched", at: NEW }] }] })).toBe(false)
  expect(conditionMet({ condition: "worker-completed", live: true, promptAt, quests: [{ sessions: [{ state: "completed" }] }] })).toBe(false)
  expect(conditionMet({ condition: "worker-completed", live: true, promptAt, quests: [{ sessions: [{ state: "completed", updatedAt: "soon" }] }] })).toBe(false)
  expect(conditionMet({ condition: "worker-completed", live: true, promptAt, quests: [] })).toBe(false)
})
