/**
 * @core-prevents one Quest reading RUNNING on the board, green in the sidebar and UNKNOWN in the composer footer in the same second
 * @core-observed 2026-09-16: docs/quest-surface-authority.md traced four independent readers; the sidebar coloured by the persisted Working state while the board rows and footer drew host observation, and scripts/verify-quest-surface-trace.ts reported the same Quests as Working with 0 host-confirmed running.
 */
import { expect, test } from "bun:test"
import { filterQuests } from "../quest/tui-model"
import { questReachability, runReachability } from "../quest/reachability"
import type { Quest, QuestSession } from "../quest/types"

const session = (fields: Partial<QuestSession> & { state: string }): QuestSession => ({
  callID: "call-1", attempt: 1, updatedAt: "2026-09-16T00:00:00.000Z", evidence: [], deliverables: [], ...fields,
}) as QuestSession
const quest = (state: string, sessions: QuestSession[], stages: Array<{ id: string; status: string }> = [{ id: "work", status: "pending" }]): Quest => ({
  id: "q1", title: "One Quest", state, contractVersion: 2, stages, sessions, executingCount: sessions.filter(s => s.state === "executing").length,
} as unknown as Quest)
/** The owning host's answer; a state alone is what every host reader can produce. */
const observes = (state: string, extra: Record<string, unknown> = {}) => () => ({ state, ...extra })
const unobserved = () => ({ state: "unknown", reason: "Session exists; live execution is not confirmed" })

test("only a host-confirmed execution is painted live, never the saved executing row", () => {
  const q = quest("Working", [session({ state: "executing" })])
  const unknown = questReachability(q, observes("unknown"))
  expect(unknown.state).toBe("unknown")
  expect(unknown.label).toBe("UNKNOWN")
  expect(unknown.tone).toBe("uncertain")
  expect(unknown.confirmed).toBe(false)
  expect(unknown.over).toBe(false)
  // The sidebar draws the same read, so it cannot stay green while the footer says unknown.
  expect(filterQuests([q], "active", observes("unknown"))).toEqual([])
  expect(filterQuests([q], "waiting", observes("unknown"))).toEqual([q])
  // The owning host confirming execution is what makes it active everywhere at once.
  const running = questReachability(q, observes("running"))
  expect(running.label).toBe("RUNNING")
  expect(running.tone).toBe("live")
  expect(running.confirmed).toBe(true)
  expect(filterQuests([q], "active", observes("running"))).toEqual([q])
})

test("an owner that cannot be reached is uncertain, not completed and not terminal", () => {
  const q = quest("Working", [session({ state: "executing" })])
  const unreachable = questReachability(q, observes("unreachable"))
  expect(unreachable.label).toBe("UNREACHABLE")
  expect(unreachable.tone).toBe("uncertain")
  expect(unreachable.confirmed).toBe(false)
  expect(unreachable.over).toBe(false)
  expect(unreachable.terminal).toBe(false)
})

test("a settled run reports the recorded outcome instead of a live inspection", () => {
  // The per-run read every agent log and worker picker shows: a settled row keeps its outcome.
  const completed = runReachability(session({ state: "completed", result: "Host reported execution succeeded" }), unobserved)
  expect(completed.label).toBe("WORKER DONE")
  expect(completed.tone).toBe("done")
  expect(completed.over).toBe(true)
  expect(completed.terminal).toBe(true)
  const failed = runReachability(session({ state: "failed", result: "Host reported execution failed" }), unobserved)
  expect(failed.label).toBe("FAILED")
  expect(failed.tone).toBe("failed")
  expect(failed.terminal).toBe(true)
})

test("pending permissions come from the owner's answer; recorded decisions survive", () => {
  const pending = runReachability(session({ state: "executing" }), observes("blocked", { permissions: [{ action: "read", resources: ["docs/x.md"] }] }))
  expect(pending.label).toBe("BLOCKED")
  expect(pending.tone).toBe("blocked")
  expect(pending.pendingPermissions).toBe(1)
  const rejected = runReachability(session({ state: "cancelled", permissionDecisions: [{ requestID: "r1", reply: "reject", state: "acknowledged", actor: "reviewer", reason: "outside the assignment", at: "2026-09-16T00:00:00.000Z" }] }), unobserved)
  expect(rejected.decisions).toHaveLength(1)
  expect(rejected.pendingPermissions).toBe(0)
})

test("no owned run falls back to the saved lifecycle for every surface", () => {
  expect(questReachability(quest("Ready to complete", [session({ state: "completed" })]), unobserved).label).toBe("Ready for review")
  expect(questReachability(quest("Needs attention", [session({ state: "failed" })]), unobserved).label).toBe("Needs attention")
  expect(questReachability(quest("Archived", []), unobserved).label).toBe("Archived")
  expect(questReachability(quest("Waiting", []), unobserved).label).toBe("Planned")
})

test("the board read and the per-run read answer with one state", () => {
  const q = quest("Working", [session({ state: "executing" })])
  for (const answer of ["running", "blocked", "unknown", "unreachable", "external"]) {
    expect(questReachability(q, observes(answer)).state).toBe(runReachability(q.sessions[0], observes(answer)).state)
  }
})
