/**
 * @core-prevents the shared memory's index of core tests naming a test that no longer exists, so knowledge moved out of memory quietly becomes knowledge lost
 * @core-observed On 2026-09-12 every technical entry in the hub MEMORY.md was already enforced by a core test, so the file was a second copy that could only decay -- and three entries had: `glob`'s median execution had moved 79ms to 83ms, the approval-blocked share 53.1% to 54.9%, `nimbus_quill` 2,390 observations to 2,764. Replacing them with an index of the tests that own them only works while the index resolves; the same day, `test/verification-route.test.ts` was deleted by another change and its index entry had to move with it. A first version of this test also asserted a character ceiling. Jon removed it: never put a hard cap on anything counted in tokens or characters. Size is reported by `setup:sync` so growth is visible and judged, not refused.
 */
import { test, expect } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"

const MEMORY = "setup/files/Projects/opencode-hub/MEMORY.md"

test("the shared memory's test index resolves", () => {
  const memory = readFileSync(MEMORY, "utf8")
  const present = new Set(readdirSync("test").filter(f => f.endsWith(".test.ts")).map(f => f.replace(".test.ts", "")))

  // Only the index is checked, and only for names that look like a test rather than a path or a
  // command. A name that resolves nowhere sends the next reader to a file that does not exist, which
  // is worse than the entry this index replaced.
  const index = memory.slice(memory.indexOf("## Where the rest lives"))
  const named = [...index.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)].map(m => m[1])
    .filter(name => !name.includes("/") && !name.endsWith(".md") && !name.endsWith(".mjs") && !name.endsWith(".ts"))

  expect(named.length).toBeGreaterThan(0)
  expect(named.filter(name => !present.has(name))).toEqual([])
})
