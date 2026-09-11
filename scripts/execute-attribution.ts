/**
 * Account for the time inside Code Mode `execute` calls: which inner tool spent it, and how much
 * of the span nothing explains.
 *
 * The reading and the attribution live in context-graph/execute-attribution.ts, which any duration
 * screen reads through as well, so a screen and this command cannot report different numbers.
 *
 * `--solo` answers the same question about sessions recorded before the timing plugin existed: an
 * execute that made exactly one inner call spent its whole span on that call plus Code Mode's own
 * overhead, so the span is an upper bound for that tool. It is a separate, clearly labelled mode
 * because it is a bound, not a measurement.
 */
import { Database } from "bun:sqlite"
import { hostDatabaseFile } from "../context-graph/context-graph"
import { attributionTotals, innerToolStats, readExecuteSpans, type ExecuteSpan } from "../context-graph/execute-attribution"

const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
const flag = (name: string) => process.argv.includes(name)

if (flag("--help")) {
  console.log(`bun scripts/execute-attribution.ts [--db <host.db>] [--session <id>] [--json] [--solo] [--top <n>]

  Attributes each Code Mode execute span to the inner tool calls that ran inside it.
  Overlapping inner calls are merged before subtraction; the remainder is reported as unaccounted.
  --solo additionally bounds per-tool cost from single-call executes, which needs no instrumentation.`)
  process.exit(0)
}

const file = option("--db") ?? hostDatabaseFile()
const top = Number(option("--top") ?? 15)
const { spans } = readExecuteSpans({ file, sessionID: option("--session") })
const totals = attributionTotals(spans)
const tools = innerToolStats(spans)
const seconds = (ms: number) => (ms / 1000).toFixed(1) + "s"
const percent = (value: number) => (value * 100).toFixed(1) + "%"

/**
 * Executes with exactly one inner call, per tool: without per-call timing the span is still that
 * one call plus runtime overhead, so it bounds the tool from above across the whole history.
 */
function soloBounds(): { tool: string; n: number; totalMs: number; medianMs: number; p95Ms: number; maxMs: number }[] {
  const db = new Database(file, { readonly: true })
  const byTool = new Map<string, number[]>()
  try {
    db.exec("PRAGMA busy_timeout=1000")
    const rows = db.query("select data from session_message where type='assistant'").all() as { data: string }[]
    for (const row of rows) {
      let data: any
      try { data = JSON.parse(row.data) } catch { continue }
      for (const part of data.content ?? []) {
        if (part?.type !== "tool" || part.name !== "execute") continue
        const calls = part.state?.metadata?.toolCalls ?? []
        const time = part.time ?? {}
        const began = time.ran ?? time.created
        if (calls.length !== 1 || typeof began !== "number" || typeof time.completed !== "number") continue
        const list = byTool.get(calls[0].tool) ?? []
        list.push(time.completed - began)
        byTool.set(calls[0].tool, list)
      }
    }
  } finally { db.close() }
  const quantile = (values: number[], fraction: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] }
  return [...byTool.entries()]
    .map(([tool, list]) => ({ tool, n: list.length, totalMs: list.reduce((n, value) => n + value, 0), medianMs: quantile(list, 0.5), p95Ms: quantile(list, 0.95), maxMs: Math.max(...list) }))
    .sort((a, b) => b.totalMs - a.totalMs)
}

if (flag("--json")) {
  console.log(JSON.stringify({ file, totals, tools, ...(flag("--solo") ? { soloBounds: soloBounds() } : {}), spans: option("--session") ? spans : undefined }, null, 2))
  process.exit(0)
}

const timedSpanMs = spans.filter(span => span.timed).reduce((n, span) => n + span.durationMs, 0)
const share = (ms: number) => timedSpanMs ? percent(ms / timedSpanMs) : "0.0%"

