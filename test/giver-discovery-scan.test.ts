/**
 * @core-prevents one historical Quest record whose owner is a worker session or a session the host no longer has making the whole board giverless, so no Quest on it can be assigned an execution session at all
 * @core-observed Driving the real ledger on 2026-09-11 to dispatch a blocked Quest step, every Quest Giver session opened onto a modal and the composer never took input: first "Error: The user giver must be a verified root Quest Giver, never an execution worker" for ses_f94bf1cf5ffeGUqvREwNUfafj1 ("Pipeline smoke haiku worker"), recorded as one archived smoke Quest's owner and as another Quest's worker session, then "[object Object]" for ses_f72b5a2e8ffeRFAq1r8COVN5hx, which is recorded as an owner and is not in opencode.db. Both sort before the 20 real givers also recorded.
 */
import { test, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QuestStore } from "../quest/store"
import { ensureUserGiver } from "../quest/user-giver"

const project = { id: "a".repeat(64), root: process.cwd() }
const quest = (store: QuestStore, id: string, title: string, owner: string, workerSessionID?: string) => {
  store.create({ id, title, objective: title + " on the live board", contractVersion: 2, project, stages: [{ id: "step", title: "Do the assigned work", status: "pending", needs: [] }] } as any)
  store.apply(id, "patched", { integrationOwner: owner }, "test")
  if (workerSessionID) store.apply(id, "session-claimed", { callID: "run-" + id, runID: "run-" + id, sessionID: workerSessionID, parentID: owner, agentRole: "general", role: "worker", scope: { files: ["."], requestedFiles: ["."] } }, "test")
}

test("a recorded owner that is not a giver is passed over, not raised, so the board can still be given one", async () => {
  const root = mkdtempSync(join(tmpdir(), "giver-scan-"))
  try {
    const store = new QuestStore(root)
    const worker = "ses_" + "w".repeat(22), deleted = "ses_" + "d".repeat(22), real = "ses_" + "g".repeat(22)
    // The shape on the live board: a smoke Quest whose owner is the worker session another Quest
    // records as its worker, and a Quest whose owner no longer exists, both recorded before the
    // Quest that names the actual giver.
    quest(store, "01j000000000000000000000a1", "Smoke test worker adopted as owner", worker)
    quest(store, "01j000000000000000000000a2", "Work owned by a session since deleted", deleted)
    quest(store, "01j000000000000000000000a3", "Real work owned by the giver", real, worker)

    const rows: Record<string, any> = {
      [worker]: { id: worker, agent: "quest-giver", location: { directory: process.cwd() }, time: { updated: 2 } },
      [real]: { id: real, agent: "quest-giver", location: { directory: process.cwd() }, time: { updated: 1 } },
    }
    const asked: string[] = []
    // How this host client actually reports a session it does not have: a bare object with no
    // status field, which is why testing for 404 never skipped one.
    const host = { get: async ({ sessionID }: any) => { asked.push(sessionID); const row = rows[sessionID]; if (!row) throw { data: { message: "session not found" } }; return row }, create: async () => { throw new Error("A giver is already recorded; the scan must find it rather than create another") } }

    const bound = await ensureUserGiver(store, host)
    // Both unusable records are history. The giver recorded beside them is the answer.
    expect(bound.id).toBe(real)
    expect(asked).toContain(worker)
    expect(asked).toContain(deleted)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
