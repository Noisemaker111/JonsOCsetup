/**
 * @core-prevents a giver spending whole turns re-asking a running worker for state it already has, and the replacement wait outliving its bound or missing a real change
 * @core-observed 420 `quest get` calls landed on 216 distinct (session, quest) pairs in the session database, one Code Mode execute issuing 24 of them for the same run (2026-09-11).
 */
import { test, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QuestStore } from "../quest/store"
import { questsAPI } from "../quest/api"
import { activeRuns, awaitQuestChange, observedState, pollDecision } from "../quest/wait"

const context = (requestID: string): any => ({ project: { id: "project-a", root: join("C", "projects", "project-a") }, sessionID: "ses_giver", requestID })
const started = async () => ({ sessionID: "ses_worker" })
const request = { title: "Append one marker line to the scratch document", description: "Append exactly one marker line to docs/scratch.md.", steps: [{ title: "Append the marker" }] }

function dispatched() {
  const root = mkdtempSync(join(tmpdir(), "quest-wait-"))
  const store = new QuestStore(root)
  const created = questsAPI(store, context("call-1"), started).create(request)
  const quest = store.read(created.id)!
  store.apply(quest.id, "session-claimed", { callID: "run-1", runID: "run-1", sessionID: "ses_worker", parentID: "ses_giver", role: "worker", deliverables: quest.stages.map((s) => s.id) }, "test")
  store.apply(quest.id, "session-state", { callID: "run-1", state: "executing" }, "test")
  return { root, store, questID: quest.id }
}

test("a repeat that can only return what the caller already has waits once, then is refused", () => {
  const { root, store, questID } = dispatched()
  try {
    const quest = store.read(questID)!
    const fingerprint = observedState(quest)
    expect(activeRuns(quest).length).toBe(1)
    const answered = { fingerprint, waited: false }
    // First sight of this state is an answer; the identical repeat becomes the wait.
    expect(pollDecision({ fingerprint, seen: undefined, activeRuns: 1, explicitWait: false })).toBe("answer")
    expect(pollDecision({ fingerprint, seen: answered, activeRuns: 1, explicitWait: false })).toBe("wait")
    expect(pollDecision({ fingerprint, seen: { fingerprint, waited: true }, activeRuns: 1, explicitWait: false })).toBe("refuse")
    // Real progress is never withheld, and a settled Quest has nothing to wait for.
    store.apply(questID, "session-state", { callID: "run-1", state: "completed", result: "Marker appended" }, "test")
    const settled = store.read(questID)!
    expect(observedState(settled)).not.toBe(fingerprint)
    expect(pollDecision({ fingerprint: observedState(settled), seen: answered, activeRuns: activeRuns(settled).length, explicitWait: false })).toBe("answer")
    expect(pollDecision({ fingerprint: observedState(settled), seen: undefined, activeRuns: 0, explicitWait: true })).toBe("answer")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the wait ends on the run actually settling, and never outlives its bound when the worker goes silent", async () => {
  const { root, store, questID } = dispatched()
  try {
    const read = () => store.read(questID)
    const fingerprint = observedState(read()!)
    const settle = setTimeout(() => store.apply(questID, "session-state", { callID: "run-1", state: "failed", result: "Worker reported a blocker" }, "test"), 300)
    const woken = await awaitQuestChange({ read, fingerprint, deadline: Date.now() + 20000 })
    clearTimeout(settle)
    expect(woken.changed).toBe(true)
    expect(woken.quest!.sessions[0].state).toBe("failed")
    expect(woken.milliseconds).toBeLessThan(20000)
    // A worker that dies stops writing; silence must expire, not hold the giver.
    const silent = await awaitQuestChange({ read, fingerprint: observedState(read()!), deadline: Date.now() + 1200 })
    expect(silent.changed).toBe(false)
    expect(silent.milliseconds).toBeLessThan(6000)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
