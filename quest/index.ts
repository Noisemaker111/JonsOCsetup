import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseQuestMarkdown } from "./cst"
import { normalizeState } from "./state-machine"
import type { Quest } from "./types"
export { boardRows, questBoard, questLane, sortNewestFirst } from "./board"

/**
 * A missing ledger directory (ENOENT) deterministically means "no Quests
 * here yet" -- expected on a fresh root nothing has written to. Any other
 * readdir failure (permissions, a file where a directory belongs, ...) is a
 * real problem and must not be swallowed into the same silent empty result;
 * that would hide a wrong/broken root behind what looks like "zero Quests".
 */
function readdirOrEmpty(dir: string): string[] {
  try { return readdirSync(dir) } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return []
    throw error
  }
}

export function listQuestFiles(projectRoot: string): string[] {
  return readdirOrEmpty(join(projectRoot, ".opencode", "quests")).filter((x) => /^[0-9a-hjkmnp-tv-z]{26}--.+\.md$/.test(x)).sort().map((x) => join(projectRoot, ".opencode", "quests", x))
}
/** Archived Quest files are physically relocated out of the active ledger into date-named folders. */
export function listArchivedQuestFiles(projectRoot: string): string[] {
  const archiveRoot = join(projectRoot, ".opencode", "quests-archive")
  return readdirOrEmpty(archiveRoot).flatMap((dateDir) => {
    const dirPath = join(archiveRoot, dateDir)
    // Per-date-folder entries are tolerated loosely: a stray non-directory
    // file under quests-archive/ is junk to skip, not a wrong-root signal.
    try { return readdirSync(dirPath).filter((x) => /^[0-9a-hjkmnp-tv-z]{26}--.+\.md$/.test(x)).map((x) => join(dirPath, x)) } catch { return [] }
  }).sort()
}
/**
 * Parsed Quest records, keyed by file and invalidated by what the file says about itself.
 *
 * Reading the whole ledger is not a listing operation here: `shared-guard` wraps every tool with
 * it, `typed-tool` repeats it per call, and `user-giver` runs it again inside `eligible`, so one
 * Quest Giver turn parses the ledger dozens of times. Measured on this installation's 102 records
 * that is 24 ms a time -- 6.8 ms reading and 16.1 ms parsing -- for files that did not change.
 *
 * The freshness bound is the file's own `mtimeMs` and `size`, read fresh on every call (0.8 ms for
 * all 102). Nothing is served on a timer and nothing is assumed unchanged: a record that was
 * written, replaced, archived or removed misses the cache on the very next read. Quest writes go
 * through `QuestStore`, which reads and writes files directly and never through here, so a write
 * cannot be served a stale record either.
 */
type ParsedRow = { quest?: Quest; path: string; errors: string[] }
type CacheEntry = { mtimeMs: number; size: number; row: ParsedRow; parsed: DerivedFields }
/** Exactly the fields `normalizeState` overwrites, kept as the parse produced them. */
type DerivedFields = Pick<Quest, "state" | "reason" | "nextAction" | "missingRequirements" | "executingCount">
const parseCache = new Map<string, CacheEntry>()
const derived = (q: Quest): DerivedFields => ({ state: q.state, reason: q.reason, nextAction: q.nextAction, missingRequirements: q.missingRequirements, executingCount: q.executingCount })

/** Test seam: a suite that writes two versions of a record inside one filesystem tick needs this. */
export function clearQuestParseCache() { parseCache.clear() }

export function readAllQuests(projectRoot: string, options: { includeArchived?: boolean } = {}): Array<{ quest?: Quest; path: string; errors: string[] }> {
  const files = options.includeArchived ? [...listQuestFiles(projectRoot), ...listArchivedQuestFiles(projectRoot)] : listQuestFiles(projectRoot)
  const rows = files.map((path) => {
    // An unreadable stat is the file going away underneath us; parse it and let read report why.
    let mtimeMs = 0, size = -1
    try { const info = statSync(path); mtimeMs = info.mtimeMs; size = info.size } catch { size = -1 }
    const hit = size >= 0 ? parseCache.get(path) : undefined
    if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
      // `normalizeState` both reads and writes `state`, so a cached record has to be handed to it
      // looking like a fresh parse or the second call derives from the first call's conclusion.
      if (hit.row.quest) Object.assign(hit.row.quest, hit.parsed)
      return hit.row
    }
    const p = parseQuestMarkdown(readFileSync(path, "utf8"))
    const row: ParsedRow = { quest: p.errors.length ? undefined : p.quest, path, errors: p.errors }
    if (size >= 0) parseCache.set(path, { mtimeMs, size, row, parsed: row.quest ? derived(row.quest) : ({} as DerivedFields) })
    return row
  })
  // Records that no longer exist stop being held; the cache never outgrows the ledger.
  if (parseCache.size > files.length) { const live = new Set(files); for (const path of parseCache.keys()) if (!live.has(path)) parseCache.delete(path) }
  const byID = new Map(rows.flatMap(({ quest }) => quest ? [[quest.id, quest] as const] : []))
  for (const row of rows) if (row.quest) normalizeState(row.quest, (id) => byID.get(id))
  return rows
}
export function nonArchivedQuests(quests: Quest[]): Quest[] { return quests.filter((q) => q.state !== "Archived") }
export function generateQuestIndex(projectRoot: string): string {
  const rows = readAllQuests(projectRoot).map(({ quest: q, path, errors }) => q
    ? `| ${q.state === "Ready to complete" || q.state === "Complete" ? `${q.state} (ready for user turn-in)` : q.state} | [${q.title}](quests/${path.split(/[\\/]/).pop()}) | ${q.executingCount} | ${q.deliverables.filter((d) => d.status !== "done").length} | ${q.updatedAt} |`
    : `| Needs attention | ${path.split(/[\\/]/).pop()} | 0 | ? | ${errors.join("; ")} |`).sort()
  return ["# Quest Log", "", "<!-- generated: do not edit; Quest Markdown files are authoritative -->", "", "| State | Quest | Executing | Remaining | Updated |", "|---|---|---:|---:|---|", ...rows, ""].join("\n")
}
