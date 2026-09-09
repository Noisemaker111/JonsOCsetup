import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createQuestAgentAPI } from "../quest/agent-api"
import { QuestStore } from "../quest/store"
import { QuestTracker } from "../quest/tracker"
import { completionMissing } from "../quest/completion"
import { appendLedger, pendingCompletionEvidence, readLedger, recordNotification, registerCompletionEvidenceHandler, suppressCompletionDelivery } from "../orchestration/orchestration-ledger"

test("dispatch collision parks the integrator and specialist handoff resumes the same session once", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-dependency-resume-"))
  const ledger = join(root, "orchestration.jsonl")
  const continuations: Array<Record<string, unknown>> = []
  const store = new QuestStore(root)
  const api = createQuestAgentAPI(root, { synthetic: async (input: Record<string, unknown>) => { continuations.push(input) } }, ledger)
  try {
    const quest = store.create({
      id: "01j00000000000000000000777",
      title: "Integrate dispatch",
      objective: "Integrate the canonical dispatch specialist handoff",
      claims: [{ sessionID: "ses_specialist", repo: root, include: ["orchestration/dispatch.ts"], exclude: [], state: "active" }],
      sessions: [{
        callID: "call_integrator", taskID: "integrate", sessionID: "ses_integrator", openCodeSessionId: "ses_integrator", parentID: "ses_parent",
        role: "worker", agentRole: "build", providerID: "openai", modelID: "gpt-5.6-luna-fast", runtime: "native",
        model: "openai/gpt-5.6-luna-fast", scope: { ownedPaths: ["orchestration/dispatch.ts"], prohibitedPaths: [] }, task: "Integrate dispatch",
        state: "executing", evidence: [], deliverables: ["integration"], attempt: 1, updatedAt: new Date().toISOString(),
      }],
    })

    expect(api.mappings({ verbose: true }).activeClaims).toEqual([expect.objectContaining({ questID: quest.id, sessionID: "ses_specialist", include: ["orchestration/dispatch.ts"] })])
    const relevant = api.mappings({ paths: ["orchestration/dispatch.ts"] })
    expect(relevant.sessions).toEqual([])
    expect(relevant.activeClaims).toEqual([expect.objectContaining({ questID: quest.id, sessionID: "ses_specialist" })])
    api.park(quest.id, { callID: "call_integrator", blockerSessionID: "ses_specialist", file: "orchestration/dispatch.ts", reason: "dispatch specialist owns the canonical contract" })
    expect(store.read(quest.id)?.sessions[0]).toMatchObject({ state: "blocked", sessionID: "ses_integrator", model: "openai/gpt-5.6-luna-fast", scope: { ownedPaths: ["orchestration/dispatch.ts"] }, dependency: { sessionID: "ses_specialist", file: "orchestration/dispatch.ts", status: "blocked", resumeCount: 0 } })

    appendLedger({ kind: "spawn", parentID: "ses_parent", callID: "call_integrator", childID: "ses_integrator", questID: quest.id, runID: "run_integrator", runtime: "native" }, ledger)
    appendLedger({ kind: "bound", parentID: "ses_parent", callID: "call_integrator", childID: "ses_integrator", openCodeSessionId: "ses_integrator", runtime: "native" }, ledger)
    const tracker = new QuestTracker(store)
    const stop = registerCompletionEvidenceHandler((completion) => {
      if (tracker.onCompletion(completion) === "parked" && suppressCompletionDelivery(completion, ledger)) tracker.onCompletion(completion, true)
    }, ledger)
    expect(recordNotification("ses_parent", "call_integrator", "ses_integrator", "completed", "worker stopped on file ownership", ledger)).toBe(true)
    expect(store.read(quest.id)?.sessions[0].state).toBe("blocked")
    expect(pendingCompletionEvidence("ses_parent", ledger)).toHaveLength(0)
    expect(readLedger(ledger).some((event) => event.kind === "queued-message")).toBe(false)
    stop()

    await api.handoff({ sessionID: "ses_specialist", reason: "08ff25f handed off" })
    const [parked, resumed] = store.read(quest.id)!.sessions
    expect(parked).toMatchObject({ state: "waiting", sessionID: "ses_integrator", model: "openai/gpt-5.6-luna-fast", scope: { ownedPaths: ["orchestration/dispatch.ts"] }, dependency: { status: "resumed", resumeCount: 1 } })
    expect(resumed).toMatchObject({ state: "executing", sessionID: "ses_integrator", model: "openai/gpt-5.6-luna-fast", scope: { ownedPaths: ["orchestration/dispatch.ts"] }, resumedFrom: "call_integrator", attempt: 2 })
    expect(continuations).toEqual([expect.objectContaining({ sessionID: "ses_integrator", messageID: expect.stringMatching(/^msg_[a-f0-9]{24}$/), text: expect.stringContaining("Resume the same scoped task now"), metadata: expect.objectContaining({ kind: "quest.dependency-resume", model: "openai/gpt-5.6-luna-fast", scope: { ownedPaths: ["orchestration/dispatch.ts"], prohibitedPaths: [] } }) })])
    expect(continuations[0]).not.toHaveProperty("delivery")
    expect(api.mappings().activeClaims).toHaveLength(0)

    await api.handoff({ sessionID: "ses_specialist", reason: "duplicate handoff" })
    expect(continuations).toHaveLength(1)
    expect(store.read(quest.id)?.sessions[0].dependency?.resumeCount).toBe(1)
    const resumeSpawn = readLedger(ledger).find((event) => event.kind === "spawn" && event.callID.startsWith("resume-"))
    expect(resumeSpawn).toMatchObject({ questID: quest.id, childID: "ses_integrator", runID: resumeSpawn?.callID })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("failed and concurrent handoffs retry one deterministic continuation without hiding attempts", async () => {
  const root = mkdtempSync(join(tmpdir(), "quest-dependency-retry-"))
  const ledger = join(root, "orchestration.jsonl")
  let rejectFirst = true
  let release: (() => void) | undefined
  const continuations: Array<Record<string, any>> = []
  const api = createQuestAgentAPI(root, { synthetic: async (input: Record<string, any>) => {
    continuations.push(input)
    if (rejectFirst) { rejectFirst = false; throw new Error("transient host rejection") }
    await new Promise<void>((resolve) => { release = resolve })
  } }, ledger)
  const store = api.store
  try {
    const quest = store.create({
      id: "01j00000000000000000000778", title: "Retry dispatch", objective: "Retry one exact continuation",
      claims: [{ sessionID: "ses_specialist", repo: root, include: ["orchestration/dispatch.ts"], exclude: [], state: "active" }],
      sessions: [{ callID: "call_integrator", sessionID: "ses_integrator", openCodeSessionId: "ses_integrator", parentID: "ses_parent", role: "worker", model: "openai/gpt-5.6-luna-fast", scope: { ownedPaths: ["orchestration/dispatch.ts"] }, state: "executing", evidence: [], deliverables: [], attempt: 1, updatedAt: new Date().toISOString() }],
    })
    api.park(quest.id, { callID: "call_integrator", blockerSessionID: "ses_specialist", file: "orchestration/dispatch.ts", reason: "collision" })

    await api.handoff({ sessionID: "ses_specialist" })
    expect(store.read(quest.id)?.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ resumedFrom: "call_integrator", state: "failed", attempt: 2 })]))
    expect(store.read(quest.id)?.sessions[0]).toMatchObject({ state: "blocked", dependency: { status: "failed", resumeCount: 0 } })

    const retry = api.handoff({ sessionID: "ses_specialist" })
    await Promise.resolve()
    const concurrentDuplicate = api.handoff({ sessionID: "ses_specialist" })
    await Promise.resolve()
    expect(continuations).toHaveLength(2)
    expect(continuations[0].messageID).toBe(continuations[1].messageID)
    release?.()
    await Promise.all([retry, concurrentDuplicate])

    const sessions = store.read(quest.id)!.sessions
    expect(sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ resumedFrom: "call_integrator", state: "failed", attempt: 2 }),
      expect.objectContaining({ resumedFrom: "call_integrator", state: "executing", attempt: 3, sessionID: "ses_integrator", model: "openai/gpt-5.6-luna-fast", scope: { ownedPaths: ["orchestration/dispatch.ts"] } }),
    ]))
    expect(sessions[0]).toMatchObject({ state: "waiting", dependency: { status: "resumed", resumeCount: 1 } })
    expect(store.read(quest.id)?.state).toBe("Working")
    store.apply(quest.id, "session-state", { callID: sessions[2].callID, state: "completed", evidence: "retry completed" })
    expect(completionMissing(store.read(quest.id)!)).not.toContain("missing or non-completed sessions")
  } finally { release?.(); rmSync(root, { recursive: true, force: true }) }
})
