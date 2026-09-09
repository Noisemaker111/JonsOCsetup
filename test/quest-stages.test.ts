import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createQuestAgentAPI } from "../quest/agent-api"
import { completionMissing } from "../quest/completion"
import { newQuest } from "../quest/schema"
import { isVisibleStage, requiredProofKinds, runnableStages } from "../quest/stages"

const id = "01j00000000000000000000000"
const commandStage = {
  id: "core", title: "Core", status: "pending" as const, needs: [],
  todos: [{ id: "code", title: "Implement", status: "pending" as const }],
  claim: { repos: ["repo"], include: ["quest/schema.ts"], exclude: [] }, proofs: [], attempt: 1,
}
const visibleStage = {
  id: "board", title: "Board", status: "pending" as const, needs: ["core"],
  todos: [{ id: "ui", title: "Render", status: "pending" as const }],
  claim: { repos: ["repo"], include: ["quest/tui-active/quests.tsx"], exclude: [] }, proofs: [], attempt: 1,
}

test("every step needs one command proof; visibility is derived from touched paths, never a caller label", () => {
  expect(requiredProofKinds(commandStage)).toEqual(["command"])
  expect(requiredProofKinds(visibleStage)).toEqual(["command"])
  expect(isVisibleStage(commandStage)).toBe(false)
  expect(isVisibleStage(visibleStage)).toBe(true)
  expect((commandStage as any).weight).toBeUndefined()
})

test("only dependency-ready stages are runnable", () => {
  const q = newQuest({ id, title: "Q", objective: "Q", stages: [commandStage, visibleStage] })
  expect(runnableStages(q).map((stage) => stage.id)).toEqual(["core"])
  q.stages[0].status = "done"
  expect(runnableStages(q).map((stage) => stage.id)).toEqual(["board"])
})

test("the payout is optional and current-attempt proofs fail closed", () => {
  const q = newQuest({ id, title: "Q", objective: "Q", stages: [{ ...commandStage, status: "done", todos: [{ ...commandStage.todos[0], status: "done" }], proofs: [{ id: "p", kind: "command", command: "bun test", result: "passed", at: "2026-08-31T00:00:00Z", attempt: 1 }] }] })
  expect(completionMissing(q)).not.toContain("usage instructions")
  q.usageInstructions = ["Open /quests to view the result"]
  expect(completionMissing(q)).not.toContain("stage core command proof")
})

test("a failed judgment rewinds its stage and every dependent while preserving the setback", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-stages-"))
  try {
    const api = createQuestAgentAPI(root)
    api.create({ id, title: "Q", objective: "Q", usageInstructions: ["Use it"], stages: [
      { ...commandStage, status: "done", todos: [{ ...commandStage.todos[0], status: "done" }] },
      { ...visibleStage, status: "done", todos: [{ ...visibleStage.todos[0], status: "done" }] },
    ] })
    const next = api.proof(id, "core", { id: "judge-1", kind: "judgment", verdict: "FAIL", reason: "The captured board still exposes worker sessions", rewindTo: "core", attempt: 1 })
    expect(next.stages.map((stage) => [stage.id, stage.status, stage.attempt])).toEqual([["core", "pending", 2], ["board", "pending", 2]])
    expect(next.stages.every((stage) => stage.todos.every((todo) => todo.status === "pending"))).toBe(true)
    expect(next.setbacks).toEqual([expect.objectContaining({ stageID: "core", proofID: "judge-1", verdict: "FAIL", reason: expect.stringContaining("worker sessions"), attempt: 1 })])
    expect(next.nextAction).toContain("attempt 2")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
