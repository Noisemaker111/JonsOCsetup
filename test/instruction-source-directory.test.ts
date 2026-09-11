/**
 * @core-prevents a project directory reaching the host in a spelling the host cannot walk up to the home directory, which kills instruction discovery and blocks every session created there before its first turn
 * @core-observed Six Quests on the real ledger — Fix Ctrl+Backspace, Explain OpenCode2 updates, Make Quest work small and two Vercel audits among them — recorded "Host reported execution failed: Instruction initialization blocked by unavailable sources: core/instructions" on 2026-09-09. opencode.log shows each of those workers booted at "c:\\users\\jk101\\..." while the home directory is "C:\\Users\\Jk101", and the matching line is WARN "failed to activate instruction source" with Die(RangeError: Maximum call stack size exceeded).
 */
import { test, expect } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { verifyTarget, targetKey } from "../project-router/resolution"

/**
 * The host's own walk, from upstream packages/core/src/config/plugin/instruction.ts:
 *
 *   const stop = FSUtil.contains(home, start) ? home : root
 *   function ancestorDirectories(start, stop) {
 *     if (start === stop) return [start]
 *     return [start, ...ancestorDirectories(dirname(start), stop)]
 *   }
 *
 * `contains` goes through path.relative, which is case-insensitive on Windows, so a lowercased
 * start still selects the home directory as its stop. The walk itself compares with `===`, which
 * is not, so it steps past the drive root forever. Bounded here so a failing case reports rather
 * than overflowing the test runner's stack.
 */
function walkReaches(start: string, stop: string) {
  let current = start
  for (let depth = 0; depth < 64; depth++) {
    if (current === stop) return true
    const parent = dirname(current)
    if (parent === current) return false // the drive root, where the host recurses instead of stopping
    current = parent
  }
  return false
}

test("a selected project directory is the operating system's spelling, so the host can walk it up to home", () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "router-case-")))
  try {
    const directory = join(home, "Project-Sources", "OpenCode-Hub")
    mkdirSync(directory, { recursive: true })

    // What the host needs and cannot get for itself: the same bytes it will compare against.
    expect(walkReaches(directory, home)).toBe(true)

    // A selector arrives however it was spoken, typed or echoed by git. The target must not.
    // Case only varies where the filesystem accepts it; elsewhere a recased path is a different path.
    const selectors = process.platform === "win32"
      ? [directory, directory.toLowerCase(), directory.toUpperCase()]
      : [directory]
    // The shape the six blocked workers actually booted with, shown to be the unwalkable one.
    if (process.platform === "win32") expect(walkReaches(directory.toLowerCase(), home)).toBe(false)

    for (const selector of selectors) {
      const target = verifyTarget(selector)
      expect(target.directory).toBe(directory)
      expect(walkReaches(target.directory, home)).toBe(true)
      // Route receipts, destination associations and the known-project registry are keyed off the
      // directory; recasing it must not orphan what is already stored against those keys.
      expect(targetKey(target)).toBe(targetKey({ ...target, directory: selector }))
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
})
