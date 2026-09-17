/** Runs the passive collector over real temporary files in its own process, and reports each tick. */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = process.argv[2]
process.env.OPENCODE_TELEMETRY_FILE = join(root, "requests.jsonl")
process.env.OPENCODE_PASSIVE_LEDGER_FILE = join(root, "ledger.sqlite")
process.env.OPENCODE_ACCOUNT_USAGE_FILE = join(root, "account-usage.json")
const rollouts = join(root, "rollouts"), hostDB = join(root, "absent.db")

const { collectPassive, ledgerCoverage } = await import("../../usage/passive-ledger")
const { readRequestsSince } = await import("../../usage/telemetry-store")

const now = Date.now()
const record = (index: number) => ({ version: 1, request: {
  id: "request-" + index, sessionID: "ses_collector", accountID: "verification-account",
  startedAt: now - 1000 * (index + 2), completedAt: now - 1000 * (index + 1),
  route: { providerID: "openai", modelID: "verification-model" }, kind: "primary", state: "completed",
  tokens: { input: 10, cacheRead: 1, cacheWrite: 0, output: 2, reasoning: 1 } } })
const rollout = (id: string, points: number) => {
  const line = (type: string, payload: object, at: number) => JSON.stringify({ timestamp: new Date(at).toISOString(), type, payload })
  const counter = (n: number) => ({ input_tokens: 100 * n, cached_input_tokens: 20 * n, cache_write_input_tokens: 0, output_tokens: 10 * n, reasoning_output_tokens: 2 * n, total_tokens: 110 * n })
  const rows = [line("session_meta", { id, source: "cli" }, now - 60000), line("turn_context", { model: "verification-model", effort: "high" }, now - 60000)]
  for (let n = 1; n <= points; n++) rows.push(line("event_msg", { type: "token_count", info: { total_token_usage: counter(n), last_token_usage: counter(1) } }, now - 60000 + n))
  return rows.join("\n") + "\n"
}
const tick = async (at: number) => {
  const cpu = process.cpuUsage(), started = performance.now()
  const result: any = await collectPassive({ root: rollouts, hostDB, now: at, force: true })
  const spent = process.cpuUsage(cpu)
  return { ...result.receipt, collected: result.collected, records: ledgerCoverage().records,
    wallMilliseconds: Math.round(performance.now() - started), cpuMilliseconds: Math.round((spent.user + spent.system) / 1000) }
}

mkdirSync(rollouts, { recursive: true })
writeFileSync(join(rollouts, "first.jsonl"), rollout("first", 2))
writeFileSync(process.env.OPENCODE_TELEMETRY_FILE, Array.from({ length: 200 }, (_, i) => JSON.stringify(record(i))).join("\n") + "\n")

const first = await tick(now)
const idle = await tick(now + 1000)

appendFileSync(process.env.OPENCODE_TELEMETRY_FILE, JSON.stringify(record(200)) + "\n")
writeFileSync(join(rollouts, "second.jsonl"), rollout("second", 1))
const moved = await tick(now + 2000)

writeFileSync(process.env.OPENCODE_TELEMETRY_FILE, JSON.stringify(record(0)) + "\n")
const replaced = await tick(now + 3000)

// A partly written trailing line belongs to the next tick, not to this one's diagnostics.
const cursor = readRequestsSince(null)
const whole = JSON.stringify(record(1)) + "\n"
appendFileSync(process.env.OPENCODE_TELEMETRY_FILE, whole.slice(0, 20))
const partial = readRequestsSince(cursor.cursor)
appendFileSync(process.env.OPENCODE_TELEMETRY_FILE, whole.slice(20))
const completed = readRequestsSince(partial.cursor)

console.log(JSON.stringify({ first, idle, moved, replaced,
  partial: { records: partial.records.length, diagnostics: partial.diagnostics.length, bytesRead: partial.bytesRead },
  completed: { records: completed.records.length, restarted: completed.restarted } }))