console.log(`database  ${file}`)
console.log(`executes  ${totals.executes}  (${totals.timed} timed, ${totals.untimed} with no recorded inner spans)`)
console.log(`span      ${seconds(totals.spanMs)} total, of which ${seconds(timedSpanMs)} is in timed executes`)
console.log(`\nwhere a timed execute's span goes`)
console.log(`  inner tool calls  ${seconds(totals.attributedMs).padStart(9)}  ${share(totals.attributedMs).padStart(6)}  merged, so parallel calls are counted once`)
console.log(`  runtime startup   ${seconds(totals.startupMs).padStart(9)}  ${share(totals.startupMs).padStart(6)}  the window opening to the first call`)
console.log(`  between calls     ${seconds(totals.betweenMs).padStart(9)}  ${share(totals.betweenMs).padStart(6)}  the model's own JavaScript`)
console.log(`  returning         ${seconds(totals.tailMs).padStart(9)}  ${share(totals.tailMs).padStart(6)}  the last call ending to the window closing`)
console.log(`  these four are exact and sum to the span; only the first is attributable to a tool`)
console.log(`\nattributed to a named inner tool: ${percent(totals.coverage)} of the timed executes' span, ${percent(totals.coverageOfAll)} of every execute span`)
const untimedByTool = Object.entries(totals.untimedCalls).sort((a, b) => b[1] - a[1])
if (untimedByTool.length) {
  console.log(`\ncalls the metadata names that no hook could time: ${untimedByTool.map(([tool, n]) => `${tool} x${n}`).join(", ")}`)
  console.log(`  Code Mode's built-in search resolves inside the runtime's own catalog and never reaches a host tool.`)
  if (totals.untimedRejected) console.log(`  ${totals.untimedRejected} of them are recorded as errors: the runtime rejected the call on its own signature check, so no host tool ever ran.`)
}

const worst = [...spans].filter(span => span.timed).sort((a, b) => b.unaccountedMs - a.unaccountedMs).slice(0, 5)
if (worst.length) {
  console.log(`\nlargest non-tool remainders`)
  for (const span of worst) console.log(`  ${seconds(span.unaccountedMs).padStart(8)} of ${seconds(span.durationMs).padStart(8)}  ${span.calls} calls  startup ${span.startupMs}ms between ${span.betweenMs}ms tail ${span.tailMs}ms  ${span.sessionID} seq ${span.seq}`)
}

if (tools.length) {
  console.log(`\ninner tool                    calls   errors      total    median       p95       max`)
  for (const tool of tools.slice(0, top))
    console.log(`  ${tool.tool.padEnd(26)} ${String(tool.calls).padStart(5)} ${String(tool.errors).padStart(8)} ${seconds(tool.totalMs).padStart(10)} ${(tool.medianMs + "ms").padStart(9)} ${(tool.p95Ms + "ms").padStart(9)} ${(tool.maxMs + "ms").padStart(9)}`)
}

if (flag("--solo")) {
  console.log(`\nupper bound from single-call executes (span includes Code Mode overhead, so these are bounds)`)
  console.log(`inner tool                    calls               total    median       p95       max`)
  for (const tool of soloBounds().slice(0, top))
    console.log(`  ${tool.tool.padEnd(26)} ${String(tool.n).padStart(5)} ${seconds(tool.totalMs).padStart(19)} ${(tool.medianMs + "ms").padStart(9)} ${(tool.p95Ms + "ms").padStart(9)} ${(tool.maxMs + "ms").padStart(9)}`)
}

const untimedSpans = spans.filter((span: ExecuteSpan) => !span.timed)
if (untimedSpans.length) {
  const group = (label: string, pick: (span: ExecuteSpan) => boolean) => {
    const rows = untimedSpans.filter(pick)
    return rows.length ? `  ${rows.length} ${label} (${seconds(rows.reduce((n, span) => n + span.durationMs, 0))})` : undefined
  }
  console.log(`\n${untimedSpans.length} executes carry no inner spans (${seconds(untimedSpans.reduce((n, span) => n + span.durationMs, 0))}):`)
  const onlySearch = (span: ExecuteSpan) => span.untimed.length > 0 && span.untimed.every(call => call.tool === "search")
  const onlyRejected = (span: ExecuteSpan) => span.untimed.length > 0 && span.untimed.every(call => call.tool === "search" || call.status === "error")
  for (const line of [
    group("made only Code Mode catalog searches, which never reach a host tool", onlySearch),
    group("had every call rejected by the runtime's signature check before a host tool ran", span => !onlySearch(span) && onlyRejected(span)),
    group("called no tool at all", span => span.calls === 0 && span.status === "completed"),
    group("failed, so the host returned the error instead of a result and there was no metadata to record on", span => span.status !== "completed"),
    group("recorded calls the hooks never saw for another reason, or predate the timing plugin", span => span.status === "completed" && span.calls > 0 && !onlyRejected(span)),
  ].filter(Boolean)) console.log(line)
}
