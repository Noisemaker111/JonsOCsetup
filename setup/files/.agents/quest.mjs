/**
 * The Quest board, callable from any harness.
 *
 * The ledger under ~/.opencode is one board shared by OpenCode, Claude Code and Codex, but only
 * OpenCode could reach it: everyone else would have had to import QuestStore out of an activated
 * release whose path changes on every activation. That friction is why intent kept landing in chat,
 * and chat does not survive a session ending or compacting.
 *
 * This gives any harness the whole loop, not just filing: list, read, claim a step, report progress
 * and evidence, release or finish it, and see who is holding what right now.
 *
 *   bun ~/.agents/quest.mjs help
 *
 * Three things it must get right, and how:
 *
 *  - Runs under bun. The store is TypeScript with parameter properties, which node cannot strip.
 *  - Resolves the activated release itself from ~/.config/opencode/.channels/dev.json, because that
 *    path changes on every activation. OPENCODE_QUEST_RELEASE overrides it; no release, clear error.
 *  - Writes through the real QuestStore and the real agent API, so a claim filed here is the same
 *    object the OpenCode Quest Giver reads. There is no second format and no second ledger.
 *
 * Claiming is the part that has to be safe, because two harnesses will call this at the same time.
 * A step claim is a `session-claimed` event on a callID derived from the step id, appended with the
 * `expectedRevision` the claimer read. QuestStore re-reads and compares that revision inside its
 * per-quest file lock, so of two simultaneous claimers exactly one commits; the other's revision is
 * stale, it re-reads, sees the holder, and exits 3 instead of silently working the same step.
 *
 * Output is deliberately terse — an agent reads it, and every token printed is paid for again on
 * every later turn of that agent's session. `--json` gives the same data machine-shaped.
 *
 * Exit codes: 0 done, 1 error, 2 usage, 3 contended (someone else holds that step).
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir, hostname } from "node:os"
import { pathToFileURL } from "node:url"

const EXIT = { ok: 0, error: 1, usage: 2, held: 3 }
const SOURCE = `quest-cli:${process.pid}`
/** Session states that mean somebody is still on the step. Anything else frees it. */
const ACTIVE = new Set(["planned", "executing", "waiting", "blocked"])
const DEFAULT_LEASE_MINUTES = 30

class Abort extends Error {
  constructor(message, code = EXIT.error) { super(message); this.code = code }
}

// ---------------------------------------------------------------- release + identity

/** The activated release root. It moves on every activation, so nothing may hardcode it. */
function releaseRoot() {
  const pinned = (process.env.OPENCODE_QUEST_RELEASE ?? "").trim()
  let root = pinned
  if (!root) {
    const channel = join(homedir(), ".config", "opencode", ".channels", "dev.json")
    if (!existsSync(channel)) throw new Abort(`No activated OpenCode release: ${channel} is missing. Activate one, or set OPENCODE_QUEST_RELEASE to a release root.`)
    try { root = JSON.parse(readFileSync(channel, "utf8")).root } catch (error) { throw new Abort(`Cannot read ${channel}: ${error.message}`) }
    if (!root) throw new Abort(`${channel} names no release root; activate a release before using the board.`)
  }
  if (!existsSync(join(root, "quest", "store.ts"))) throw new Abort(`${root} is not an OpenCode release (no quest/store.ts).${pinned ? " OPENCODE_QUEST_RELEASE points at it." : " Re-activate a release."}`)
  return root
}

/**
 * Which harness is calling. This is attribution on a shared board, not access control: it decides
 * whose name appears next to a held step and what `--mine` means, nothing more.
 */
function detectHarness() {
  const env = process.env
  if (env.QUEST_HARNESS?.trim()) return env.QUEST_HARNESS.trim()
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return "claude"
  if (env.CODEX_HOME || env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED) return "codex"
  if (env.OPENCODE || env.OPENCODE_BIN_PATH || env.OPENCODE_SERVER) return "opencode"
  return "agent"
}

// ---------------------------------------------------------------- argv

/** `--flag value`, `--flag=value`, `--flag` (true), `--` ends flags. Everything else is positional. */
function parseArgv(argv) {
  const positional = [], flags = {}
  const valued = new Set(["as", "project", "limit", "lease", "note", "result", "kind", "state"])
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === "--") { positional.push(...argv.slice(i + 1)); break }
    if (!token.startsWith("--")) { positional.push(token); continue }
    const [name, inline] = token.slice(2).split(/=(.*)/s)
    if (inline !== undefined) flags[name] = inline
    else if (valued.has(name)) flags[name] = argv[++i]
    else flags[name] = true
  }
  return { positional, flags }
}

