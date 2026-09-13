/**
 * @core-prevents a tracked setup entry whose recorded hash no longer matches the bytes it points at, a manifest entry with no source file, and the same target being installed from two different sources
 * @core-observed On 2026-09-12 `~/.agents/skills/opencode-dev-workflow/SKILL.md` and `~/.codex/AGENTS.md` were both found ahead of the files they install from: the skill had already been reworded once to stop saying "dev release" and "master is stable", and AGENTS.md had gained a paragraph on user-owned model choice, neither of which had reached this tree. `Projects/opencode-hub/AGENTS.md` carried a stale hash from an earlier edit on top of that, and the first PR to fix the wording changed source bytes without touching the manifest at all -- so `setup:install` would have refused the very files it was meant to deliver, and the same correction would have been made a third time.
 */
import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

const manifest = JSON.parse(readFileSync("setup/manifest.json", "utf8"))

test("every manifest entry points at bytes that still hash to what it recorded", () => {
  expect(manifest.entries.length).toBeGreaterThan(0)

  const stale: string[] = []
  const absent: string[] = []
  for (const entry of manifest.entries) {
    if (!existsSync(entry.source)) { absent.push(entry.target); continue }
    const actual = createHash("sha256").update(readFileSync(entry.source)).digest("hex")
    if (actual !== entry.sha256) stale.push(`${entry.target} (${entry.source})`)
  }
  // Named rather than counted: the point of failing is to say which file to re-capture.
  expect(absent).toEqual([])
  expect(stale).toEqual([])

  // One target, one source. Two entries writing the same path make installation order decide what
  // lands, which is how a correction disappears without anything reporting a failure.
  const targets = manifest.entries.map((e: { target: string }) => e.target.replaceAll("\\", "/"))
  expect(targets.length).toBe(new Set(targets).size)
})
