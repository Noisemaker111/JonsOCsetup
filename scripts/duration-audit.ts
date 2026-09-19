/**
 * Account for the wall clock in a session: where the time went, not just how long it took.
 *
 * Every figure here is a recorded timestamp from the host database -- assistant turn envelopes,
 * per-tool `created`/`ran`/`completed`, per-reasoning `created`/`completed`. Nothing is estimated.
 * The window is partitioned, so the segments sum to the session duration exactly; whatever no span
 * covers is reported as its own segment instead of being folded into the nearest one.
 *
 * The reading and the attribution live in duration-graph/duration-graph.ts, which the
 * /duration-graph TUI screen reads through as well, so the screen and this command cannot report
 * different numbers.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { readSessionDurations, durationGroups, formatDuration, type SessionDuration } from "../duration-graph/duration-graph"

const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
if (process.argv.includes("--help")) {
  console.log(`bun scripts/duration-audit.ts [--db <host.db>] [--session <id>] [--json] [--top <n>] [--busiest <n>]

  Without --db, audits the newest session database under the activated dev release.
  Reports where a session's wall clock went: time inside each tool, model response,
  reasoning, tool dispatch, waiting on you, and the gaps nothing recorded.
  The same report is a live screen in the TUI: /duration-graph.`)
  process.exit(0)
}

const installedConfig = process.env.OPENCODE_CONFIG_DIR ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".config", "opencode")
function newestDatabase(): string {
  const channelFile = join(installedConfig, ".channels", "dev.json")
  const roots = [existsSync(channelFile) ? JSON.parse(readFileSync(channelFile, "utf8")).root : undefined, join(installedConfig, ".channels", "state", "dev")].filter(Boolean) as string[]
  const found: { path: string; at: number }[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, depth + 1)
      else if (entry.name === "host.db") found.push({ path, at: statSync(path).mtimeMs })
    }
  }
  for (const root of roots) walk(root, 0)
  const newest = found.sort((a, b) => b.at - a.at)[0]
  if (!newest) throw new Error("No session database found; pass --db")
  return newest.path
}

const file = resolve(option("--db") ?? newestDatabase())
const bar = (share: number, width = 40) => "█".repeat(Math.max(share > 0 ? 1 : 0, Math.round(share * width)))

let sessions = readSessionDurations({ file, sessionID: option("--session") }).sessions
/** Without a session, the interesting ones are the ones that actually did work. */
const busiest = Number(option("--busiest") ?? (option("--session") ? 0 : 5))
if (!option("--session") && busiest > 0) sessions = sessions.sort((a, b) => b.activeMs - a.activeMs).slice(0, busiest)

if (process.argv.includes("--json")) { console.log(JSON.stringify(sessions, null, 2)); process.exit(0) }

const limit = Number(option("--top") ?? 12)
console.log("duration audit  " + file + "\n")
for (const session of sessions as SessionDuration[]) {
  console.log(`${session.agent ?? "?"}  ${session.title.slice(0, 60)}`)
  console.log(`  ${session.sessionID}`)
  console.log(`  session ${formatDuration(session.durationMs)}  (${new Date(session.startedAt).toISOString()} -> ${new Date(session.endedAt).toISOString()})`)
  console.log(`  working ${formatDuration(session.activeMs)} · waiting on you ${formatDuration(session.waitingMs)} · ${session.toolCalls} tool calls in ${session.turns.length} turns`)

  const groups = durationGroups(session)
  console.log(`\n  where the working time went:`)
  for (const group of groups) console.log(`    ${formatDuration(group.ms).padStart(8)} ${String(Math.round(group.share * 100)).padStart(3)}%  ${bar(group.share)}  ${group.kind}`)

  console.log(`\n  by segment (shares of the whole ${formatDuration(session.durationMs)} session):`)
  for (const segment of session.segments.slice(0, limit)) {
    console.log(`    ${formatDuration(segment.ms).padStart(8)} ${String(Math.round(segment.share * 100)).padStart(3)}%  ${bar(segment.share)}  ${segment.label}${segment.calls ? `  (${segment.calls} calls)` : ""}`)
  }
  const rest = session.segments.slice(limit)
  if (rest.length) console.log(`    ${formatDuration(rest.reduce((n, segment) => n + segment.ms, 0)).padStart(8)}        ${rest.length} smaller segments`)

  const sum = session.segments.reduce((n, segment) => n + segment.ms, 0)
  console.log(`\n  segments sum to ${formatDuration(sum)} of ${formatDuration(session.durationMs)} (rounding drift ${Math.abs(sum - session.durationMs)}ms)`)
  console.log(`  unaccounted: ${formatDuration(session.gapMs)} in ${session.gapCount} gaps nothing recorded — median ${session.medianGapMs}ms, longest ${formatDuration(session.longestGapMs)}`)
  if (session.concurrentToolMs) console.log(`  parallel tool calls overlapped by ${formatDuration(session.concurrentToolMs)}: the calls did more work than the clock spent in tools`)

  if (session.turns.length) {
    const slowest = [...session.turns].sort((a, b) => b.ms - a.ms).slice(0, 5)
    console.log(`\n  slowest turns:`)
    for (const turn of slowest) console.log(`    #${String(turn.seq).padStart(5)}  ${formatDuration(turn.ms).padStart(8)}  ${formatDuration(turn.toolMs).padStart(8)} in ${turn.tools} tools  ${formatDuration(turn.modelMs).padStart(8)} model`)
  }
  console.log()
}
