import { readdirSync, readFileSync } from "node:fs"
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
export function readAllQuests(projectRoot: string, options: { includeArchived?: boolean } = {}): Array<{ quest?: Quest; path: string; errors: string[] }> {
  const files = options.includeArchived ? [...listQuestFiles(projectRoot), ...listArchivedQuestFiles(projectRoot)] : listQuestFiles(projectRoot)
  const rows = files.map((path) => { const p = parseQuestMarkdown(readFileSync(path, "utf8")); return { quest: p.errors.length ? undefined : p.quest, path, errors: p.errors } })
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
