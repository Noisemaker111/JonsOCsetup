import {git as cleanupGit} from '../quest/cleanup-git.mjs'
import {useRelease,releaseUse,retireReleases} from './release-retirement.mjs'
import { inspectHostExecutable } from '../project-router/executable.mjs'
/** Managed OpenCode2 terminal. Only this supervisor's exact standalone child is stopped. */
import JSON5 from "json5"
import * as pty from "node-pty"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync, readdirSync, symlinkSync, copyFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { generationRoot, reviewedAgentConfig } from "./runtime-contract.mjs"

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const option = (name) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1] }
const root = resolve(option("--config-root") ?? (basename(dirname(sourceRoot)) === "generations" ? resolve(sourceRoot,"../..") : sourceRoot))
// Automation asks for the relayed transcript with --json; every other launch is a person at a
// terminal, and the host gets that terminal itself instead of a second emulator inside it.
const json = process.argv.includes("--json")
const attached = !json
const cwd = resolve(option("--cwd") ?? process.cwd())
const releaseLease=useRelease(root)
const control = join(root, "run", "runtime", `launch-${Date.now()}-${process.pid}`)
mkdirSync(control, { recursive: true })
const token = randomBytes(24).toString("hex")
const hostIdentity = inspectHostExecutable()
const exe = hostIdentity.executable
let terminal, ending = false, restarting = false, sequence = 0, sessionID = option("--session")
const emit = (event) => {
  if (event.type !== "data") appendFileSync(join(control, "events.jsonl"), JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n")
  if (json) process.stdout.write(JSON.stringify(event) + "\n")
  else if (event.type === "data") process.stdout.write(Buffer.from(event.data, "base64"))
  else process.stderr.write(`[runtime] ${event.type}: ${event.generation ?? event.message ?? ""}\n`)
}
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))
async function prepare() {
  emit({ type: "preparing" })
  const pointer = readJson(join(root, "plugin-activation.json"))
  if (pointer.evidence?.ok !== true) throw new Error("active generation has not passed runtime validation")
  const selected = generationRoot(root, pointer.activeGeneration)
  if (readJson(join(selected, ".deployment-source.json")).commit !== pointer.evidence.sourceCommit) throw new Error("selected generation source differs from its validation receipt")
  appendFileSync(join(control, "prepare.log"), JSON.stringify({generation:pointer.activeGeneration,sourceCommit:pointer.evidence.sourceCommit}) + "\n")
  return pointer
}

async function stopChild() {
  const prior = terminal
  if (!prior) return
  terminal = undefined
  if (prior.exited) return
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error("owned standalone child did not stop")), 8000)
    prior.onExit(() => { clearTimeout(timer); done() })
    prior.kill()
  })
}
/** Attached: the host inherits this console, so it reads its own size, resize and TERM, and
 *  paints straight to the terminal. Relayed: a private pty whose output becomes transcript
 *  events, which is what the automation harness drives. Both get the same prepared launch. */
