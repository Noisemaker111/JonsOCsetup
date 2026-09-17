/**
 * @core-prevents the passive usage collector re-reading the whole request log and every Codex rollout on each thirty-second tick
 * @core-observed On 2026-09-17 a tick with nothing new to collect cost 1,302-1,395 ms wall and 1,375-1,515 ms CPU on the live dev files, re-parsing an 18 MB request log and re-upserting 36,000 unchanged ledger rows every thirty seconds while the host thread was already saturated.
 */
import { test, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("a tick reads only what moved, and a tick with nothing new writes no request rows", async () => {
  const root = mkdtempSync(join(tmpdir(), "usage-collector-"))
  try {
    // The collector reads files chosen by environment, so it is run in its own process on real ones.
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/usage-collector-probe.ts"), root], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    const seen = JSON.parse(output.trim().split("\n").at(-1)!)

    expect(seen.first.collected).toBe(true)
    expect(seen.first.newRequests).toBe(200)
    expect(seen.first.readFiles).toBe(1)
    expect(seen.first.records).toBeGreaterThanOrEqual(202)

    // Nothing changed: no rollout is opened, no request line is re-read, no row is written.
    expect(seen.idle.newRequests).toBe(0)
    expect(seen.idle.readFiles).toBe(0)
    expect(seen.idle.unchangedFiles).toBe(1)
    expect(seen.idle.writtenRows).toBe(0)
    expect(seen.idle.records).toBe(seen.first.records)

    // One appended request and one new rollout are the only work the next tick does.
    expect(seen.moved.newRequests).toBe(1)
    expect(seen.moved.readFiles).toBe(1)
    expect(seen.moved.unchangedFiles).toBe(1)
    expect(seen.moved.records).toBe(seen.first.records + 2)

    // A cursor is a claim about exact bytes: a replaced log is re-read rather than half-counted.
    expect(seen.replaced.newRequests).toBe(1)
    expect(seen.replaced.diagnostics.some((d: string) => d.includes("replaced"))).toBe(true)

    // A partly written trailing line waits for the next read instead of becoming a diagnostic.
    expect(seen.partial).toEqual({ records: 0, diagnostics: 0, bytesRead: 20 })
    expect(seen.completed).toEqual({ records: 1, restarted: false })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
