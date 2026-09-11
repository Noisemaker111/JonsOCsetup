/**
 * Drive the Quest Giver the way the user does, and report what the turn cost.
 *
 * The low-level driver (drive-opencode.ts) speaks keystrokes and captures. Everything above it
 * was being retyped per session: guessing when the composer is ready, sleeping a fixed number of
 * seconds and hoping, grepping a capture truncated to fewer columns than the error needed, and
 * approving permission prompts by hand. Each of those silently yields a wrong answer instead of a
 * failure, so they belong here once rather than in a prompt.
 *
 * Waits are on observed state -- the quest ledger and the session database -- never on a sleep.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, appendFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { driveSession, conditionMet, finishedBaseline, knownRuns, inFlightWorkers, type QuestRecord } from "./drive-isolation"

type Condition = "reply" | "quest-step-done" | "worker-completed"
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
const flag = (name: string) => process.argv.includes(name)

if (flag("--help") || (!option("--ask") && !flag("--test-change"))) {
  console.log(`bun scripts/drive-giver.ts --ask "<prompt>" [options]

  --ask <text>         What to say to the Quest Giver. Required unless --test-change.
  --test-change        Run a real edit through the normal flow, then remove every trace of it.
  --test-file <path>   File the test change edits, relative to config/. Default docs/scratch.md
  --release <root>     Release to drive. Defaults to the activated dev channel.
  --model <route>      Exact route. Defaults to the activated channel's recorded model.
  --await <condition>  reply | quest-step-done | worker-completed. Default reply.
  --timeout <seconds>  Bound on the awaited condition. Default 900.
  --out <dir>          Evidence directory. Defaults to run/giver-<timestamp>.
  --keep               Keep the evidence directory and any worker worktree.
  --deny-permissions   Do not auto-approve permission prompts; capture and fail instead.
  --allow-expensive    Permit a route over $1/Mtok input; only for checks about that model.
  --worker-grace <s>   How long to hold the host open for workers this run started. Default 1800.
  --no-worker-grace    Stop as soon as the wait ends, stranding any worker still running.
  --live               Drive the real ledger and session database instead of a sandbox. Use this
                       when another harness wants the Quest Giver to do actual work, not a check.
                       Attaches to the registered Quest Giver session, because a new one cannot
                       dispatch: the giver is a single registered session by design.
  --session <ses_…>    Attach to this conversation instead of the registered giver.
  --new-session        Start a fresh conversation under --live. It can talk, not dispatch.`)
  process.exit(0)
}

/**
 * A drive is a check by default, so the host gets its own database and ledger and the real data
 * cannot be touched. --live keeps the host's real homes instead, for the other case: another
 * harness asking the Quest Giver to do actual work on the actual board.
 *
 * --test-change writes an edit and then deletes the worker worktrees its quests name. On the real
 * ledger those worktrees are other sessions' work, so the two never combine. This is checked before
 * anything is resolved, because an incompatible pair of flags is wrong on a machine with no release
 * activated just as surely as on one with a release running.
 */
const live = flag("--live")

// A live drive opens the registered Quest Giver, because a new session cannot dispatch; see
// driveSession in scripts/drive-isolation.ts for why.
const giverRegistry = join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".opencode", ".quest-runtime", "user-giver.json")
const registered = (() => { try { return JSON.parse(readFileSync(giverRegistry, "utf8")) } catch { return undefined } })()
const attach = driveSession({ live, pinned: option("--session"), newSession: flag("--new-session"), registered })
if (live && flag("--test-change")) throw new Error("--test-change writes and then deletes; it never runs against the real ledger. Drop --live or drop --test-change.")

