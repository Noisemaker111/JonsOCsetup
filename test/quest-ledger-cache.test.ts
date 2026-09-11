/**
 * @core-prevents the ledger parse cache serving a Quest record the file no longer says, or handing normalizeState an object it already wrote state onto so the derived state comes from the previous read instead of the record
 * @core-observed readAllQuests reparses every record on every call -- 24ms for this installation's 102 records, 6.8ms reading and 16.1ms parsing -- and shared-guard runs it around every tool, typed-tool again per call and user-giver again inside eligible, so a driven Quest Giver turn measured 354ms median per inner `quest` call against a 103-record ledger versus 35ms against an empty one. deriveState returns early on q.state === "Archived" and q.state === "Complete", which a cached object carries in from the previous call (2026-09-11).
 */
import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearQuestParseCache, listQuestFiles, readAllQuests } from "../quest/index"
import { QuestStore } from "../quest/store"

const ID = "01j00000000000000000000abc"
const ledger = () => {
  const root = mkdtempSync(join(tmpdir(), "quest-cache-"))
  clearQuestParseCache()
  new QuestStore(root).create({
    id: ID, title: "Cached record", objective: "Prove the ledger cache tracks the file", kind: "investigation",
    contractVersion: 2, stages: [{ id: "a", title: "A", detail: "", status: "done", needs: [], todos: [] } as any],
  })
  return root
}
const file = (root: string) => listQuestFiles(root)[0]
const read = (root: string) => readAllQuests(root, { includeArchived: true })

test("a rewritten record is re-read, and an untouched one keeps reporting what it says", () => {
  const root = ledger()
  try {
    expect(read(root)[0].quest?.title).toBe("Cached record")
    // The same call again must still produce the record, not an empty row from a cache miss path.
    expect(read(root)[0].quest?.title).toBe("Cached record")
    const path = file(root)
    // The mtime is forced forward because a rewrite inside one filesystem tick is a real sequence
    // here -- a giver updating a Quest it read in the same turn -- and must still miss the cache.
    writeFileSync(path, readFileSync(path, "utf8").replace("Cached record", "Renamed record"))
    utimesSync(path, Date.now() / 1000 + 2, Date.now() / 1000 + 2)
    expect(read(root)[0].quest?.title).toBe("Renamed record")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a cached record derives its state from the file, not from the previous read's conclusion", () => {
  const root = ledger()
  try {
    const first = { ...read(root)[0].quest! }
    const again = read(root)[0].quest!
    // Every field normalizeState writes has to match a first read of the same bytes. If the cached
    // object kept the earlier conclusion, deriveState's early return on Archived/Complete would
    // pin it there for the life of the process.
    expect(again.state).toBe(first.state)
    expect(again.reason).toBe(first.reason)
    expect(again.nextAction).toBe(first.nextAction)
    expect(again.executingCount).toBe(first.executingCount)
    expect(again.missingRequirements).toEqual(first.missingRequirements)
    // And it has to match what an uncached process would conclude from those same bytes.
    clearQuestParseCache()
    expect(read(root)[0].quest?.state).toBe(first.state)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a removed record stops being returned and stops being held", () => {
  const root = ledger()
  try {
    expect(read(root)).toHaveLength(1)
    rmSync(file(root))
    expect(read(root)).toHaveLength(0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
