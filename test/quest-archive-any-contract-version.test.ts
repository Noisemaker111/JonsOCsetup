/**
 * @core-prevents a Quest accepting "turn it in", recording the decision, returning success and staying open
 * @core-observed September 16: "Choose economical capable models automatically and prove it on backlog work"
 * (0001nabw7966ze4pxtc802tfxa) finished both steps with no active run, and three separate archive calls — two
 * from the board owner, one carrying a full acceptance note — were each accepted, each written to the journal
 * as {"archive":{"accepted":true,...}}, and each left the Quest at "Needs attention". It was written before
 * contractVersion 2 and the reducer changed state only for contractVersion === 2, so the decision was saved
 * and ignored. Of 88 Quests on that board it was the only open one carrying an archive decision.
 */
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { questsAPI } from "../quest/api"
import { physicalDirectory, projectIdentity } from "../quest/project"
import { QuestStore } from "../quest/store"

function finishedQuest(contractVersion?: number) {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), "quest-archive-contract-")))
  const store = new QuestStore(root)
  const project = projectIdentity(root)
  const api = questsAPI(store, { sessionID: "ses_giver", requestID: "create", directory: root, project } as any, async () => ({ sessionID: "unused" }))
  const created = api.create({ title: "It is finished", description: "Every step is done and nothing is running.", steps: [{ id: "work", title: "Do the work" }] })
  api.update(created.id, { steps: [{ id: "work", state: "done", note: "Delivered and verified." }] })
  // A Quest written before the current contract carries the version it was created under.
  if (contractVersion !== undefined) store.apply(created.id, "patched", { contractVersion }, "test")
  return { store, api, id: created.id }
}

test("a Quest written before contract 2 can still be turned in", () => {
  const { store, api, id } = finishedQuest(1)

  api.update(id, { archive: { accepted: true, reason: "Both steps done." } })

  const quest = store.read(id)!
  expect(quest.state).toBe("Archived")
  expect(quest.archive?.accepted).toBe(true)
})

test("a current Quest is turned in exactly as before", () => {
  const { store, api, id } = finishedQuest()

  api.update(id, { archive: { accepted: true, reason: "Both steps done." } })

  expect(store.read(id)!.state).toBe("Archived")
})

test("reopening works for an older Quest too", () => {
  const { store, api, id } = finishedQuest(1)
  api.update(id, { archive: { accepted: true, reason: "Both steps done." } })

  api.update(id, { archive: null })

  expect(store.read(id)!.state).not.toBe("Archived")
})

test("an unfinished Quest is still refused, whatever wrote it", () => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), "quest-archive-unfinished-")))
  const store = new QuestStore(root)
  const project = projectIdentity(root)
  const api = questsAPI(store, { sessionID: "ses_giver", requestID: "create", directory: root, project } as any, async () => ({ sessionID: "unused" }))
  const created = api.create({ title: "Still working", description: "One step is not done.", steps: [{ id: "work", title: "Do the work" }] })
  store.apply(created.id, "patched", { contractVersion: 1 }, "test")

  expect(() => api.update(created.id, { archive: { accepted: true } })).toThrow(/Finish the requested steps/)
})
