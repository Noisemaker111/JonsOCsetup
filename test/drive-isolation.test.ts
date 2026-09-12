/**
 * @core-prevents a driven host writing into the real session database, quest ledger or state while it believes it is sandboxed, and its opposite: a drive asked to do real work opening onto an empty ledger, or onto a session that is not the registered Quest Giver and so cannot dispatch at all, or onto the giver with a model and agent forced over the ones that conversation already had, or reporting success on a step it did not ask about, whether that step finished months ago or merely started moving, or stopping the host while a worker it just launched is still running
 * @core-observed On 2026-09-11 a Claude Code session drove the Quest Giver and asked it to dispatch a step of Quest 7f2d0f457a369ddbcf7a2b5253. The driver sandboxes every home, so the giver reported "Quest not found", confirmed the board was empty, and created a duplicate Quest 63ceca06f0e32ffc86fdaea969 in the sandbox and dispatched a worker against that instead. Pointed at the real homes it then failed the other way: a fresh session saw the real board's nine open Quests and could touch none of them, because the giver is one registered session and every quest tool answers "Continue in your existing Quest Giver". Attaching to that session then imposed the channel model on it, the turn failed with "The usage limit has been reached" on the exhausted openai account, and the host recovered onto the replacement model's default agent: session_v2.agent became "build" and the registered giver failed its own eligibility check. Fixed, the same drive reported ok after 49s with zero tokens because a worker session from 2026-09-06 on that Quest was marked completed; scoped by timestamp, it then reported ok after 126s because one long-finished step plus a fresh stage-state on a different step satisfied both halves, while the step it asked for was still working and its worker was killed by the stop. That stop killed two workers on that Quest, one of them after reading 502,165 input tokens and writing 1,085 of real investigation; none of it reached the step.
 */
import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { REDIRECTED_HOMES, isolationEnvironment, driveEnvironment, driveSession, driveIdentity, conditionMet, finishedBaseline, knownRuns, inFlightWorkers } from "../scripts/drive-isolation"

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

test("a run waits for a record that was unfinished when it asked, and for nothing else", () => {
  const before = [{
    id: "q1",
    stages: [{ id: "old", status: "done" }, { id: "asked", status: "pending" }],
    sessions: [{ runID: "r-2026-09-06", state: "completed" }],
  }]
  const baseline = finishedBaseline(before)

  // The exact record that fired twice: an old completed worker and an old done step.
  expect(conditionMet({ condition: "worker-completed", live: true, baseline, quests: before })).toBe(false)
  expect(conditionMet({ condition: "quest-step-done", live: true, baseline, quests: before })).toBe(false)

  // The second wrong answer: the asked-for step starts moving. Not finished, so not done.
  const working = [{ ...before[0], stages: [{ id: "old", status: "done" }, { id: "asked", status: "working" }] }]
  expect(conditionMet({ condition: "quest-step-done", live: true, baseline, quests: working })).toBe(false)

  // What actually ends the wait.
  const finished = [{ ...before[0], stages: [{ id: "old", status: "done" }, { id: "asked", status: "done" }] }]
  expect(conditionMet({ condition: "quest-step-done", live: true, baseline, quests: finished })).toBe(true)
  const worked = [{ ...before[0], sessions: [{ runID: "r-2026-09-06", state: "completed" }, { runID: "r-new", state: "completed" }] }]
  expect(conditionMet({ condition: "worker-completed", live: true, baseline, quests: worked })).toBe(true)

  // A Quest created after the baseline has nothing in it, so its first finished step counts.
  const fresh = [...before, { id: "q2", stages: [{ id: "s1", status: "done" }] }]
  expect(conditionMet({ condition: "quest-step-done", live: true, baseline, quests: fresh })).toBe(true)

  // The same comparison serves a sandbox: it starts empty, so its baseline is empty.
  expect(finishedBaseline([]).size).toBe(0)
  expect(conditionMet({ condition: "quest-step-done", live: false, baseline: finishedBaseline([]), quests: finished })).toBe(true)

  // Steps and runs are keyed per Quest, so the same step id on another Quest is a different record.
  const elsewhere = [{ id: "q3", stages: [{ id: "old", status: "done" }] }]
  expect(conditionMet({ condition: "quest-step-done", live: true, baseline, quests: elsewhere })).toBe(true)
})

test("a drive holds the host open for the workers it started, and for no others", () => {
  const before = [{ id: "q1", sessions: [{ runID: "old-run", state: "completed" }] }]
  const known = knownRuns(before)

  // Nothing this run started: a check stops immediately, exactly as before.
  expect(inFlightWorkers({ quests: before, known })).toEqual([])

  // The record that was killed twice: a new run, mid-flight. planned and waiting count too — a
  // worker admitted but not terminal is precisely the one a stop would strand.
  for (const state of ["planned", "executing", "waiting"]) {
    const during = [{ id: "q1", sessions: [{ runID: "old-run", state: "completed" }, { runID: "new-run", state }] }]
    expect(inFlightWorkers({ quests: during, known })).toEqual([{ quest: "q1", runID: "new-run", state }])
  }

  // Once it reaches any terminal state the drive is free to stop, including on failure.
  for (const state of ["completed", "failed", "cancelled"]) {
    const after = [{ id: "q1", sessions: [{ runID: "old-run", state: "completed" }, { runID: "new-run", state }] }]
    expect(inFlightWorkers({ quests: after, known })).toEqual([])
  }

  // Somebody else's long-running worker is not this drive's to wait on.
  const theirs = [{ id: "q2", sessions: [{ runID: "their-run", state: "executing" }] }]
  expect(inFlightWorkers({ quests: theirs, known: knownRuns(theirs) })).toEqual([])

  // Runs are keyed per Quest, so the same run id on another Quest is a different worker.
  const elsewhere = [{ id: "q3", sessions: [{ runID: "old-run", state: "executing" }] }]
  expect(inFlightWorkers({ quests: elsewhere, known })).toEqual([{ quest: "q3", runID: "old-run", state: "executing" }])

  // A session with no run id cannot be tracked and must not be invented into one.
  expect(inFlightWorkers({ quests: [{ id: "q4", sessions: [{ state: "executing" }] }], known })).toEqual([])
})
