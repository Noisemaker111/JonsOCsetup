import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as contextPolicy from "../orchestration/context-policy"
import { contextPercent, preserveRecoveryManifest } from "../orchestration/context-policy"
import { deliverMessage, enqueueMessage, pendingMessages } from "../orchestration/orchestration-ledger"
import { formatContextUsage } from "../usage/tui-usage-format"

test("effective Sol context math is explicit", () => {
  expect("EFFECTIVE_CONTEXT_LIMIT" in contextPolicy).toBe(false)
  expect("AUTO_COMPACTION_AT" in contextPolicy).toBe(false)
  expect("shouldCompact" in contextPolicy).toBe(false)
  expect("effectiveCompactionConfig" in contextPolicy).toBe(false)
  expect(contextPercent(100_000, 200_000)).toBe(50)
  expect(formatContextUsage(12_000)).toBe("12k")
  expect(formatContextUsage(12_000)).not.toMatch(/200k/)
  expect(formatContextUsage(100_000, 200_000)).toBe("100k/200k (50%)")
  const m = preserveRecoveryManifest({ sessionID: "ses_x", model: "openai/gpt-5.6-sol", queuedMessages: ["follow-up"], blockers: ["hung"] })
  expect(m.queuedMessages).toEqual(["follow-up"]); expect(m.blockers).toEqual(["hung"])
})

test("queued follow-ups survive reload projection and deliver once", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-reliability-")), file = join(dir, "ledger.jsonl")
  try { expect(enqueueMessage("ses_parent", "msg-1", "follow-up", file)).toBe(true); expect(enqueueMessage("ses_parent", "msg-1", "duplicate", file)).toBe(false); expect(pendingMessages("ses_parent", file)).toHaveLength(1); expect(deliverMessage("ses_parent", "msg-1", file)).toBe(true); expect(deliverMessage("ses_parent", "msg-1", file)).toBe(false); expect(pendingMessages("ses_parent", file)).toHaveLength(0) } finally { rmSync(dir, { recursive: true, force: true }) }
})