function startChild(args, env) {
  if (!attached) {
    const term = pty.spawn(exe, args, { name: "xterm-256color", cols: Number(option("--cols") ?? process.stdout.columns ?? 120), rows: Number(option("--rows") ?? process.stdout.rows ?? 40), cwd, env })
    return { pid: term.pid, exited: false, onData: (handle) => term.onData(handle), onExit: (handle) => term.onExit(({ exitCode }) => { handle(exitCode) }), write: (data) => term.write(data), kill: () => term.kill() }
  }
  const host = spawn(exe, args, { cwd, env, stdio: "inherit", windowsHide: false })
  host.on("error", (error) => { emit({ type: "error", message: String(error) }); void finish(1) })
  return { pid: host.pid, exited: false, onData: () => {}, onExit: (handle) => host.on("exit", (code) => handle(code ?? 0)), write: () => {}, kill: () => host.kill() }
}
function launch(pointer) {
  const generation = pointer.activeGeneration
  const receipt = join(control, `loads-${++sequence}.jsonl`)
  const args = ["--standalone", "--log-level", "error", ...(process.argv.includes("--auto") ? ["--auto"] : []), ...(sessionID ? ["--session", sessionID] : []), cwd]
  const reviewed = JSON.parse(reviewedAgentConfig(root, generation))
  const agent = option("--agent") ?? reviewed.default_agent
  if (reviewed.agents[agent]?.hidden || reviewed.agents[agent]?.mode === "subagent") throw new Error("Choose a visible primary agent for an interactive terminal: " + agent)
  if (option("--agent")) reviewed.default_agent = agent
  if (option("--model")) reviewed.agents[agent] = { ...reviewed.agents[agent], model: option("--model") }
  // Give each launch its own full config document; source and immutable
  // generations stay untouched. A hidden subagent cannot be a TUI default.
  const launchRoot = join(control, "config-" + sequence)
  mkdirSync(launchRoot)
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if ([".git", ".channels", ".worktrees", ".claude", "test", "run", ".visual-e2e", ".candidates", "opencode.jsonc"].includes(entry.name)) continue
    const from = join(root, entry.name), to = join(launchRoot, entry.name)
    if (entry.isDirectory() || entry.isSymbolicLink()) symlinkSync(from, to, "junction")
    else copyFileSync(from, to)
  }
  const fullConfig = { ...JSON5.parse(readFileSync(join(generationRoot(root, generation), "opencode.jsonc"), "utf8")), ...reviewed }
  writeFileSync(join(launchRoot, "opencode.jsonc"), JSON.stringify(fullConfig))
  // An isolated runtime starts with an empty credential store, so a launched host cannot
  // reach any provider it must authenticate: every prompt is dropped with no error and only
  // free or locally proxied models appear to work. Supply the keys the user already authorized.
  const authorizedKeys = () => {
    const variables = { "opencode-go": "OPENCODE_API_KEY", openrouter: "OPENROUTER_API_KEY" }
    const supplied = {}
    try {
      const auth = JSON.parse(readFileSync(join(process.env.OPENCODE_DATA ?? join(homedir(), ".local", "share", "opencode"), "auth.json"), "utf8"))
      for (const [provider, variable] of Object.entries(variables)) {
        const entry = auth[provider]
        if (entry?.type === "api" && typeof entry.key === "string" && entry.key && !process.env[variable]) supplied[variable] = entry.key
      }
    } catch {}
    return supplied
  }
  const env = Object.fromEntries(Object.entries({ ...process.env, OPENCODE_CONFIG_DIR: launchRoot, OPENCODE_CONFIG_CONTENT: JSON.stringify(reviewed), OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_PLUGIN_GENERATION: generation, OPENCODE_RUNTIME_CONTROL: control, OPENCODE_RUNTIME_TOKEN: token, OPENCODE_RUNTIME_RECEIPT: receipt, ...authorizedKeys() }).filter(([, value]) => typeof value === "string"))
  const child = startChild(args, env)
  terminal = child
  writeFileSync(join(control, "owner.json"), JSON.stringify({ releaseLease, mode: attached ? "attached" : "relayed", pid: process.pid, childPID: child.pid || undefined, generation, sessionID, cwd, sequence }))
  emit({ type: "launched", mode: attached ? "attached" : "relayed", configRoot: launchRoot, host: hostIdentity, generation, sourceCommit: pointer.evidence.sourceCommit, pid: child.pid || undefined, sessionID, sequence, receipt, control })
  child.onData((data) => emit({ type: "data", data: Buffer.from(data).toString("base64") }))
  child.onExit((exitCode) => {
    child.exited = true
    emit({ type: "child-exit", pid: child.pid, exitCode })
    if (terminal === child) terminal = undefined
    if (!restarting && !ending) finish(exitCode)
  })
}
async function restart(request) {
  if (request.token !== token || request.action !== "restart") throw new Error("invalid restart request")
  if (request.sessionID !== undefined && !/^ses_[A-Za-z0-9_-]+$/.test(request.sessionID)) throw new Error("invalid restart session")
  // Validate/deploy while the old terminal is still alive. A failed gate leaves it intact.
  const pointer = await prepare()
  sessionID = request.sessionID ?? sessionID
  await stopChild()
  launch(pointer)
  emit({ type: "restarted", generation: pointer.activeGeneration, sessionID, sequence })
}
async function finish(code = 0) {
  if (ending) return
  ending = true
  clearInterval(watcher)
  try { await stopChild() } catch (error) { emit({ type: "error", message: String(error) }); code = 1 }
  if(!terminal){releaseUse(releaseLease);try{const repository=dirname(resolve(root,cleanupGit(root,['rev-parse','--git-common-dir'])));retireReleases(repository)}catch(error){emit({type:'cleanup-retained',reason:String(error)})}}
  process.exit(code)
}
const watcher = setInterval(async () => {
  const path = join(control, "restart.json")
  if (restarting || ending || !existsSync(path)) return
  restarting = true
  try { const request = readJson(path); unlinkSync(path); await restart(request) }
  catch (error) { emit({ type: "restart-failed", message: String(error) }) }
  finally { restarting = false }
}, 100)
// Attached, the console interrupt belongs to the host: the TUI treats ctrl+c as one of its own
// keys, and a supervisor that exited on it would close the conversation out from under it.
process.on("SIGINT", () => { if (!attached) void finish() })
process.on("SIGTERM", () => void finish())
if (json) {
  let buffer = ""
  process.stdin.on("end", () => void finish())
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => {
    buffer += chunk
    for (;;) {
      const nl = buffer.indexOf("\n"); if (nl < 0) break
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1)
      try { const input = JSON.parse(line); if (input.type === "write") terminal?.write(Buffer.from(input.data, "base64").toString("utf8")); else if (input.type === "stop") void finish() }
      catch (error) { emit({ type: "error", message: String(error) }) }
    }
  })
} else if (!process.stdin.isTTY) throw new Error("runtime:start requires a terminal; use runtime:verify for headless tests")
// Attached leaves stdin alone on purpose. Reading it here would take the keystrokes, the raw
// mode and the resize notifications that the host must own to draw at the real geometry.
try { launch(await prepare()) } catch (error) { emit({ type: "error", message: String(error) }); await finish(1) }
