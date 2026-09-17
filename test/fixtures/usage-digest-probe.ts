/** Drives the usage digest against real temporary files in its own process, and reports what it saw. */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const root = process.argv[2]
process.env.OPENCODE_TELEMETRY_FILE = join(root, "requests.jsonl")
process.env.OPENCODE_PASSIVE_LEDGER_FILE = join(root, "ledger.sqlite")
process.env.OPENCODE_ACCOUNT_USAGE_FILE = join(root, "account-usage.json")

const { persistLedger, ledgerRows } = await import("../../usage/passive-ledger")
const { getUsageStatus, getUsageDetail, formatUsageStatus } = await import("../../usage/status-api")

const now = Date.now()
const account = {
  id: "verification-account", provider: "openai", identity: "account",
  connections: [{ id: "c1", owner: "opencode", routeProviders: ["openai"], modelPrefix: null }],
  plan: { name: "pro", rateLimitTier: null, multiplier: null, provenance: "provider-observed", observedAt: new Date(now).toISOString() },
  windows: [{ id: "shared:primary", label: "5 hour", scope: "shared", durationSeconds: 18000, usedPercent: 40, remainingPercent: 60,
    resetAt: new Date(now + 3600_000).toISOString(), observedAt: new Date(now).toISOString(), state: "available" }],
  extraUsage: { enabled: null }, state: "available", observedAt: new Date(now).toISOString(),
  attemptedAt: new Date(now).toISOString(), nextAttemptAt: new Date(now + 86400_000).toISOString(), failures: 1, error: null,
}
writeFileSync(process.env.OPENCODE_ACCOUNT_USAGE_FILE, JSON.stringify({ schema: 1, updatedAt: new Date(now).toISOString(), accounts: [account], diagnostics: [] }))

const request = (index: number) => ({
  id: "request-" + index, sessionID: "ses_" + (index % 40), accountID: account.id,
  startedAt: now - 1000 * index - 1000, completedAt: now - 1000 * index - 500,
  route: { providerID: "openai", modelID: "verification-model" }, kind: "primary", state: "completed",
  tokens: { input: 100, cacheRead: 10, cacheWrite: 0, output: 20, reasoning: 5 },
  context: { tokens: 1000 + index, source: "provider", at: now - 1000 * index - 500 },
})
const receipt = { at: now, from: now - 86400_000, scannedFiles: 0, readFiles: 0, reconciledRequests: 0, rejectedCounters: 0, repeatedCounters: 0, malformedLines: 0, diagnostics: [] }
const write = (count: number) => persistLedger({ rows: ledgerRows(Array.from({ length: count }, (_, i) => request(i)) as any), observations: [], receipt })
const shape = (value: unknown): unknown => Array.isArray(value) ? [shape(value[0])]
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) : typeof value
const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return null } catch (error) { return error instanceof Error ? error.message : String(error) } }

write(50)
const small = await getUsageStatus({ allSessions: true })
write(5000)
const large = await getUsageStatus({ allSessions: true })
const requests: any = await getUsageDetail({ view: "requests", allSessions: true, offset: 0, limit: 5 })
const sessions: any = await getUsageDetail({ view: "sessions", allSessions: true, offset: 0, limit: 3 })
const timeline: any = await getUsageDetail({ view: "timeline", allSessions: true, offset: 0, limit: 4 })

console.log(JSON.stringify({
  small: { chars: JSON.stringify(small).length, records: small.collector.records, shape: shape(small) },
  large: { chars: JSON.stringify(large).length, records: large.collector.records, shape: shape(large), json: JSON.stringify(large),
    textChars: formatUsageStatus(large as any).length, requests: large.session.requests, input: large.session.tokens?.input,
    remainingPercent: large.accounts[0].windows[0].remainingPercent, pacingAccount: large.pacing.accounts[0]?.accountID },
  requests: { rows: requests.requests.length, total: requests.total, nextOffset: requests.nextOffset },
  sessions: { rows: sessions.sessions.length, total: sessions.total },
  timeline: { points: timeline.points.length, quotaSamples: timeline.quotaSamples.length, chars: JSON.stringify(timeline).length },
  refusals: {
    oversizedPage: await refused(() => getUsageDetail({ view: "requests", offset: 0, limit: 500 })),
    poolsWithoutAccount: await refused(() => getUsageDetail({ view: "pools" })),
    unknownView: await refused(() => getUsageDetail({ view: "everything" as any })),
  },
}))
