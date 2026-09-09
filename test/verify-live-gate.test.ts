import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createQuestAgentAPI } from "../quest/agent-api"
import { completionMissing } from "../quest/completion"
import { requiresVerifyLive, liveCheckOf, recordLiveCheck, verifyLiveMissing } from "../orchestration/verify-live-gate"
import { jkApprovalOf, recordJkApproval, maybeAutoCompleteAndArchive } from "../orchestration/gated-completion"
import { QuestStore } from "../quest/store"

function fixtureDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Drive a Quest to every gate except VERIFY-LIVE/Jk-approval: steps done, tests recorded, session terminal. */
function readyExceptLive(api: ReturnType<typeof createQuestAgentAPI>, kind?: "feature" | "fix" | "investigation" | "migration") {
  const q = api.create({ title: "Ship the restart-verify gate", objective: "Ship it", steps: ["Write code", "Run tests"], usageInstructions: ["Run bun test"], kind })
  api.claim(q.id, { callID: "call-1", taskID: "t1", sessionID: "ses_w1", role: "worker" })
  api.step(q.id, 1, "done", "wrote the code")
  api.step(q.id, "run-tests", "done", "bun test: 12 pass")
  api.evidence(q.id, "tests", { command: "bun test", result: "passed", at: new Date().toISOString() })
  api.progress(q.id, "call-1", "finished", "completed")
  return q.id
}

test("requiresVerifyLive is true for running-code kinds, false for investigation", () => {
  expect(requiresVerifyLive("feature")).toBe(true)
  expect(requiresVerifyLive("fix")).toBe(true)
  expect(requiresVerifyLive("migration")).toBe(true)
  expect(requiresVerifyLive("investigation")).toBe(false)
  expect(requiresVerifyLive("multi-session")).toBe(false)
  expect(requiresVerifyLive("legacy")).toBe(false)
})

test("a feature Quest cannot reach Ready to complete without a passing live-host check", () => {
  const { dir, cleanup } = fixtureDir("verify-live-")
  const api = createQuestAgentAPI(dir)
  const id = readyExceptLive(api, "feature")
  let q = api.get(id)!
  expect(liveCheckOf(q).status).toBe("not-verified")
  expect(verifyLiveMissing(q).length).toBe(1)
  expect(completionMissing(q).some((m) => m.startsWith("VERIFY-LIVE"))).toBe(true)
  expect(q.state).not.toBe("Ready to complete")

  q = api.verifyLive(id, "failed", "bun run dev; hit /api/x", "500 after restart")
  expect(liveCheckOf(q).status).toBe("failed")
  expect(completionMissing(q).some((m) => m.startsWith("VERIFY-LIVE"))).toBe(true)

  q = api.verifyLive(id, "passed", "bun run dev; hit /api/x", "200 after restart")
  expect(liveCheckOf(q).status).toBe("passed")
  expect(completionMissing(q).some((m) => m.startsWith("VERIFY-LIVE"))).toBe(false)
  expect(q.state).toBe("Ready to complete")
  cleanup()
})

test("investigation Quests are not gated by VERIFY-LIVE", () => {
  const { dir, cleanup } = fixtureDir("verify-live-inv-")
  const api = createQuestAgentAPI(dir)
  const id = readyExceptLive(api, "investigation")
  const q = api.get(id)!
  expect(verifyLiveMissing(q)).toEqual([])
  expect(q.state).toBe("Ready to complete")
  cleanup()
})

test("recordLiveCheck refuses evidence with no command", () => {
  const { dir, cleanup } = fixtureDir("verify-live-empty-")
  const store = new QuestStore(dir)
  const id = "01j00000000000000000000020"
  store.create({ id, title: "Fix thing", objective: "test", kind: "fix" })
  expect(() => recordLiveCheck(store, id, "passed", "   ")).toThrow(/requires the command/)
  cleanup()
})

test("recordJkApproval refuses an anonymous approver", () => {
  const { dir, cleanup } = fixtureDir("jk-approve-anon-")
  const store = new QuestStore(dir)
  const id = "01j00000000000000000000021"
  store.create({ id, title: "Fix thing", objective: "test", kind: "fix" })
  expect(() => recordJkApproval(store, id, "  ")).toThrow(/explicit approver/)
  cleanup()
})

test("a recorded Jk yes plus a passing live check auto-completes and archives; no yes stops at Ready", () => {
  const { dir, cleanup } = fixtureDir("gated-completion-")
  const api = createQuestAgentAPI(dir)
  const id = readyExceptLive(api, "fix")

  // Live check passes but Jk never said yes: stays at Ready, never archives itself.
  let q = api.verifyLive(id, "passed", "restarted host, re-ran the fixed path", "confirmed fixed")
  expect(q.state).toBe("Ready to complete")
  expect(jkApprovalOf(q).status).toBe("pending")

  // Jk's yes lands after the live check already passed: fires auto-completion immediately.
  q = api.jkApprove(id, "Jk", "looks good, ship it")
  expect(jkApprovalOf(q).status).toBe("yes")
  expect(q.state).toBe("Archived")
  expect(q.reason).toMatch(/Auto-archived: Jk approved/)
  cleanup()
})

test("Jk yes recorded before the live check passes arms auto-completion for the moment it does", () => {
  const { dir, cleanup } = fixtureDir("gated-completion-order-")
  const api = createQuestAgentAPI(dir)
  const id = readyExceptLive(api, "feature")

  let q = api.jkApprove(id, "Jk", "pre-approved, just needs the live check")
  expect(jkApprovalOf(q).status).toBe("yes")
  expect(q.state).not.toBe("Archived")
  expect(q.state).not.toBe("Complete")

  q = api.verifyLive(id, "passed", "restarted host, exercised the new path", "works")
  expect(q.state).toBe("Archived")
  expect(q.reason).toMatch(/VERIFY-LIVE passed/)
  cleanup()
})

test("maybeAutoCompleteAndArchive is a no-op once a Quest is already Complete or Archived", () => {
  const { dir, cleanup } = fixtureDir("gated-completion-idempotent-")
  const api = createQuestAgentAPI(dir)
  const id = readyExceptLive(api, "fix")
  api.verifyLive(id, "passed", "restarted host", "ok")
  const archived = api.jkApprove(id, "Jk")
  expect(archived.state).toBe("Archived")
  const again = maybeAutoCompleteAndArchive(api.store, id)
  expect(again.state).toBe("Archived")
  expect(again.revision).toBe(archived.revision)
  cleanup()
})


test("board reads rederive stale assigned snapshots as Verifying without rewriting the ledger", async () => {
  const { dir, cleanup } = fixtureDir("verify-live-")
  try {
    const api = createQuestAgentAPI(dir)
    const id = readyExceptLive(api, "fix")
    const { listQuestFiles, readAllQuests } = await import("../quest/index")
    const path = listQuestFiles(dir)[0]!
    const stale = readFileSync(path, "utf8").replace("state: Verifying", "state: Working")
    writeFileSync(path, stale)
    const q = readAllQuests(dir).find((row) => row.quest?.id === id)!.quest!
    expect(q.state).toBe("Verifying")
    expect(readFileSync(path, "utf8")).toBe(stale)
  } finally { cleanup() }
})