// ---------------------------------------------------------------- formatting

const truncate = (text, max) => { const value = String(text ?? "").replace(/\s+/g, " ").trim(); return value.length > max ? value.slice(0, max - 1) + "…" : value }
function age(iso) {
  const ms = Date.now() - Date.parse(iso ?? "")
  if (!Number.isFinite(ms) || ms < 0) return "-"
  const m = Math.round(ms / 60000)
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
const write = (text) => process.stdout.write(text.endsWith("\n") ? text : text + "\n")
const emit = (flags, value, lines) => write(flags.json ? JSON.stringify(value) : (lines.length ? lines.join("\n") : "none"))

// ---------------------------------------------------------------- step claims

const callIDFor = (stepID) => `step:${stepID}`
/** The session record holding a step, or undefined when the step is free. */
function holderOf(quest, stepID) {
  const session = quest.sessions.find((candidate) => candidate.callID === callIDFor(stepID))
  return session && ACTIVE.has(session.state) ? session : undefined
}
/** A lease that has run out marks an abandoned claim, so a killed harness cannot pin a step forever. */
const leaseExpired = (session) => { const at = Date.parse(session?.leaseExpiresAt ?? ""); return Number.isFinite(at) && at < Date.now() }
const holderName = (session) => session?.role || session?.agentRole || "?"
function holderLine(session) {
  if (!session) return ""
  return ` @${holderName(session)}${session.harness && session.harness !== holderName(session) ? `/${session.harness}` : ""} ${age(session.lastHeartbeatAt ?? session.updatedAt)}${leaseExpired(session) ? " stale" : ""}`
}
/**
 * Every message QuestStore raises when the snapshot a caller read is no longer current. The third
 * is the pre-2026-09 wording of the revision conflict, still live in older activated releases.
 */
const retryable = (error) => /changed since it was read|reload and retry|since migration preview/i.test(String(error?.message ?? ""))
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const ATTEMPTS = 24
/**
 * Every unconditional write goes through here. A busy board refuses writes whose snapshot moved
 * underneath them, which under real contention is ordinary and not a failure — the only write that
 * must lose on a stale snapshot is the claim itself, and that one is deliberately not retried here.
 */
function retrying(action, attempts = ATTEMPTS) {
  for (let attempt = 0; ; attempt++) {
    try { return action() }
    catch (error) { if (!retryable(error) || attempt >= attempts) throw error; pause(10 + attempt * 10) }
  }
}

/**
 * Take a step, or report who already has it.
 *
 * The exclusive decision is the single `session-claimed` apply carrying `expectedRevision`.
 * QuestStore compares that revision inside the Quest's own lock, so of two claimers holding the
 * same snapshot exactly one commits. The loop exists so an unrelated concurrent write (progress on
 * another step, a giver patch) is not mistaken for losing the race: on a stale revision we re-read
 * and decide again, and if the write that moved the revision was the other claim, we see the holder
 * and stop. Running out of attempts is never reported as an error while someone visibly holds it.
 */
function claimStep(api, questID, ref, me, options) {
  let last
  for (let attempt = 0; attempt <= ATTEMPTS; attempt++) {
    const quest = api.get(questID)
    if (!quest) throw new Abort(`Quest not found: ${questID}`)
    const step = findStepOrFail(quest, ref)
    last = { quest, step }
    const holder = holderOf(quest, step.id)
    if (holder && holderName(holder) !== me && !leaseExpired(holder) && !options.force) return { outcome: "held", quest, step, holder }
    const payload = {
      callID: callIDFor(step.id), taskID: `${quest.id}:${step.id}`,
      role: me, agentRole: me, harness: detectHarness(), task: options.note ?? step.title,
      deliverables: [step.id],
      scope: { step: step.id, agent: me, harness: detectHarness(), pid: process.pid, host: hostname(), cwd: process.cwd() },
    }
    try { api.store.apply(quest.id, "session-claimed", payload, SOURCE, { expectedRevision: quest.revision }) }
    catch (error) { if (retryable(error)) { pause(10 + attempt * 10); continue } throw error }
    // The step is ours from here. The lease and the step status are bookkeeping on top of a
    // decision already committed, so a write that loses a later race must not un-tell the caller
    // it owns the step — it would go and do the work anyway, believing nothing was recorded.
    const leaseExpiresAt = new Date(Date.now() + options.leaseMinutes * 60_000).toISOString()
    try {
      retrying(() => api.store.apply(quest.id, "session-state", { callID: callIDFor(step.id), state: "executing", heartbeatAt: new Date().toISOString(), leaseExpiresAt, evidence: options.note }, SOURCE))
      if (step.status !== "working") retrying(() => api.store.apply(quest.id, "stage-state", { stageID: step.id, status: "working" }, SOURCE))
    } catch (error) { process.stderr.write(`claim recorded; lease and step status were not: ${error.message}\n`) }
    return { outcome: holder && holderName(holder) !== me ? "taken-over" : "claimed", quest: api.get(quest.id), step, holder }
  }
  // Out of attempts. If somebody is now visibly holding it, that is the answer, not an error.
  const holder = holderOf(api.get(questID) ?? last.quest, last.step.id)
  if (holder) return { outcome: "held", quest: last.quest, step: last.step, holder }
  throw new Abort(`Quest ${questID} is being written too fast to claim ${ref}; retry.`)
}

/** A step report may only come from its holder. --force is the deliberate override, and it is logged. */
function requireHold(quest, step, me, flags, verb) {
  const holder = holderOf(quest, step.id)
  if (!holder || holderName(holder) === me || flags.force) return holder
  throw new Abort(`Step ${step.id} is held by ${holderName(holder)} (${age(holder.lastHeartbeatAt ?? holder.updatedAt)} ago); claim it or pass --force to ${verb} anyway.`, EXIT.held)
}

// ---------------------------------------------------------------- main

const { positional, flags } = parseArgv(process.argv.slice(2))
const command = positional[0]
if (!command || command === "help" || flags.help) { usage(); process.exit(command ? EXIT.ok : EXIT.usage) }

let api, findStep, questProgress, questLane, projectIdentity
try {
  const root = releaseRoot()
  const load = (name) => import(pathToFileURL(join(root, name)).href)
  const { createQuestAgentAPI } = await load("quest/agent-api.ts")
  ;({ findStep, questProgress } = await load("quest/steps.ts"))
  ;({ questLane } = await load("quest/board.ts"))
  ;({ projectIdentity } = await load("quest/project.ts"))
  api = createQuestAgentAPI()
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exit(error instanceof Abort ? error.code : EXIT.error)
}
const me = (flags.as ?? process.env.QUEST_AGENT ?? detectHarness()).trim()
const limit = Math.max(1, Math.min(Number(flags.limit ?? 20) || 20, 200))
const leaseMinutes = Math.max(1, Number(flags.lease ?? DEFAULT_LEASE_MINUTES) || DEFAULT_LEASE_MINUTES)

function findStepOrFail(quest, ref) {
  const step = findStep(quest, ref)
  if (step) return step
  const known = quest.stages.map((stage, index) => `${index + 1}=${stage.id}`).join(" ") || "none — run `plan` first"
  throw new Abort(`No step ${ref} on ${quest.id}. Steps: ${known}`)
}
function questOrFail(id) {
  const quest = api.get(id)
  if (!quest) throw new Abort(`Quest not found: ${id}`)
  return quest
}
/** Steps this agent is holding right now. */
const heldSteps = (quest, agent) => quest.sessions.filter((s) => s.callID?.startsWith("step:") && ACTIVE.has(s.state) && (!agent || holderName(s) === agent))
/**
 * "Mine" is wider than "held right now": an agent that finished a step still needs to find the
 * Quest again after a compaction. Anything this agent has ever held on the board counts.
 */
const isMine = (quest, agent) => quest.owner === agent || quest.sessions.some((s) => s.callID?.startsWith("step:") && holderName(s) === agent)

function projectMatcher(value) {
  if (!value || value === true) return () => true
  const path = value === "." ? process.cwd() : value
  if (existsSync(path)) { try { const { id } = projectIdentity(path); return (q) => q.project?.id === id } catch { /* fall through to a text match */ } }
  const needle = String(value).toLowerCase()
  return (q) => `${q.project?.root ?? ""}`.toLowerCase().includes(needle)
}

const stepRow = (quest, stage, index) => `${index + 1} ${stage.status.padEnd(7)} ${stage.id} ${truncate(stage.title, 72)}${holderLine(holderOf(quest, stage.id))}`
const stepJson = (quest, stage, index) => {
  const holder = holderOf(quest, stage.id)
  return { n: index + 1, id: stage.id, title: stage.title, status: stage.status, note: stage.note, proofs: stage.proofs.length, holder: holder && { agent: holderName(holder), harness: holder.harness, since: holder.updatedAt, lease: holder.leaseExpiresAt, stale: leaseExpired(holder) } }
}
const questJson = (quest) => {
  const progress = questProgress(quest)
  return { id: quest.id, title: quest.title, state: quest.state, lane: questLane(quest), objective: quest.objective, progress: { done: progress.done, total: progress.total }, nextAction: quest.nextAction, project: quest.project?.root, updatedAt: quest.updatedAt, steps: quest.stages.map((stage, index) => stepJson(quest, stage, index)) }
}

try {
  switch (command) {
    /** file <title> <intent> [step]... — dedupes on the request itself, so re-filing is safe. */
    case "file": case "new": {
      const [, title, intent, ...steps] = positional
      if (!title || !intent) throw new Abort('usage: quest file "<outcome>" "<what was asked>" [step]...', EXIT.usage)
      const project = (() => { try { return projectIdentity(process.env.QUEST_PROJECT ?? process.cwd()) } catch { return undefined } })()
      const { outcome, quest } = retrying(() => api.admitIntake({ title, objective: intent, description: intent, project, ...(steps.length ? { steps } : {}) }))
      emit(flags, { outcome, ...questJson(quest) }, [`${quest.id} ${outcome} ${quest.state} ${truncate(quest.title, 72)}`])
      break
    }
    /** plan <id> <step>... — set or re-set the steps; existing ids keep their status and proofs. */
    case "plan": {
      const [, id, ...steps] = positional
      if (!id || !steps.length) throw new Abort("usage: quest plan <id> <step>...", EXIT.usage)
      const quest = retrying(() => api.plan(id, steps, flags.append ? "append" : "replace"))
      emit(flags, questJson(quest), quest.stages.map((stage, index) => stepRow(quest, stage, index)))
      break
    }
    case "list": case "ls": {
      const matchesProject = projectMatcher(flags.project)
      const rows = api.list({ includeArchived: flags.all === true })
        .filter((q) => flags.all || q.state !== "Archived")
        .filter((q) => !flags.open || !["Complete", "Archived"].includes(q.state))
        .filter((q) => !flags.blocked || q.state === "Needs attention" || q.stages.some((s) => s.status === "blocked"))
        .filter((q) => !flags.mine || isMine(q, me))
        .filter(matchesProject)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
      emit(flags, rows.map(questJson), rows.map((q) => {
        const p = questProgress(q)
        const holders = [...new Set(heldSteps(q).map(holderName))]
        return `${q.id} ${questLane(q).padEnd(10)} ${p.done}/${p.total} ${truncate(q.title, 64)}${holders.length ? ` @${holders.join(",")}` : ""}`
      }))
      break
    }
    case "read": case "show": {
      const quest = questOrFail(positional[1] ?? throwUsage("quest read <id>"))
      const progress = questProgress(quest)
      const lines = [`${quest.id} ${quest.state}/${questLane(quest)} ${progress.done}/${progress.total} ${truncate(quest.title, 72)}`]
      if (flags.full) lines.push(`objective: ${quest.objective}`)
      lines.push(`next: ${truncate(quest.nextAction, 100)}`)
      lines.push(...quest.stages.map((stage, index) => stepRow(quest, stage, index) + (flags.full && stage.note ? `\n    ${truncate(stage.note, 160)}` : "")))
      emit(flags, questJson(quest), lines)
      break
    }
    /** claim <id> <step> — the exclusive one. Exits 3 without taking anything when it is held. */
    case "claim": {
      const [, id, ref] = positional
      if (!id || !ref) throw new Abort("usage: quest claim <id> <step> [--as <agent>] [--note <text>] [--lease <minutes>] [--force]", EXIT.usage)
      const result = claimStep(api, id, ref, me, { force: flags.force === true, note: typeof flags.note === "string" ? flags.note : undefined, leaseMinutes })
      if (result.outcome === "held") {
        emit(flags, { outcome: "held", step: result.step.id, holder: holderName(result.holder), since: result.holder.updatedAt }, [`held ${result.step.id} @${holderName(result.holder)} ${age(result.holder.lastHeartbeatAt ?? result.holder.updatedAt)}`])
        process.exit(EXIT.held)
      }
      emit(flags, { outcome: result.outcome, quest: result.quest.id, step: result.step.id, agent: me, lease: leaseMinutes }, [`${result.outcome} ${result.quest.id} ${result.step.id} @${me} lease ${leaseMinutes}m`])
      break
    }
    /** progress <id> <step> <note> — a heartbeat that also renews the lease, so the step stays held. */
    case "progress": {
      const [, id, ref, ...rest] = positional
      const note = rest.join(" ").trim() || (typeof flags.note === "string" ? flags.note : "")
      if (!id || !ref || !note) throw new Abort("usage: quest progress <id> <step> <note>", EXIT.usage)
      const quest = questOrFail(id), step = findStepOrFail(quest, ref)
      const holder = requireHold(quest, step, me, flags, "report on it")
      if (holder) retrying(() => api.store.apply(quest.id, "session-state", { callID: callIDFor(step.id), state: "executing", evidence: note, heartbeatAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + leaseMinutes * 60_000).toISOString() }, SOURCE))
      const after = retrying(() => api.store.apply(quest.id, "stage-state", { stageID: step.id, status: step.status === "pending" ? "working" : step.status, evidence: note }, SOURCE))
      emit(flags, { quest: after.id, step: step.id, agent: me, note }, [`progress ${step.id} @${me}`])
      break
    }
    /** evidence <id> <step> <command> — a step proof plus, when a result is given, quest test evidence. */
    case "evidence": {
      const [, id, ref, ...rest] = positional
      const command = rest.join(" ").trim()
      if (!id || !ref || !command) throw new Abort("usage: quest evidence <id> <step> <command> [--result passed|failed] [--kind command|run|judgment]", EXIT.usage)
      const quest = questOrFail(id), step = findStepOrFail(quest, ref)
      requireHold(quest, step, me, flags, "attach evidence")
      const result = flags.result === "failed" ? "failed" : flags.result === "passed" ? "passed" : undefined
      const kind = ["command", "run", "judgment"].includes(flags.kind) ? flags.kind : "command"
      const at = new Date().toISOString()
      retrying(() => api.proof(quest.id, step.id, { kind, command, result, at, verified: true }))
      if (result) retrying(() => api.evidence(quest.id, "tests", { command, result, at, summary: `${step.id} by ${me}` }))
      emit(flags, { quest: quest.id, step: step.id, kind, command, result }, [`evidence ${step.id} ${kind}${result ? ` ${result}` : ""}`])
      break
    }
    /** done <id> <step> [note] — finish the step and end the hold in one call. */
    case "done": {
      const [, id, ref, ...rest] = positional
      if (!id || !ref) throw new Abort("usage: quest done <id> <step> [note]", EXIT.usage)
      const note = rest.join(" ").trim() || (typeof flags.note === "string" ? flags.note : "")
      const quest = questOrFail(id), step = findStepOrFail(quest, ref)
      const holder = requireHold(quest, step, me, flags, "finish it")
      retrying(() => api.step(quest.id, step.id, "done", note || `finished by ${me}`))
      if (holder) retrying(() => api.store.apply(quest.id, "session-state", { callID: callIDFor(step.id), state: "completed", evidence: note || `step ${step.id} done`, result: "completed" }, SOURCE))
      const after = api.get(quest.id), progress = questProgress(after)
      emit(flags, { quest: after.id, step: step.id, agent: me, progress: { done: progress.done, total: progress.total }, nextAction: after.nextAction }, [`done ${step.id} ${progress.done}/${progress.total} next: ${truncate(after.nextAction, 80)}`])
      break
    }
    /** block <id> <step> <reason> — keeps the hold, marks the step blocked so `list --blocked` finds it. */
    case "block": {
      const [, id, ref, ...rest] = positional
      const reason = rest.join(" ").trim() || (typeof flags.note === "string" ? flags.note : "")
      if (!id || !ref || !reason) throw new Abort("usage: quest block <id> <step> <reason>", EXIT.usage)
      const quest = questOrFail(id), step = findStepOrFail(quest, ref)
      const holder = requireHold(quest, step, me, flags, "block it")
      retrying(() => api.step(quest.id, step.id, "blocked", reason))
      if (holder) retrying(() => api.store.apply(quest.id, "session-state", { callID: callIDFor(step.id), state: "blocked", evidence: reason, heartbeatAt: new Date().toISOString() }, SOURCE))
      emit(flags, { quest: quest.id, step: step.id, blocked: reason }, [`blocked ${step.id} ${truncate(reason, 80)}`])
      break
    }
    /**
     * release <id> <step> [reason] — hand the step back without claiming it was finished.
     *
     * The hold record is removed, not marked cancelled. A cancelled session is how the board says
     * a worker died: deriveState reads one as "A worker session failed, was cancelled, or went
     * missing" and moves the whole Quest into Needs attention. Handing a step back on purpose is
     * not an incident, so the hold simply stops existing; the journal still records who had it.
     */
    case "release": {
      const [, id, ref, ...rest] = positional
      if (!id || !ref) throw new Abort("usage: quest release <id> <step> [reason]", EXIT.usage)
      const reason = rest.join(" ").trim() || (typeof flags.note === "string" ? flags.note : "") || `released by ${me}`
      const quest = questOrFail(id), step = findStepOrFail(quest, ref)
      const record = quest.sessions.find((session) => session.callID === callIDFor(step.id))
      if (!record) { emit(flags, { quest: quest.id, step: step.id, outcome: "free" }, [`free ${step.id}`]); break }
      if (holderOf(quest, step.id)) requireHold(quest, step, me, flags, "release it")
      retrying(() => api.store.apply(quest.id, "session-removed", { callID: callIDFor(step.id), summary: reason }, SOURCE))
      if (step.status === "working") retrying(() => api.store.apply(quest.id, "stage-state", { stageID: step.id, status: "pending", evidence: reason }, SOURCE))
      emit(flags, { quest: quest.id, step: step.id, outcome: "released", reason }, [`released ${step.id} ${truncate(reason, 80)}`])
      break
    }
    /** who — every step anyone is holding right now, oldest heartbeat last. */
    case "who": case "whoami": {
      const matchesProject = projectMatcher(flags.project)
      const rows = api.list().filter((q) => q.state !== "Archived").filter(matchesProject)
        .flatMap((q) => heldSteps(q, flags.mine ? me : undefined).map((s) => ({ quest: q, session: s, step: s.callID.slice(5) })))
        .sort((a, b) => (b.session.lastHeartbeatAt ?? b.session.updatedAt).localeCompare(a.session.lastHeartbeatAt ?? a.session.updatedAt))
        .slice(0, limit)
      emit(flags, rows.map(({ quest, session, step }) => ({ agent: holderName(session), harness: session.harness, quest: quest.id, questTitle: quest.title, step, since: session.lastHeartbeatAt ?? session.updatedAt, lease: session.leaseExpiresAt, stale: leaseExpired(session), doing: session.task })),
        rows.map(({ quest, session, step }) => `${holderName(session).padEnd(8)} ${quest.id} ${step} ${age(session.lastHeartbeatAt ?? session.updatedAt)}${leaseExpired(session) ? " stale" : ""} ${truncate(session.task ?? quest.title, 60)}`))
      break
    }
    default: throw new Abort(`unknown command: ${command}. Run \`quest help\`.`, EXIT.usage)
  }
} catch (error) {
  if (error instanceof Abort) { process.stderr.write(error.message + "\n"); process.exit(error.code) }
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exit(EXIT.error)
}

