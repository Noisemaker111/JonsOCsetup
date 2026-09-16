/**
 * @core-prevents an interrupted run recording that it was interrupted without recording why
 * @core-observed September 16: "Make the GPT-5.6 Sol Fast picker use and prove the mapping" lost two consecutive
 * DeepSeek high runs, eca21cac1fa5 and 064b86e20bc9, and both settled with the single line "Host reported
 * execution interrupted". An interrupt carries data.reason rather than data.error — the shutdown case is read
 * from exactly that field one line earlier — and the settle read only data.error, so every non-shutdown cause
 * was discarded. The step was held blocked because nothing on the board said what to fix.
 */
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { questsAPI } from "../quest/api"
import { physicalDirectory, projectIdentity } from "../quest/project"
import { QuestStore } from "../quest/store"
import { QuestTracker } from "../quest/tracker"

function executingRun() {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), "quest-interrupt-reason-")))
  const store = new QuestStore(root)
  const project = projectIdentity(root)
  const context: any = { sessionID: "ses_giver", requestID: "create", directory: root, project }
  const created = questsAPI(store, context, async () => ({ sessionID: "unused" }))
    .create({ title: "Its worker was interrupted", description: "The host ended the turn for a reason the board never saw.", steps: [{ id: "work", title: "Do the work" }] })
  store.apply(created.id, "session-claimed", { callID: "run-1", runID: "run-1", sessionID: "ses_w", parentID: "ses_giver", role: "worker", deliverables: ["work"], attempt: 1 }, "test")
  store.apply(created.id, "session-state", { callID: "run-1", state: "executing" }, "test")
  return { store, id: created.id }
}

const settled = (store: QuestStore, id: string) => store.read(id)!.sessions.find(s => s.callID === "run-1")!

test("an interrupt records the reason the host gave", () => {
  const { store, id } = executingRun()

  new QuestTracker(store).onHostEvent({ type: "session.execution.interrupted", properties: { sessionID: "ses_w", reason: "context window exceeded" } })

  const run = settled(store, id)
  expect(run.state).toBe("cancelled")
  expect(run.result).toBe("Host reported execution interrupted: context window exceeded")
})

test("an error message still wins, and an interrupt without a reason reads as before", () => {
  const withError = executingRun()
  new QuestTracker(withError.store).onHostEvent({ type: "session.execution.failed", properties: { sessionID: "ses_w", reason: "ignored", error: { message: "provider refused the route" } } })
  expect(settled(withError.store, withError.id).result).toBe("Host reported execution failed: provider refused the route")

  const bare = executingRun()
  new QuestTracker(bare.store).onHostEvent({ type: "session.execution.interrupted", properties: { sessionID: "ses_w" } })
  expect(settled(bare.store, bare.id).result).toBe("Host reported execution interrupted")
})

test("a shutdown is still a handoff, not an outcome", () => {
  const { store, id } = executingRun()

  new QuestTracker(store).onHostEvent({ type: "session.execution.interrupted", properties: { sessionID: "ses_w", reason: "shutdown" } })

  expect(settled(store, id).state).toBe("executing")
})
