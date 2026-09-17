/**
 * @core-prevents the default usage_status answer growing with recorded history instead of staying a fixed-shape account digest
 * @core-observed On 2026-09-17 getUsageStatus({}) against the live dev files returned 9,308,294 characters in 4,539 ms, almost all of it a per-session list over every ledger row and the whole request history.
 */
import { test, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("the default answer keeps one shape and one size class however much history the ledger holds", async () => {
  const root = mkdtempSync(join(tmpdir(), "usage-digest-"))
  try {
    // The digest reads files chosen by environment, so it is driven in its own process on real ones.
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/usage-digest-probe.ts"), root], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    const seen = JSON.parse(output.trim().split("\n").at(-1)!)

    // A hundredfold more recorded history, the same digest.
    expect(seen.large.records).toBeGreaterThan(seen.small.records * 50)
    expect(seen.large.shape).toEqual(seen.small.shape)
    expect(Math.abs(seen.large.chars - seen.small.chars)).toBeLessThan(1000)

    // Nothing that scales with history is in it, by name or by content.
    expect(seen.large.json).not.toContain("requestHistory")
    expect(seen.large.json).not.toContain("request-4000")
    expect(seen.large.requests).toBe(5000)
    expect(seen.large.input).toBe(500_000)
    expect(seen.large.remainingPercent).toBe(60)
    expect(seen.large.pacingAccount).toBe("verification-account")
    expect(seen.large.textChars).toBeLessThan(2000)

    // Detail is explicit and each view answers exactly the page it was asked for.
    expect(seen.requests).toEqual({ rows: 5, total: 5000, nextOffset: 5 })
    expect(seen.sessions).toEqual({ rows: 3, total: 40 })
    expect(seen.timeline.points).toBe(4)
    expect(seen.timeline.quotaSamples).toBeLessThanOrEqual(4)
    expect(seen.timeline.chars).toBeLessThan(20_000)
    expect(seen.refusals.oversizedPage).toContain("pagination")
    expect(seen.refusals.poolsWithoutAccount).toContain("accountID")
    expect(seen.refusals.unknownView).toContain("Unknown usage view")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
