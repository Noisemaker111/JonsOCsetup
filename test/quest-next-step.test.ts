import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { newQuest } from "../quest/schema"
import { stagesFromSteps, nextQuestStep, nextStepAction } from "../quest/steps"
import { summarizeQuest } from "../quest/board"
import { compactQuestDetail } from "../quest/context"
import { createQuestAgentAPI } from "../quest/agent-api"
import { questTool } from "../quest/server"

const make = (steps: Parameters<typeof stagesFromSteps>[0]) => newQuest({ id: "01j00000000000000000000901", title: "Dependencies", objective: "Select eligible work", stages: stagesFromSteps(steps) })
test("selects runnable dependencies instead of the earlier ineligible step", () => {
  const q = make([{ id: "done", title: "First", status: "done" }, { id: "later", title: "Later", needs: ["runnable"] }, { id: "runnable", title: "Now", needs: ["done"] }, { id: "last", title: "Last", needs: ["later"] }])
  expect(nextQuestStep(q)?.id).toBe("runnable")
  expect(compactQuestDetail(q).currentStage?.id).toBe("runnable")
  expect(compactQuestDetail(q).nextAction).toBe("Step 3/4: Now")
  expect(summarizeQuest(q).nextAction).toBe(compactQuestDetail(q).nextAction)
})
test("working precedes pending, blocked stays visible and cycles are not runnable", () => {
  expect(nextQuestStep(make([{ title: "Pending" }, { title: "Working", status: "working" }]))?.title).toBe("Working")
  expect(nextQuestStep(make([{ title: "Blocked", status: "blocked" }] ))?.status).toBe("blocked")
  const cycle = make([{ id: "a", title: "A", needs: ["b"] }, { id: "b", title: "B", needs: ["a"] }])
  expect(nextQuestStep(cycle)).toBeUndefined()
  expect(nextStepAction(cycle)).toBe("Resolve step dependencies")
})
test("step titles and todo instructions survive storage without truncation", () => {
  const text = "Full instructions ".repeat(60)
  const stages = stagesFromSteps([{ title: text, todos: [text] }])
  expect(stages[0].title).toBe(text.trim())
  expect(stages[0].todos[0].title).toBe(text.trim())
})
test("omitted tool state fails without changing a step or creating proof", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-state-required-"))
  try {
    const api = createQuestAgentAPI(root)
    const q = api.create({ title: "State validation", objective: "Keep work unfinished", steps: ["Implement"] })
    await expect(questTool(api).execute({ action: "step", id: q.id, input: { stepID: q.stages[0].id } })).rejects.toThrow("step state must be")
    expect(api.get(q.id)?.stages[0].status).toBe("pending")
    expect(api.get(q.id)?.stages[0].proofs).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
