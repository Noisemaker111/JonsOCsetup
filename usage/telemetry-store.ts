import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs"
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
function parseInto(text: string, records: Map<string, RequestRecord>, diagnostics: string[], lineOffset: number) {
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue
    try { const row = JSON.parse(line); if (row.version !== 1 || !row.request?.id || !row.request?.sessionID) throw new Error("invalid record"); records.set(row.request.id, row.request) }
    catch { diagnostics.push("Unreadable telemetry record at line " + (lineOffset + index + 1)) }
  }
}
export function readRequests(file = TELEMETRY_FILE): { records: RequestRecord[]; diagnostics: string[] } {
  if (!existsSync(file)) return { records: [], diagnostics: [] }
  const records = new Map<string, RequestRecord>(), diagnostics: string[] = []
  parseInto(readFileSync(file, "utf8"), records, diagnostics, 0)
  return { records: [...records.values()], diagnostics }
}
/**
 * The request log is append-only, so a collector never has to re-read what it already accounted
 * for. The cursor names the exact bytes consumed; a shorter file, a different inode, or a changed
 * prefix means the log was replaced and the next read starts over rather than inventing records.
 */
export type TelemetryCursor = { identity: string; offset: number; lines: number; anchor: string }
export function readRequestsSince(cursor: TelemetryCursor | null, file = TELEMETRY_FILE): { records: RequestRecord[]; diagnostics: string[]; cursor: TelemetryCursor; restarted: boolean; bytesRead: number } {
  const empty: TelemetryCursor = { identity: "", offset: 0, lines: 0, anchor: "" }
  if (!existsSync(file)) return { records: [], diagnostics: [], cursor: empty, restarted: false, bytesRead: 0 }
  const fd = openSync(file, "r")
  try {
    const stat = fstatSync(fd), identity = [stat.dev, stat.ino, stat.birthtimeMs].join(":")
    let from = cursor && cursor.identity === identity && cursor.offset <= stat.size ? cursor : null
    // The identity survives a copy but not a rewrite; the anchor catches a rewrite that kept the size.
    if (from && from.offset > 0) {
      const anchor = Buffer.from(from.anchor, "base64")
      const check = Buffer.alloc(anchor.length)
      if (!anchor.length || readSync(fd, check, 0, anchor.length, from.offset - anchor.length) !== anchor.length || !check.equals(anchor)) from = null
    }
    const restarted = !from
    const start = from?.offset ?? 0, lineOffset = from?.lines ?? 0
    const records = new Map<string, RequestRecord>(), diagnostics: string[] = []
    let offset = start, text = ""
    const buffer = Buffer.alloc(1024 * 1024)
    while (offset < stat.size) {
      const n = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - offset), offset)
      if (!n) break
      offset += n
      text += buffer.subarray(0, n).toString("utf8")
    }
    // A trailing partial line stays unconsumed; the writer appends whole records under a lock.
    const lastBreak = text.lastIndexOf("\n")
    const complete = lastBreak === -1 ? "" : text.slice(0, lastBreak + 1)
    const consumed = start + Buffer.byteLength(complete, "utf8")
    parseInto(complete, records, diagnostics, lineOffset)
    const lines = lineOffset + (complete ? complete.split("\n").length - 1 : 0)
    let anchor = ""
    if (consumed > 0) {
      const size = Math.min(256, consumed)
      const tail = Buffer.alloc(size)
      if (readSync(fd, tail, 0, size, consumed - size) === size) anchor = tail.toString("base64")
    }
    return { records: [...records.values()], diagnostics, cursor: { identity, offset: consumed, lines, anchor }, restarted, bytesRead: offset - start }
  } finally { closeSync(fd) }
}
export function telemetryFileSize(file = TELEMETRY_FILE): number {
  try { return statSync(file).size } catch { return 0 }
}