const started = Date.now()
const log = (...parts: unknown[]) => console.error(...parts)
const configRoot = resolve(import.meta.dir, "..")
// Run from a worktree and the script sits beside a checkout with no channel state, so fall
// back to the installed config directory that actually owns the activated release.
const installedConfig = process.env.OPENCODE_CONFIG_DIR ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".config", "opencode")
const channelFile = [join(configRoot, ".channels", "dev.json"), join(installedConfig, ".channels", "dev.json")].find(existsSync) ?? join(installedConfig, ".channels", "dev.json")
const channel = existsSync(channelFile) ? JSON.parse(readFileSync(channelFile, "utf8")) : undefined
const release = resolve(option("--release") ?? channel?.root ?? "")
if (!release || !existsSync(release)) throw new Error("No release to drive; activate a dev channel or pass --release")
const model = option("--model") ?? channel?.model
if (!model) throw new Error("No model to drive with; pass --model or activate a channel that records one")
const cwd = resolve(option("--cwd") ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Projects", "opencode-hub"))
const out = resolve(option("--out") ?? join(configRoot, "run", "giver-" + started))
const condition = (option("--await") ?? (flag("--test-change") ? "quest-step-done" : "reply")) as Condition
const budgetMs = Number(option("--timeout") ?? 900) * 1000

/**
 * Verification runs on the cheapest capable route. Measured over 1,203 sessions, 37% of all spend
 * went through 0.16% of the tokens, and most of that had the same model sitting on a subscription
 * lane. A throwaway check is the least defensible place to spend that, so an expensive route has to
 * be asked for rather than arrived at.
 */
const EXPENSIVE_INPUT_COST_PER_MTOK = 1
async function modelInputCost(route: string): Promise<number | undefined> {
  const [providerID, rest] = [route.slice(0, route.indexOf("/")), route.slice(route.indexOf("/") + 1)]
  const modelID = rest.split("#")[0]
  try {
    const response = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return undefined
    const catalog: any = await response.json()
    const cost = catalog?.[providerID]?.models?.[modelID]?.cost?.input
    return typeof cost === "number" ? cost : undefined
  } catch { return undefined }
}
if (!flag("--allow-expensive")) {
  const cost = await modelInputCost(model)
  if (cost !== undefined && cost > EXPENSIVE_INPUT_COST_PER_MTOK) {
    throw new Error(`${model} costs $${cost}/Mtok input. Verification runs on the cheapest capable route; ` +
      `pass --allow-expensive only when the check is about this model specifically.`)
  }
}

const marker = "OPENCODE_TEST_CHANGE_" + started
const testFile = option("--test-file") ?? "docs/scratch.md"
const ask = option("--ask") ?? `Create one Quest for this project and dispatch ONE editing worker on ${model}. Task: append exactly one line to config/${testFile} reading: ${marker}. Create the file if it does not exist. That is the entire job. One Quest, one step, one worker.`

// The driver insists on creating the evidence directory itself so an earlier run cannot be
// overwritten; wait for its command channel rather than making the directory here.
const commands = join(out, "commands.jsonl")
const send = (value: unknown) => appendFileSync(commands, JSON.stringify(value) + "\n")

// Isolation is why a drive could not do real work: asked to dispatch a step of an existing Quest,
// the giver opened onto an empty ledger, said the Quest did not exist, and created a duplicate in
// the sandbox instead. The host still starts its own session either way, so a live drive never
// types into a conversation already open. See scripts/drive-isolation.ts for what each mode sets.
// The channel's model is a default for a conversation this drive creates, never something to
// impose on one it opens: forwarding it rewrote the registered giver's lane. Only a --model the
// caller typed reaches an attached session.
const chosenModel = option("--model")
const child = spawn("bun", [join(release, "scripts", "drive-opencode.ts"), "--config-root", release, "--cwd", cwd,
  ...(attach ? (chosenModel ? ["--model", chosenModel] : []) : ["--model", model]),
  "--out", out, "--cols", "200", "--rows", "60",
  ...(live ? ["--live"] : []), ...(attach ? ["--session", attach] : [])], { cwd: release, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
let childExit: number | undefined
const driverLog: string[] = []
child.on("exit", code => { childExit = code ?? 0 })
child.stdout.on("data", d => driverLog.push(String(d)))
child.stderr.on("data", d => driverLog.push(String(d)))

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until<T>(what: string, check: () => T | undefined | false, ms: number): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    if (childExit !== undefined) throw new Error(`Driver exited (${childExit}) waiting for ${what}: ${driverLog.join("").slice(-800)}`)
    const value = check()
    if (value) return value as T
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await sleep(2000)
  }
}

/** Captures are the only view of the terminal, so read the whole frame, never a slice of it. */
let frames = 0
async function capture(name?: string): Promise<string> {
  const id = name ?? "frame-" + ++frames
  const file = join(out, id + ".txt")
  if (existsSync(file)) rmSync(file)
  send({ action: "capture", name: id })
  await until("capture " + id, () => existsSync(file), 90000)
  return readFileSync(file, "utf8")
}

const home = process.env.USERPROFILE ?? process.env.HOME ?? "."
// Watch the ledger the host is actually writing to; in live mode that is questRoot()'s default.
const questDir = live ? join(home, ".opencode", "quests") : join(out, "quests", ".opencode", "quests")
// The real ledger carries every Quest on the board; only the ones this run touched are evidence
// of what this run did, and mtime is what the store updates when it writes one.
const allQuests = () => existsSync(questDir)
  ? readdirSync(questDir).filter(f => f.endsWith(".md")).map(f => readFileSync(join(questDir, f), "utf8"))
  : []
// The report names what this run touched; mtime is what the store moves when it writes one. The
// baseline and the wait conditions read everything instead -- a Quest whose file is old is exactly
// the one whose long-finished steps would look new the moment the giver writes to it.
const quests = () => !live ? allQuests() : existsSync(questDir)
  ? readdirSync(questDir).filter(f => f.endsWith(".md"))
      .filter(f => statSync(join(questDir, f)).mtimeMs >= started)
      .map(f => readFileSync(join(questDir, f), "utf8"))
  : []
const field = (text: string, key: string) => new RegExp(`^${key}: (.*)$`, "m").exec(text)?.[1]
const parse = (text: string, key: string) => { try { return JSON.parse(field(text, key) ?? "null") } catch { return null } }
function sessionRows() {
  const file = live ? join(home, ".local", "share", "opencode", "opencode.db") : join(out, "host.db")
  if (!existsSync(file)) return [] as any[]
  try {
    const db = new Database(file, { readonly: true })
    // The sandbox database holds only this run. The real one holds every session ever, so the cost
    // and token figures below would be a lifetime bill reported as a turn. Scope live reads to
    // sessions this run created.
    // Sessions this run created, plus the conversation it attached to -- which was created long
    // before and would otherwise be invisible, taking the giver's own reply with it.
    const columns = "id,title,agent,cost,tokens_input,tokens_output,idle_outcome,time_updated"
    const rows = live
      ? db.query(`select ${columns} from session_v2 where time_created >= ? or id = ?`).all(started, attach ?? "") as any[]
      : db.query(`select ${columns} from session_v2`).all() as any[]
    db.close(); return rows
  } catch { return [] }
}

await until("the driver to open its command channel", () => existsSync(commands), 180000)
/**
 * A live drive lands in the giver conversation that already exists, and that screen has no empty
 * composer placeholder -- it carries the giver banner above the composer instead. Waiting only for
 * "Ask anything" timed every live drive out on a composer that was ready the whole time.
 *
 * Until that session's location finishes resolving, the composer is replaced by the recovery panel
 * rather than merely disabled, and keystrokes go to its button. Booting location services at a
 * directory with many worktrees took 17s here, so this is a wait, not a failure.
 */
const composerReady = (frame: string) =>
  !frame.includes("Session location unavailable") && (frame.includes("Ask anything") || frame.includes("YOUR QUEST GIVER"))
for (let attempt = 0; ; attempt++) {
  if (composerReady(await capture("ready-" + attempt))) break
  if (attempt >= 29) throw new Error("Composer never became ready; evidence in " + out)
  await sleep(4000)
}
log("composer ready")

send({ action: "paste", text: ask })
await sleep(1500)
// A long paste collapses to a "[Pasted N lines]" chip, so accept either form as landed.
const typed = await capture("typed")
if (!typed.includes("[Pasted") && !typed.includes(ask.slice(0, 40))) throw new Error("Paste never reached the composer; evidence in " + out)
send({ action: "key", name: "return" })
const promptAt = Date.now()

/**
 * What counts as this run's work finishing.
 *
 * In a sandbox every Quest is new, so "any completed worker session" could only mean this run's. On
 * the real board it means "any worker that ever succeeded" — and it fired immediately. A live drive
 * asked to dispatch a step of Quest 7f2d0f45 reported ok after 49s with zero tokens and the step
 * still pending, because a session from 2026-09-06 on that same Quest was marked completed and the
 * file's mtime had moved when the giver merely read it.
 *
 * So a condition has to name something that did not exist when the prompt was sent. Records carry
 * `updatedAt`; anything stamped before the prompt is somebody else's finished work.
 */
const records = (): QuestRecord[] => allQuests().map(q => ({
  id: field(q, "id")?.replace(/"/g, ""),
  stages: parse(q, "stages") ?? [],
  sessions: parse(q, "sessions") ?? [],
}))
// What was already finished when the prompt was sent. Anything finished that is not in here is work
// this run caused; see finishedBaseline in scripts/drive-isolation.ts for the two wrong answers
// this replaces.
const baseline = finishedBaseline(records())
// Every run the board already carried, so a worker this drive caused is recognisable later.
const runsBefore = knownRuns(records())
const satisfied = () => {
  if (condition === "reply") return sessionRows().some(s => s.agent === "quest-giver" && (s.tokens_output ?? 0) > 0 && s.idle_outcome && (!live || (s.time_updated ?? 0) >= promptAt))
  return conditionMet({ condition, live, baseline, quests: records() })
}



let approvals = 0, done = false
const deadline = Date.now() + budgetMs
while (Date.now() < deadline && childExit === undefined) {
  if (satisfied()) { done = true; break }
  const frame = await capture()
  if (frame.includes("Permission required")) {
    if (flag("--deny-permissions")) throw new Error("Permission prompt raised; frame kept in " + out)
    // Approving a child path does not cover its parent, so these recur mid-run. Take the default
    // action instead of stalling the whole run behind a human keystroke.
    send({ action: "key", name: "return" }); approvals++
    log("approved permission prompt " + approvals)
  }
  await sleep(5000)
}
if (!done) await capture("failure")

const finished = Date.now()
const rows = sessionRows()
const giver = rows.find(r => r.agent === "quest-giver")
const workers = rows.filter(r => r.agent !== "quest-giver")
const worktrees = quests().flatMap(q => (parse(q, "sessions") ?? []).map((s: any) => s?.scope?.worktree).filter((p: any): p is string => typeof p === "string" && p.includes("worktrees")))

const report: Record<string, unknown> = {
  ok: done,
  condition,
  generation: channel?.generation,
  model,
  wallSeconds: +((finished - started) / 1000).toFixed(1),
  promptToConditionSeconds: +((finished - promptAt) / 1000).toFixed(1),
  startupSeconds: +((promptAt - started) / 1000).toFixed(1),
  permissionPromptsApproved: approvals,
  cost: {
    total: +rows.reduce((n, r) => n + (r.cost ?? 0), 0).toFixed(4),
    giver: +(giver?.cost ?? 0).toFixed(4),
    workers: +workers.reduce((n, r) => n + (r.cost ?? 0), 0).toFixed(4),
  },
  tokens: {
    giverIn: giver?.tokens_input ?? 0, giverOut: giver?.tokens_output ?? 0,
    workerIn: workers.reduce((n, r) => n + (r.tokens_input ?? 0), 0),
    workerOut: workers.reduce((n, r) => n + (r.tokens_output ?? 0), 0),
  },
  sessions: rows.map(r => ({ agent: r.agent, cost: +(r.cost ?? 0).toFixed(4), in: r.tokens_input, out: r.tokens_output, outcome: r.idle_outcome })),
  quests: quests().map(q => ({ title: field(q, "title")?.replace(/"/g, ""), state: field(q, "state")?.replace(/"/g, ""), steps: (parse(q, "stages") ?? []).map((s: any) => `${s.id}:${s.status}`) })),
  evidence: out,
}

/**
 * Do not stop while work this drive caused is still running.
 *
 * The host takes its workers with it, so an unconditional stop strands whatever the giver had just
 * launched. That is not theoretical: two workers on the OVH VPS Quest were killed this way, one of
 * them after reading 502,165 input tokens of real investigation, and none of it reached the step.
 *
 * The wait is bounded and the bound is reported. A drive that gives up still says which workers it
 * left running rather than stopping quietly and leaving a step reading "working" over nothing.
 */
const workerGraceMs = Number(option("--worker-grace") ?? 1800) * 1000
let stranded: ReturnType<typeof inFlightWorkers> = []
if (!flag("--no-worker-grace")) {
  const graceUntil = Date.now() + workerGraceMs
  for (;;) {
    stranded = inFlightWorkers({ quests: records(), known: runsBefore })
    if (!stranded.length || childExit !== undefined) break
    if (Date.now() > graceUntil) {
      log(`giving up on ${stranded.length} worker(s) still running after ${workerGraceMs / 1000}s: ` +
        stranded.map(w => `${w.runID} (${w.state})`).join(", "))
      break
    }
    log(`holding the host open for ${stranded.length} worker(s) this run started: ` + stranded.map(w => `${w.runID} (${w.state})`).join(", "))
    await sleep(10000)
  }
}
report.workersStillRunning = stranded

send({ action: "stop" })
await until("driver shutdown", () => childExit !== undefined, 60000).catch(() => undefined)

if (flag("--test-change") && !flag("--keep")) {
  // The edit was real and lives in a real worker worktree, so retiring those worktrees is what
  // makes the run leave nothing behind. Only worktrees this run's quests recorded are touched.
  const removed: string[] = []
  for (const path of [...new Set(worktrees)]) {
    if (!existsSync(path)) continue
    const result = spawnSync("git", ["-C", configRoot, "worktree", "remove", "--force", path], { encoding: "utf8", windowsHide: true, timeout: 60000 })
    if (result.status === 0) removed.push(path)
  }
  spawnSync("git", ["-C", configRoot, "worktree", "prune"], { windowsHide: true, timeout: 60000 })
  report.testChange = { marker, file: "config/" + testFile, worktreesRemoved: removed.length, paths: removed }
}
// Evidence is the only record of what the run actually did, so it survives unless this was a
// test change that succeeded and is meant to leave nothing behind.
if (flag("--test-change") && !flag("--keep") && done) rmSync(out, { recursive: true, force: true })

console.log(JSON.stringify(report, null, 2))
if (!done) process.exit(1)
