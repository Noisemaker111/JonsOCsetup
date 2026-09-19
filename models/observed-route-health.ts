/**
 * Route health taken from the requests that were actually made, not only from a probe someone ran.
 *
 * `unusableRoutes()` reads `route-health.json`, which only `scripts/route-preflight.ts` writes and
 * only when a person runs it. On 2026-09-16 that file was four days old, so its six-hour bound
 * discarded it entirely — including eight routes it had already recorded as unusable. Meanwhile
 * `cliproxyapi/gpt-5.6-luna#max` failed 53 requests across 17 sessions between 00:04 and 10:05,
 * every one of them recorded in the telemetry ledger, and none of it reached selection. The router
 * kept offering a route that had never once answered.
 *
 * The outcome of a request is the strongest evidence there is about a route, and it costs nothing
 * to collect: it is already written. A success clears the record on its own, so a route recovers
 * without anyone editing a file.
 */
import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs"
import type { RequestRecord } from "../usage/telemetry"

export type ObservedFailure = { model: string; failures: number; lastAt: number; reason: string }

/** The ledger is append-only and megabytes long; recent health only needs its tail. */
export function recentRequests(file: string, bytes = 2 * 1024 * 1024): RequestRecord[] {
  if (!existsSync(file)) return []
  const size = statSync(file).size, start = Math.max(0, size - bytes)
  const handle = openSync(file, "r")
  let text: string
  try { const buffer = Buffer.alloc(size - start); readSync(handle, buffer, 0, buffer.length, start); text = buffer.toString("utf8") }
  finally { closeSync(handle) }
  // A tail can begin mid-line; that partial record is dropped rather than guessed at.
  const lines = text.split("\n"); if (start > 0) lines.shift()
  const records: RequestRecord[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try { const row = JSON.parse(line); if (row?.version === 1 && row.request?.id) records.push(row.request) } catch {}
  }
  return records
}

/**
 * Models whose most recent requests all failed. Keyed by provider/model because that is what
 * actually broke: a derived candidate on the same model is the same broken call under a new name.
 */
export function failingModels(records: RequestRecord[], now: number, options: { windowMs?: number; minimum?: number } = {}) {
  const windowMs = options.windowMs ?? 6 * 60 * 60 * 1000, minimum = options.minimum ?? 3
  // Each request is written twice, running then terminal; the later row is the outcome.
  const latest = new Map<string, RequestRecord>()
  for (const record of records) if (record?.id) latest.set(record.id, record)
  const byModel = new Map<string, RequestRecord[]>()
  for (const record of latest.values()) {
    // An interrupt says the turn ended, not that the route refused; it is neither failure nor success.
    if (record.state !== "failed" && record.state !== "completed") continue
    if (!Number.isFinite(record.startedAt) || now - record.startedAt > windowMs) continue
    const model = `${record.route?.providerID}/${record.route?.modelID}`
    if (!record.route?.providerID || !record.route?.modelID) continue
    byModel.set(model, [...(byModel.get(model) ?? []), record])
  }
  const failing = new Map<string, ObservedFailure>()
  for (const [model, rows] of byModel) {
    rows.sort((a, b) => b.startedAt - a.startedAt)
    let failures = 0
    for (const row of rows) { if (row.state !== "failed") break; failures++ }
    if (failures < minimum) continue
    const lastAt = rows[0].startedAt
    failing.set(model, { model, failures, lastAt, reason: `${failures} most recent requests on this model failed, the last at ${new Date(lastAt).toISOString()}` })
  }
  return failing
}
