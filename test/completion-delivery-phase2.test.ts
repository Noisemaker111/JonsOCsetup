import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendLedger, expireExecutionLeases, pendingCompletionEvidence, recordHeartbeat, recordNotification, registerCompletionEvidenceHandler } from "../orchestration/orchestration-ledger"
import { deliverPendingCompletion } from "../orchestration/orchestration"
import { QuestStore } from "../quest/store"
import { QuestTracker } from "../quest/tracker"

test("terminal evidence updates the linked Quest once across replay and duplicates", () => {
  const root = mkdtempSync(join(tmpdir(), "completion-quest-"))
  const ledger = join(root, "orchestration.jsonl")
  const store = new QuestStore(root)
  try {
    const quest = store.create({ id: "01j00000000000000000000999", title: "Linked", objective: "Linked completion" })
    store.apply(quest.id, "session-planned", { callID: "call_1", role: "build" })
    appendLedger({ kind: "spawn", parentID: "ses_parent", callID: "call_1", childID: "ses_child", questID: quest.id, runID: "run_1", providerID: "openai", modelID: "gpt-5.6-luna-fast", agentRole: "build", runtime: "native" }, ledger)
    appendLedger({ kind: "bound", parentID: "ses_parent", callID: "call_1", childID: "ses_child", openCodeSessionId: "ses_child", runtime: "native" }, ledger)
    const tracker = new QuestTracker(store)
    const stop = registerCompletionEvidenceHandler((completion) => tracker.onCompletion(completion), ledger)
    expect(recordNotification("ses_parent", "call_1", "ses_child", "completed", "verified result", ledger)).toBe(true)
    expect(recordNotification("ses_parent", "call_1", "ses_replacement", "completed", "duplicate resume", ledger)).toBe(false)
    const after = store.read(quest.id)!
    expect(after.sessions[0]).toMatchObject({ state: "completed", openCodeSessionId: "ses_child", runID: "run_1", result: "verified result" })
    expect(after.notificationCursor).toBe("ses_parent:run_1:terminal")
    const revision = after.revision
    stop()

    const stopReplay = registerCompletionEvidenceHandler((completion) => new QuestTracker(store).onCompletion(completion), ledger)
    expect(store.read(quest.id)?.revision).toBe(revision)
    stopReplay()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("lease expiry and unlinked completions never create a Quest", () => {
  const root = mkdtempSync(join(tmpdir(), "completion-unlinked-"))
  const ledger = join(root, "orchestration.jsonl")
  try {
    appendLedger({ kind: "spawn", parentID: "ses_parent", callID: "call_2", runID: "run_2", runtime: "native" }, ledger)
    appendLedger({ kind: "bound", parentID: "ses_parent", callID: "call_2", childID: "ses_child", openCodeSessionId: "ses_child", runtime: "native" }, ledger)
    recordHeartbeat("ses_parent", "call_2", "ses_child", ledger)
    expect(expireExecutionLeases(Date.now() + 120_000, ledger)).toHaveLength(1)
    const tracker = new QuestTracker(new QuestStore(root))
    const stop = registerCompletionEvidenceHandler((completion) => tracker.onCompletion(completion), ledger)
    expect(recordNotification("ses_parent", "call_2", "ses_child", "missing-result", "lease expired", ledger)).toBe(true)
    expect(recordNotification("ses_parent", "call_2", "ses_child", "missing-result", "startup replay", ledger)).toBe(false)
    expect(storeQuestCount(root)).toBe(0)
    stop()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("failed synthetic delivery remains pending and succeeds once on retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "completion-retry-"))
  const ledger = join(root, "orchestration.jsonl")
  try {
    appendLedger({ kind: "spawn", parentID: "ses_parent", callID: "call_3", runID: "run_3", runtime: "native" }, ledger)
    appendLedger({ kind: "bound", parentID: "ses_parent", callID: "call_3", childID: "ses_child", openCodeSessionId: "ses_child", runtime: "native" }, ledger)
    expect(recordNotification("ses_parent", "call_3", "ses_child", "completed", "done", ledger)).toBe(true)
    const completion = pendingCompletionEvidence("ses_parent", ledger)[0]
    expect(await deliverPendingCompletion({ synthetic: async () => { throw new Error("transient") } }, completion, ledger)).toBe(false)
    expect(pendingCompletionEvidence("ses_parent", ledger)).toHaveLength(1)
    let calls = 0
    expect(await deliverPendingCompletion({ synthetic: async () => { calls++ } }, completion, ledger)).toBe(true)
    expect(pendingCompletionEvidence("ses_parent", ledger)).toHaveLength(0)
    expect(await deliverPendingCompletion({ synthetic: async () => { calls++ } }, completion, ledger)).toBe(true)
    expect(calls).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

function storeQuestCount(root: string): number {
  const path = new QuestStore(root).root
  return existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isFile()).length : 0
}
