/**
 * Records what this terminal actually sends for each key, and what the host's own decoder makes of
 * it. Run it inside a real Windows Terminal window; it reads stdin exactly the way the OpenCode2
 * TUI does (bun raw mode) and runs the same @opentui/core parser the host runs.
 *
 * Phase 1 asks the terminal whether it supports the kitty keyboard protocol (CSI ?u) and records the
 * answer. Phase 2 records raw bytes. Phase 3 pushes kitty flags (CSI >5u) and records again, so a
 * terminal that does support the protocol is measured in both states.
 */
import { appendFileSync, writeFileSync } from "node:fs"

const out = process.argv[2]
if (!out) throw Error("usage: bun keyprobe.ts <output.jsonl> [seconds]")
const seconds = Number(process.argv[3] ?? 30)
writeFileSync(out, "")
const log = (record: unknown) => appendFileSync(out, JSON.stringify(record) + "\n")

let parseKeypress: ((data: Buffer | string) => any) | undefined
try {
  const core: any = await import("@opentui/core")
  parseKeypress = core.parseKeypress ?? core.default?.parseKeypress
} catch (error) {
  log({ note: "parseKeypress unavailable", error: String(error) })
}

let phase = "query"
process.stdin.setRawMode?.(true)
process.stdin.resume()
process.stdin.on("data", (chunk: Buffer) => {
  const hex = chunk.toString("hex")
  let parsed: unknown
  try {
    parsed = parseKeypress ? parseKeypress(chunk) : undefined
  } catch (error) {
    parsed = { error: String(error) }
  }
  log({ phase, at: new Date().toISOString(), hex, text: JSON.stringify(chunk.toString("latin1")), parsed })
  process.stdout.write(`\r\n[${phase}] ${hex}  ${JSON.stringify(parsed ?? null)}\r\n`)
})

process.stdout.write("KEYPROBE ready\r\n")
// Kitty keyboard support query, then a primary device attributes request as the terminating probe:
// every terminal answers DA1, so an answer with no CSI ?<flags>u before it means no kitty support.
process.stdout.write("\x1b[?u\x1b[c")

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
await wait(1500)
phase = "plain"
process.stdout.write("PHASE plain: press the keys now\r\n")
await wait(seconds * 1000)
phase = "kitty"
process.stdout.write("\x1b[>5u")
process.stdout.write("PHASE kitty: press the keys again\r\n")
await wait(seconds * 1000)
process.stdout.write("\x1b[<u")
log({ phase: "done" })
process.stdout.write("KEYPROBE done\r\n")
process.exit(0)