function throwUsage(text) { throw new Abort(`usage: ${text}`, EXIT.usage) }

function usage() {
  write([
    "quest — the shared Quest board, for Claude, Codex and OpenCode alike.  bun ~/.agents/quest.mjs <command>",
    "",
    '  file "<outcome>" "<what was asked>" [step]...   file it (deduped on the request); do this as intent is stated',
    "  plan <id> <step>...                             set the steps [--append]",
    "  list [--mine] [--open] [--blocked]              the board [--project <path|.>] [--all] [--limit n]",
    "  read <id> [--full]                              one quest and its steps",
    "  claim <id> <step> [--note <text>]               take a step; exits 3 if held [--lease <min>] [--force]",
    "  progress <id> <step> <note>                     report and renew the lease",
    "  evidence <id> <step> <command> [--result ...]   attach a proof to the step",
    "  done <id> <step> [note]                         finish the step and release it",
    "  block <id> <step> <reason>                      mark it blocked, keep the hold",
    "  release <id> <step> [reason]                    hand it back unfinished",
    "  who [--mine] [--project <path|.>]               who is holding what right now",
    "",
    "  --json on any command.  --as <agent> or QUEST_AGENT names you; the harness is detected otherwise.",
    "  Steps are named by id, 1-based position, or a unique title prefix.",
    "  OPENCODE_QUEST_RELEASE pins the release; OPENCODE_QUEST_ROOT pins the ledger parent.",
  ].join("\n"))
}
