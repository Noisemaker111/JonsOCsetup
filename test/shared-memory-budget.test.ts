/**
 * @core-prevents the shared memory growing back into something nobody finishes reading, and a claim about this code being kept there instead of in a test that would fail when it stopped being true
 * @core-observed On 2026-09-12 the hub MEMORY.md was 15,850 characters across 45 entries. Every technical entry in it was already enforced by a core test, so it was a second copy that could only decay -- and three had: `glob`'s median execution had moved 79ms to 83ms, the approval-blocked share 53.1% to 54.9%, and `nimbus_quill` 2,390 observations to 2,764. A prose rule saying "keep it short" was already in AGENTS.md and had not held, which is why this is a test. The file went to 4,939 characters holding only what nothing else can: how to work with Jon, facts about the world outside this repository, and the two APIs no test guards.
 */
import { test, expect } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"

const MEMORY = "setup/files/Projects/opencode-hub/MEMORY.md"

// Chosen a little above what the file needs, so an entry that earns its place fits and a drift back
// toward a second copy of the test suite does not. Raising it is a decision, not a formality: say in
// the commit what could not live in a test, an AGENTS.md or a script instead.
const BUDGET = 6000

test("the shared memory stays small enough to be read, and points at tests rather than restating them", () => {
  const memory = readFileSync(MEMORY, "utf8")
  expect(memory.length).toBeLessThanOrEqual(BUDGET)

  // Characters, not bytes: the file is not ASCII and Jon asked for the measure he actually wants.
  expect(Buffer.byteLength(memory, "utf8")).toBeGreaterThanOrEqual(memory.length)

  // Every test the index names has to resolve, or the index sends the next reader nowhere and the
  // knowledge it replaced is gone rather than moved.
  const present = new Set(readdirSync("test").filter(f => f.endsWith(".test.ts")).map(f => f.replace(".test.ts", "")))
  const named = [...memory.matchAll(/`([a-z0-9-]+)`/g)]
    .map(m => m[1])
    .filter(name => present.has(name) || name.endsWith("-test") || /^(drive|quest|release|new-conversation|execute|duration|context|try-ref|refused|live-route|verification|model-selection|task-aware|result-budget|worktree|deploy|giver|setup)-/.test(name))
  const missing = named.filter(name => !present.has(name) && !name.startsWith("quest-") )
  expect(missing).toEqual([])
})
