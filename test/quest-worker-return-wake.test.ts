/**
 * @core-prevents simultaneous Automatic Quest worker updates collapsing into one giver turn instead of each retaining a queued response
 * @core-observed Cycle 2 of the September 13 economical-routing gate promoted two worker returns 2 ms apart after one execution claim, then recorded no assistant response before its unchanged 240 s deadline.
 */
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { questsAPI } from "../quest/api"
import { physicalDirectory, projectIdentity } from "../quest/project"
import { QuestStore } from "../quest/store"
import { QuestWorkerReturns } from "../quest/worker-returns"

test("each terminal worker return queues and explicitly wakes its own giver turn", async () => {
  // Native sessions bind the physical directory. Windows runner TEMP can use
  // an alias, so the fixture must establish the same host-derived identity.
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), "quest-worker-return-")))
  const store = new QuestStore(root)
  const giver = {
    id: "ses_giver",
    agent: "quest-giver",
    model: { providerID: "provider", id: "model" },
    location: { directory: root },
  }
  const prompts: any[] = []
  const host = {
    get: async () => giver,
    prompt: async (input: any) => {
      prompts.push(input)
      return { id: input.id, sessionID: input.sessionID }
    },
  } as any
  const context: any = {
    sessionID: giver.id,
    requestID: "create",
    directory: root,
    project: projectIdentity(root),
  }
  const returns = new QuestWorkerReturns(store, host, "wake-test")
  try {
    const work = [
      { runID: "a".repeat(26), title: "Deliver the weather worker finding", description: "Return the completed weather inspection to its giver." },
      { runID: "b".repeat(26), title: "Surface the dependency audit result", description: "Notify the giver that its dependency audit completed." },
    ]
    for (const [index, item] of work.entries()) {
      const { runID } = item
      const created = questsAPI(store, { ...context, requestID: `create-${index}` }, async () => ({ sessionID: "unused" })).create({
        title: item.title,
        description: item.description,
        steps: [{ id: "report", title: "Report the completed worker outcome" }],
      })
      const quest = store.read(created.id)!
      await returns.watch({ quest, runID, stepIDs: ["report"], context })
      store.apply(quest.id, "session-claimed", {
        callID: runID,
        runID,
        sessionID: `ses_worker_${index}`,
        parentID: giver.id,
        role: "worker",
        deliverables: ["report"],
      }, "test")
      store.apply(quest.id, "stage-state", { stageID: "report", status: "done", evidence: `worker ${index + 1} done` }, "test")
      store.apply(quest.id, "session-state", { callID: runID, state: "completed", result: `worker ${index + 1} completed` }, "test")
    }

    await returns.tick()

    expect(prompts).toHaveLength(2)
    expect(prompts.map((prompt) => ({
      delivery: prompt.delivery,
      resume: prompt.resume,
      return: prompt.metadata?.questWorkerReturn,
    }))).toEqual([
      { delivery: "queue", resume: true, return: true },
      { delivery: "queue", resume: true, return: true },
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
