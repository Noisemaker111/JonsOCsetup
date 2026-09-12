/**
 * Account for the tokens in a session: what was sent, where it came from, and what it cost.
 *
 * The host records real per-request token counts, so growth per turn is measured rather than
 * estimated. Composition is attributed from the stored parts -- injected instructions, prompts,
 * tool calls and tool results -- because that is the part a change can actually shrink. Estimates
 * are labelled as estimates and reconciled against the recorded totals rather than replacing them.
 *
 * The reading and the attribution live in context-graph/context-graph.ts, which the /context-graph
 * TUI screen reads through as well, so the screen and this command cannot report different numbers.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { readSessionContexts } from "../context-graph/context-graph"

const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
if (process.argv.includes("--help")) {
  console.log(`bun scripts/context-audit.ts [--db <host.db>] [--session <id>] [--json] [--top <n>]

  Without --db, audits the newest session database under the activated dev release.
  Reports per-turn recorded tokens and an attributed breakdown of what was sent.
  The same report is a live screen in the TUI: /context-graph.`)
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
const bar = (share: number, width = 46) => "█".repeat(Math.max(share > 0 ? 1 : 0, Math.round(share * width)))

/** Spend concentrates in a few metered calls, and the same model is often already on a subscription. */
if (process.argv.includes("--spend")) {
  const db = new Database(file, { readonly: true })
  const perModel = new Map<string, { input: number; cost: number }>()
  for (const row of db.query("select data from session_message where type='assistant'").all() as any[]) {
    let message: any
    try { message = JSON.parse(row.data) } catch { continue }
    const used = message.tokens ?? {}
    if (used.input === undefined) continue
    const model = message.model ?? {}
    const key = String(model.providerID) + "/" + String(model.modelID ?? model.id)
    const seen = perModel.get(key) ?? { input: 0, cost: 0 }
    seen.input += used.input ?? 0
    seen.cost += message.cost ?? 0
    perModel.set(key, seen)
  }
  db.close()
  const subscriptionLanes = ["opencode", "opencode-go", "openai", "grok-sub"]
  const bare = (key: string) => key.split("/").slice(1).join("/").split("/").pop() ?? key
  const owned = new Set<string>()
  for (const key of perModel.keys()) if (subscriptionLanes.includes(key.split("/")[0])) owned.add(bare(key))
  const paid = [...perModel.entries()].filter(([, v]) => v.cost > 0).sort((a, b) => b[1].cost - a[1].cost)
  console.log("spend by model\n")
  let avoidable = 0
  for (const [key, value] of paid.slice(0, 12)) {
    // A subscription-lane model is not its own cheaper alternative; only a metered call can move.
    const twin = !subscriptionLanes.includes(key.split("/")[0]) && owned.has(bare(key))
    if (twin) avoidable += value.cost
    const rate = value.input ? value.cost / (value.input / 1e6) : 0
    console.log(`  $${value.cost.toFixed(2).padStart(7)}  ${String(value.input).padStart(12)} tok  $${rate.toFixed(2).padStart(9)}/Mtok  ${key}${twin ? "   <- same model is on a subscription lane" : ""}`)
  }
  console.log(`\n  $${avoidable.toFixed(2)} of metered spend went to models already available on a subscription lane.`)
  process.exit(0)
}

const report = readSessionContexts({ file, sessionID: option("--session") }).sessions.map(session => ({
  session: session.sessionID,
  agent: session.agent,
  title: session.title.slice(0, 60),
  recorded: session.recorded,
  coldStartTokens: session.coldStartTokens,
  turns: session.turns,
  attributed: session.slices.map(slice => ({ label: slice.label, chars: slice.chars, tokens: slice.tokens })),
  estimatedTokens: session.sentTokens,
  storedOnlyTokens: session.storedOnlyTokens,
}))

if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); process.exit(0) }

const limit = Number(option("--top") ?? 12)
console.log("context audit  " + file + "\n")
for (const entry of report) {
  console.log(`${entry.agent ?? "?"}  ${entry.title}`)
  console.log(`  recorded ${entry.recorded.input} in / ${entry.recorded.output} out  $${entry.recorded.cost}   cold start ${entry.coldStartTokens} tok`)
  if (entry.turns.length) {
    console.log("  turns:")
    for (const turn of entry.turns.slice(0, 10)) console.log(`    #${String(turn.seq).padStart(3)}  sent ${String(turn.input).padStart(6)}  cached ${String(turn.cached).padStart(6)}  out ${String(turn.output).padStart(5)}  $${turn.cost}`)
    if (entry.turns.length > 10) console.log(`    ... ${entry.turns.length - 10} more turns`)
  }
  const total = entry.estimatedTokens || 1
  console.log(`  sent ~${entry.estimatedTokens} tok` + (entry.storedOnlyTokens ? ` (plus ${entry.storedOnlyTokens} tok stored for the TUI, never sent)` : "") + `:`)
  for (const row of entry.attributed.slice(0, limit)) {
    const share = row.tokens / total
    console.log(`    ${String(row.tokens).padStart(6)} tok ${String(Math.round(share * 100)).padStart(3)}%  ${bar(share)}  ${row.label}`)
  }
  const rest = entry.attributed.slice(limit)
  if (rest.length) console.log(`    ${String(rest.reduce((n: number, r: any) => n + r.tokens, 0)).padStart(6)} tok       ${rest.length} smaller sources`)
  console.log()
}
