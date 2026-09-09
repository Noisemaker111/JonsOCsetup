/** Real terminal acceptance for the same supervisor used by runtime:start. */
import { EmbeddedTerminalRenderable, KeyEvent } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Database } from "bun:sqlite"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir } from "node:os"
import { QuestStore } from "../quest/store"
import { projectIdentity } from "../quest/project"
import { freePort } from "./plugin-deploy"

const root = resolve(import.meta.dir, "..")
const run = join(root, ".visual-e2e", `runtime-${Date.now()}-${process.pid}`)
const project = join(run, "project")
mkdirSync(project, { recursive: true })
// Keep the host authentication store; query only this unique project's sessions.
const database = process.env.OPENCODE_DB ?? join(homedir(), ".local/share/opencode/opencode.db")
const marker = `Runtime acceptance ${Date.now()}`
new QuestStore(project).create({ id: "01j00000000000000000000999", title: marker, objective: "Isolated runtime verification fixture", kind: "investigation", project: projectIdentity(project) })
const env = { ...process.env, OPENCODE_QUEST_ROOT: project, OPENCODE_ORCHESTRATION_LEDGER: join(run, "orchestration.jsonl"), CLAUDE_CODE_BRIDGE_PORT: String(await freePort()) }
const setup = await createTestRenderer({ width: 140, height: 45 })
const terminal = new EmbeddedTerminalRenderable(setup.renderer, { id: "runtime", width: 140, height: 45, cols: 140, rows: 45, maxScrollback: 100000 })
setup.renderer.root.add(terminal)
terminal.focus()
const child = spawn("node", [join(root, "scripts/opencode-runtime.mjs"), "--json", "--cwd", project, "--cols", "140", "--rows", "45"], { cwd: root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
const events: any[] = []
let buffer = "", errors = "", exited = false
const send = (text: string) => child.stdin.write(JSON.stringify({ type: "write", data: Buffer.from(text).toString("base64") }) + "\n")
terminal.onData = (data) => { if (!exited) send(Buffer.from(data).toString("utf8")) }
child.stdout.setEncoding("utf8")
child.stdout.on("data", (chunk) => {
  buffer += chunk
  for (;;) {
    const nl = buffer.indexOf("\n"); if (nl < 0) break
    const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1)
    if (!line) continue
    const event = JSON.parse(line)
    if (event.type === "data") terminal.write(Buffer.from(event.data, "base64").toString("utf8"))
    else { events.push(event); console.log(`[runtime:verify] ${event.type} ${event.generation ?? event.message ?? ""}`) }
  }
})
child.stderr.on("data", (chunk) => errors += chunk)
child.once("error", (error) => { errors += String(error); exited = true })
child.once("exit", () => exited = true)
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
async function frame() { await setup.renderOnce(); return terminal.screen().text }
async function waitFor(label: string, predicate: () => boolean | Promise<boolean>, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    if (exited || events.some((x) => ["error", "restart-failed"].includes(x.type))) throw new Error(`${label}: runtime failed; ${errors}`)
    await sleep(150)
  }
  writeFileSync(join(run, "failure.txt"), await frame())
  throw new Error(`${label}: timed out; see ${join(run, "failure.txt")}`)
}
async function key(name: string, sequence: string) {
  send(Buffer.from(terminal.encodeKey(new KeyEvent({ name, ctrl: false, meta: false, shift: false, option: false, sequence, number: false, raw: sequence, eventType: "press", source: "raw" }))).toString("utf8"))
  await sleep(200)
}
async function command(text: string) {
  send(Buffer.from(terminal.encodePaste(new TextEncoder().encode(text))).toString("utf8"))
  await sleep(250); await key("return", "\r")
}
function loads(launch: any) {
  if (!launch || !existsSync(launch.receipt)) return []
  return readFileSync(launch.receipt, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
}
function assertLoads(launch: any) {
  const rows = loads(launch)
  return ["server", "tui:usage", "tui:quests"].every((component) => rows.some((row) => row.component === component && row.generation === launch.generation && row.sourceCommit === launch.sourceCommit && Number.isInteger(row.pid) && row.pid > 0))
}
const report: any = { ok: false, run, marker, checks: {} }
let db: Database | undefined
try {
  await waitFor("deployment and launch", () => events.some((x) => x.type === "launched"), 600000)
  await waitFor("plugin load receipts", () => assertLoads(events.find((x) => x.type === "launched")))
  const first = events.find((x) => x.type === "launched")
  report.initial = first
  const firstTuiPID = loads(first).find((row: any) => row.component === "tui:quests").pid
  report.checks.initialLoads = loads(first)
  await waitFor("Quest footer", async () => (await frame()).includes("Quests · project"))
  await command("/quests")
  await waitFor("real Quest board", async () => (await frame()).includes(marker))
  writeFileSync(join(run, "board-before.txt"), await frame())
  report.checks.board = true
  await key("escape", "\x1b")
  await command("Reply exactly RUNTIME_READY. Do not call tools, edit files, or create Quests.")
  await waitFor("real session created", () => {
    if (!existsSync(database)) return false
    db ??= new Database(database, { readonly: true })
    const row = db.query("select id from session_v2 where replace(directory,char(92),'/')=? and parent_id is null order by time_created desc limit 1").get(project.replaceAll("\\", "/")) as any
    if (row) { report.sessionID = row.id; return true }
    return false
  })
  await waitFor("session turn completed", () => {
    const row = db!.query("select data from session_message where session_id=? and type='assistant' order by seq desc limit 1").get(report.sessionID) as any
    return row && JSON.parse(row.data).time?.completed
  }, 90000)
  writeFileSync(join(run, "session-before.txt"), await frame())
  await command("/restart")
  await waitFor("actual slash restart", () => events.some((x) => x.type === "restarted"), 600000)
  const second = events.filter((x) => x.type === "launched").at(-1)
  if (second.sessionID !== report.sessionID) throw new Error("restart did not replace the exact child and preserve the originating session")
  await waitFor("restarted plugin receipts", () => assertLoads(second))
  if (loads(second).find((row: any) => row.component === "tui:quests").pid === firstTuiPID) throw new Error("restart did not replace the TUI process")
  await waitFor("restarted footer and session", async () => { const text = await frame(); return text.includes("Quests · project") && text.includes("RUNTIME_READY") })
  await command("/quests")
  await waitFor("board after restart", async () => (await frame()).includes(marker))
  writeFileSync(join(run, "board-after.txt"), await frame())
  const pointer = JSON.parse(readFileSync(join(root, "plugin-activation.json"), "utf8"))
  if (second.generation !== pointer.activeGeneration) throw new Error("restarted host is not on active generation")
  report.restarted = second
  report.checks.restartedLoads = loads(second)
  report.checks.sessionPreserved = true
  report.checks.activeGeneration = true
  report.ok = true
} catch (error) {
  report.error = String(error)
  writeFileSync(join(run, "failure.txt"), await frame())
} finally {
  terminal.onData = undefined
  if (!exited) child.stdin.write(JSON.stringify({ type: "stop" }) + "\n")
  for (let i = 0; i < 60 && !exited; i++) await sleep(100)
  if (!exited) { child.kill(); report.ok = false; report.cleanupError = "supervisor did not stop in time" }
  db?.close()
  terminal.destroy(); setup.renderer.destroy()
  report.events = events; report.stderr = errors
  writeFileSync(join(run, "report.json"), JSON.stringify(report, null, 2))
  writeFileSync(join(root, "run/runtime-latest.json"), JSON.stringify({ ok: report.ok, report: join(run, "report.json") }, null, 2))
}
console.log(JSON.stringify({ ok: report.ok, report: join(run, "report.json"), error: report.error }, null, 2))
process.exit(report.ok ? 0 : 1)
