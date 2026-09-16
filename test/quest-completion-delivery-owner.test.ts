/**
 * @core-prevents a Quest-owned worker completion reaching its giver twice, as the QuestWorkerReturns return and again as the orchestration watchdog's synthetic subagent completion
 * @core-observed The 2026-09-10 native-reuse audit recorded that a native-child Quest job is delivered by the watchdog's synthetic completion while QuestWorkerReturns prompts the same giver, so one terminal result had two delivery owners (native-opencode-reuse-plan.md, item 5).
 */
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendLedger, completionEvidence, pendingCompletionEvidence, readLedger, registerCompletionDeliveryClaimant } from "../orchestration/orchestration-ledger"
import { deliverPendingCompletion } from "../orchestration/orchestration"
import { QuestStore } from "../quest/store"
import { clearQuestParseCache } from "../quest/index"
import { QuestTracker } from "../quest/tracker"

const record = (file: string, questID?: string) => {
  const parentID = "ses_giver", callID = "run-1", childID = "ses_worker", runID = "run-1"
  appendLedger({ kind: "spawn", parentID, callID, runID, questID, agentRole: "worker" }, file)
  appendLedger({ kind: "notification", parentID, callID, childID, state: "completed", deliveryKey: `${parentID}:${runID}:terminal`, description: "Quest session completed", questID, runID }, file)
  return completionEvidence(parentID, callID, childID, file)!
}

test("a completion a Quest already returns is suppressed instead of injected twice", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-completion-owner-"))
  const delivered = join(root, "orchestration.jsonl")
  const synthetic: string[] = []
  const sessionApi = { synthetic: async () => { synthetic.push("called") } }
  try {
    const completion = record(delivered, "quest-1")
    const unregister = registerCompletionDeliveryClaimant((candidate) => candidate.runID === "run-1")
    try {
      expect(await deliverPendingCompletion(sessionApi, completion, delivered)).toBe(true)
      expect(synthetic).toHaveLength(0)
      expect(pendingCompletionEvidence("ses_giver", delivered)).toHaveLength(0)
      expect(readLedger(delivered).some((event) => event.kind === "completion-delivery" && event.deliveryState === "delivered" && /Quest return owner/.test(event.description ?? ""))).toBe(true)
    } finally { unregister() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a completion no owner claims still gets the native synthetic once", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-completion-native-"))
  const delivered = join(root, "orchestration.jsonl")
  const synthetic: Array<{ sessionID?: string; metadata?: { kind?: string } }> = []
  const sessionApi = { synthetic: async (input: { sessionID?: string; metadata?: { kind?: string } }) => { synthetic.push(input) } }
  try {
    const completion = record(delivered)
    expect(await deliverPendingCompletion(sessionApi, completion, delivered)).toBe(true)
    expect(synthetic).toHaveLength(1)
    expect(synthetic[0].sessionID).toBe("ses_giver")
    expect(synthetic[0].metadata?.kind).toBe("subagent.completion")
    // A repeat must not deliver a second wake for the same terminal event.
    expect(await deliverPendingCompletion(sessionApi, completion, delivered)).toBe(true)
    expect(synthetic).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("only a Quest that actually owns the run claims its completion", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-completion-claim-"))
  try {
    const store = new QuestStore(root)
    const quest = store.create({
      id: "01j00000000000000000000abc", title: "Owned run", objective: "Own one worker run", kind: "investigation", contractVersion: 2,
      stages: [{ id: "jobs", title: "Consolidate", detail: "", status: "done", needs: [], todos: [] } as any],
    })
    clearQuestParseCache()
    store.apply(quest.id, "session-claimed", { callID: "run-1", runID: "run-1", sessionID: "ses_worker", role: "worker", deliverables: ["jobs"] }, "test")
    const tracker = new QuestTracker(store)
    expect(tracker.deliversCompletion({ questID: quest.id, runID: "run-1" } as any)).toBe(true)
    // A different run of the same Quest, an unknown Quest and the legacy "unbound" scope are not owned.
    expect(tracker.deliversCompletion({ questID: quest.id, runID: "run-2" } as any)).toBe(false)
    expect(tracker.deliversCompletion({ questID: "missing", runID: "run-1" } as any)).toBe(false)
    expect(tracker.deliversCompletion({ questID: "unbound", runID: "run-1" } as any)).toBe(false)
    expect(tracker.deliversCompletion({ questID: quest.id } as any)).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
