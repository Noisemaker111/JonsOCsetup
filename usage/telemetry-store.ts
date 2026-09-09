import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { acquireLock } from "../quest/locking"
import type { RequestRecord } from "./telemetry"
export const TELEMETRY_FILE = process.env.OPENCODE_TELEMETRY_FILE ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "opencode", "requests.jsonl")
export function recordRequest(request: RequestRecord, file = TELEMETRY_FILE) {
  if (!request.id || !request.sessionID || !Number.isFinite(request.startedAt)) throw new Error("Invalid telemetry identity or timestamp")
  const lock = acquireLock(dirname(file), "request-telemetry")
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify({ version: 1, request }) + "\n", { encoding: "utf8", mode: 0o600 }) } finally { lock.release() }
}
export function readRequests(file = TELEMETRY_FILE): { records: RequestRecord[]; diagnostics: string[] } {
  if (!existsSync(file)) return { records: [], diagnostics: [] }
  const records = new Map<string, RequestRecord>(), diagnostics: string[] = []
  for (const [index,line] of readFileSync(file, "utf8").split("\n").entries()) {
    if (!line.trim()) continue
    try { const row = JSON.parse(line); if (row.version !== 1 || !row.request?.id || !row.request?.sessionID) throw new Error("invalid record"); records.set(row.request.id, row.request) }
    catch { diagnostics.push("Unreadable telemetry record at line " + (index + 1)) }
  }
  return { records: [...records.values()], diagnostics }
}
