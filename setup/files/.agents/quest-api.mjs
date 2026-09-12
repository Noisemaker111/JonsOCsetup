/**
 * The Quest board as a callable API.
 *
 * Most work runs through Code Mode, which composes typed calls — it does not shell out and parse
 * text. A CLI is the wrong shape for that: every caller has to spawn a process, quote its arguments,
 * read stdout back and guess at exit codes. So the board's operations live here as functions that
 * take values and return values, and `quest.mjs` is a thin wrapper that prints them.
 *
 *   import { openBoard } from "~/.agents/quest-api.mjs"
 *   const board = await openBoard()
 *   const { quest } = await board.file({ title, intent, steps })
 *   await board.claim(quest.id, "s1")       // throws BoardError { code: "held" } if someone has it
 *   await board.done(quest.id, "s1", "what actually happened")
 *
 * Three things it must get right, and how:
 *
 *  - Runs under bun. The store is TypeScript with parameter properties, which node cannot strip.
 *  - Resolves the activated release itself from ~/.config/opencode/.channels/dev.json, because that
 *    path changes on every activation. OPENCODE_QUEST_RELEASE overrides it.
 *  - Writes through the real QuestStore and agent API, so a claim made here is the same object the
 *    OpenCode Quest Giver reads. There is no second format and no second ledger.
 *
 * Everything returned is plain data — the `quest` shape below, never store internals — so a caller
 * can hold it, serialise it, or hand it to another agent without reaching back into the release.
 *
 * Failures are `BoardError` with a `code`: "not-found", "held", "usage", "unavailable", "conflict".
 * `held` is the one that is not really an error — it is the answer to "can I have this step".
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir, hostname } from "node:os"
import { pathToFileURL } from "node:url"

export class BoardError extends Error {
  constructor(message, code = "error") { super(message); this.name = "BoardError"; this.code = code }
}

/** Session states that mean somebody is still on the step. Anything else frees it. */
const ACTIVE = new Set(["planned", "executing", "waiting", "blocked"])
const DEFAULT_LEASE_MINUTES = 30
const ATTEMPTS = 24
const callIDFor = (stepID) => `step:${stepID}`

/** The activated release root. It moves on every activation, so nothing may hardcode it. */
export function releaseRoot() {
  const pinned = (process.env.OPENCODE_QUEST_RELEASE ?? "").trim()
  let root = pinned
  if (!root) {
    const channel = join(homedir(), ".config", "opencode", ".channels", "dev.json")
    if (!existsSync(channel)) throw new BoardError(`No activated OpenCode release: ${channel} is missing. Activate one, or set OPENCODE_QUEST_RELEASE to a release root.`, "unavailable")
    try { root = JSON.parse(readFileSync(channel, "utf8")).root } catch (error) { throw new BoardError(`Cannot read ${channel}: ${error.message}`, "unavailable") }
    if (!root) throw new BoardError(`${channel} names no release root; activate a release before using the board.`, "unavailable")
  }
  if (!existsSync(join(root, "quest", "store.ts"))) throw new BoardError(`${root} is not an OpenCode release (no quest/store.ts).${pinned ? " OPENCODE_QUEST_RELEASE points at it." : " Re-activate a release."}`, "unavailable")
  return root
}

/**
 * Which harness is calling. This is attribution on a shared board, not access control: it decides
 * whose name appears next to a held step and what `mine` means, nothing more.
 */
export function detectHarness() {
  const env = process.env
  if (env.QUEST_HARNESS?.trim()) return env.QUEST_HARNESS.trim()
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return "claude"
  if (env.CODEX_HOME || env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED) return "codex"
  if (env.OPENCODE || env.OPENCODE_BIN_PATH || env.OPENCODE_SERVER) return "opencode"
  return "agent"
}

/**
 * Every message QuestStore raises when the snapshot a caller read is no longer current. The third
 * is the pre-2026-09 wording of the revision conflict, still live in older activated releases.
 */
const retryable = (error) => /changed since it was read|reload and retry|since migration preview/i.test(String(error?.message ?? ""))
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

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

const holderName = (session) => session?.role || session?.agentRole || "?"
/** A lease that has run out marks an abandoned claim, so a killed harness cannot pin a step forever. */
const leaseExpired = (session) => { const at = Date.parse(session?.leaseExpiresAt ?? ""); return Number.isFinite(at) && at < Date.now() }
/** The session record holding a step, or undefined when the step is free. */
function holderOf(quest, stepID) {
  const session = quest.sessions.find((candidate) => candidate.callID === callIDFor(stepID))
  return session && ACTIVE.has(session.state) ? session : undefined
}
const holderJson = (session) => session && ({
  agent: holderName(session), harness: session.harness, since: session.lastHeartbeatAt ?? session.updatedAt,
  lease: session.leaseExpiresAt, stale: leaseExpired(session), doing: session.task,
})

/**
 * Open the board.
 *
 * `agent` names you on every claim; it defaults to QUEST_AGENT, then to the detected harness.
 * `release` pins a release root, for a caller that already knows which one it means.
 */
export async function openBoard(options = {}) {
  const root = options.release ?? releaseRoot()
  const load = (name) => import(pathToFileURL(join(root, name)).href)
  const { createQuestAgentAPI } = await load("quest/agent-api.ts")
  const { findStep, questProgress } = await load("quest/steps.ts")
  const { questLane } = await load("quest/board.ts")
  const { projectIdentity } = await load("quest/project.ts")
  const api = createQuestAgentAPI()

  const me = String(options.agent ?? process.env.QUEST_AGENT ?? detectHarness()).trim()
  const harness = detectHarness()
  const source = `quest-api:${process.pid}`

  const stepJson = (quest, stage, index) => ({
    n: index + 1, id: stage.id, title: stage.title, status: stage.status, note: stage.note,
    proofs: stage.proofs.length, holder: holderJson(holderOf(quest, stage.id)),
  })
  const questJson = (quest) => {
    const progress = questProgress(quest)
    return {
      id: quest.id, title: quest.title, state: quest.state, lane: questLane(quest), objective: quest.objective,
      progress: { done: progress.done, total: progress.total }, nextAction: quest.nextAction,
      project: quest.project?.root, updatedAt: quest.updatedAt,
      steps: quest.stages.map((stage, index) => stepJson(quest, stage, index)),
    }
  }

  function questOrFail(id) {
    const quest = api.get(id)
    if (!quest) throw new BoardError(`Quest not found: ${id}`, "not-found")
    return quest
  }
  /** Steps are named by id, 1-based position, or a unique title prefix — whichever the caller has. */
  function stepOrFail(quest, ref) {
    const step = findStep(quest, ref)
    if (step) return step
    const known = quest.stages.map((stage, index) => `${index + 1}=${stage.id}`).join(" ") || "none — call plan() first"
    throw new BoardError(`No step ${ref} on ${quest.id}. Steps: ${known}`, "not-found")
  }
  /** A step report may only come from its holder. `force` is the deliberate override. */
  function requireHold(quest, step, force, verb) {
    const holder = holderOf(quest, step.id)
    if (!holder || holderName(holder) === me || force) return holder
    throw new BoardError(`Step ${step.id} is held by ${holderName(holder)}; claim it or pass force to ${verb} anyway.`, "held")
  }
  const heldSteps = (quest, agent) => quest.sessions.filter((s) => s.callID?.startsWith("step:") && ACTIVE.has(s.state) && (!agent || holderName(s) === agent))
  /**
   * "Mine" is wider than "held right now": an agent that finished a step still needs to find the
   * Quest again after a compaction. Anything this agent has ever held on the board counts.
   */
  const isMine = (quest) => quest.owner === me || quest.sessions.some((s) => s.callID?.startsWith("step:") && holderName(s) === me)

  function projectMatcher(value) {
    if (!value) return () => true
    const path = value === "." ? process.cwd() : value
    if (existsSync(path)) { try { const { id } = projectIdentity(path); return (q) => q.project?.id === id } catch { /* fall through to a text match */ } }
    const needle = String(value).toLowerCase()
    return (q) => `${q.project?.root ?? ""}`.toLowerCase().includes(needle)
  }

  return {
    /**
     * The release this board is reading, for a caller that wants to say so in a report. Named
     * `releaseRoot` and not `release` because `release()` hands a step back, and an object cannot
     * have both — the method silently won, and a caller reading the field got a function.
     */
    releaseRoot: root,
    /** The name that will appear on anything this board claims. */
    agent: me,

    /** File intent. Deduped on the request itself, so re-filing the same thing is safe. */
    file({ title, intent, steps = [], project } = {}) {
      if (!title || !intent) throw new BoardError("file needs a title and the intent behind it", "usage")
      const identity = (() => {
        try { return projectIdentity(project ?? process.env.QUEST_PROJECT ?? process.cwd()) } catch { return undefined }
      })()
      const { outcome, quest } = retrying(() => api.admitIntake({
        title, objective: intent, description: intent, project: identity, ...(steps.length ? { steps } : {}),
      }))
      return { outcome, quest: questJson(quest) }
    },

    /** Set the steps. Existing ids keep their status and proofs; `append` adds rather than replaces. */
    plan(id, steps, { append = false } = {}) {
      if (!id || !steps?.length) throw new BoardError("plan needs a quest id and at least one step", "usage")
      return questJson(retrying(() => api.plan(id, steps, append ? "append" : "replace")))
    },

    /** The board. Filters compose; `open` hides finished work, `blocked` shows what is stuck. */
    list({ open = false, mine = false, blocked = false, project, all = false, limit = 20 } = {}) {
      const matchesProject = projectMatcher(project)
      const cap = Math.max(1, Math.min(Number(limit) || 20, 200))
      return api.list({ includeArchived: all === true })
        .filter((q) => all || q.state !== "Archived")
        .filter((q) => !open || !["Complete", "Archived"].includes(q.state))
        .filter((q) => !blocked || q.state === "Needs attention" || q.stages.some((s) => s.status === "blocked"))
        .filter((q) => !mine || isMine(q))
        .filter(matchesProject)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, cap)
        .map(questJson)
    },

    /** One Quest and its steps, including who holds each. */
    read(id) { return questJson(questOrFail(id)) },

    /**
     * Take a step, exclusively.
     *
     * The decision is a single `session-claimed` apply carrying the revision the claimer read.
     * QuestStore compares it inside the Quest's own lock, so of two claimers holding the same
     * snapshot exactly one commits. The loop is for an unrelated concurrent write — progress on
     * another step, a giver patch — which must not be mistaken for losing the race.
     *
     * Returns `{ outcome: "held", holder }` rather than throwing when somebody else has it: being
     * told no is the normal answer to asking, and a caller that races is expected to move on.
     */
    claim(id, ref, { note, lease = DEFAULT_LEASE_MINUTES, force = false } = {}) {
      const leaseMinutes = Math.max(1, Number(lease) || DEFAULT_LEASE_MINUTES)
      let last
      for (let attempt = 0; attempt <= ATTEMPTS; attempt++) {
        const quest = questOrFail(id)
        const step = stepOrFail(quest, ref)
        last = { quest, step }
        const holder = holderOf(quest, step.id)
        if (holder && holderName(holder) !== me && !leaseExpired(holder) && !force)
          return { outcome: "held", quest: quest.id, step: step.id, holder: holderJson(holder) }
        const payload = {
          callID: callIDFor(step.id), taskID: `${quest.id}:${step.id}`,
          role: me, agentRole: me, harness, task: note ?? step.title,
          deliverables: [step.id],
          scope: { step: step.id, agent: me, harness, pid: process.pid, host: hostname(), cwd: process.cwd() },
        }
        try { api.store.apply(quest.id, "session-claimed", payload, source, { expectedRevision: quest.revision }) }
        catch (error) { if (retryable(error)) { pause(10 + attempt * 10); continue } throw error }
        // The step is ours from here. The lease and the step status are bookkeeping on top of a
        // decision already committed, so a write that loses a later race must not un-tell the caller
        // it owns the step — it would go and do the work anyway, believing nothing was recorded.
        const leaseExpiresAt = new Date(Date.now() + leaseMinutes * 60_000).toISOString()
        let recorded = true
        try {
          retrying(() => api.store.apply(quest.id, "session-state", { callID: callIDFor(step.id), state: "executing", heartbeatAt: new Date().toISOString(), leaseExpiresAt, evidence: note }, source))
          if (step.status !== "working") retrying(() => api.store.apply(quest.id, "stage-state", { stageID: step.id, status: "working" }, source))
        } catch { recorded = false }
        return {
          outcome: holder && holderName(holder) !== me ? "taken-over" : "claimed",
          quest: quest.id, step: step.id, agent: me, lease: leaseMinutes, leaseExpiresAt,
          ...(recorded ? {} : { warning: "claim recorded; lease and step status were not" }),
        }
      }
      // Out of attempts. If somebody is now visibly holding it, that is the answer, not an error.
      const holder = holderOf(api.get(id) ?? last.quest, last.step.id)
      if (holder) return { outcome: "held", quest: last.quest.id, step: last.step.id, holder: holderJson(holder) }
      throw new BoardError(`Quest ${id} is being written too fast to claim ${ref}; retry.`, "conflict")
    },

    /** Report and renew the lease, so a long step stays held while it is genuinely being worked. */
    progress(id, ref, note, { lease = DEFAULT_LEASE_MINUTES, force = false } = {}) {
      if (!note) throw new BoardError("progress needs a note saying what happened", "usage")
      const leaseMinutes = Math.max(1, Number(lease) || DEFAULT_LEASE_MINUTES)
      const quest = questOrFail(id), step = stepOrFail(quest, ref)
      const holder = requireHold(quest, step, force, "report on it")
      if (holder) retrying(() => api.store.apply(quest.id, "session-state", { callID: callIDFor(step.id), state: "executing", evidence: note, heartbeatAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + leaseMinutes * 60_000).toISOString() }, source))
      retrying(() => api.store.apply(quest.id, "stage-state", { stageID: step.id, status: step.status === "pending" ? "working" : step.status, evidence: note }, source))
      return { quest: quest.id, step: step.id, agent: me, note }
    },

    /** Attach a proof to the step, and quest-level test evidence when a result is given. */
    evidence(id, ref, command, { result, kind = "command", force = false } = {}) {
      if (!command) throw new BoardError("evidence needs the command that produced it", "usage")
      const quest = questOrFail(id), step = stepOrFail(quest, ref)
      requireHold(quest, step, force, "attach evidence")
      const outcome = result === "failed" ? "failed" : result === "passed" ? "passed" : undefined
      const proofKind = ["command", "run", "judgment"].includes(kind) ? kind : "command"
      const at = new Date().toISOString()
      retrying(() => api.proof(quest.id, step.id, { kind: proofKind, command, result: outcome, at, verified: true }))
      if (outcome) retrying(() => api.evidence(quest.id, "tests", { command, result: outcome, at, summary: `${step.id} by ${me}` }))
      return { quest: quest.id, step: step.id, kind: proofKind, command, result: outcome }
    },

    /** Finish the step and end the hold in one call. */
    done(id, ref, note, { force = false } = {}) {
      const quest = questOrFail(id), step = stepOrFail(quest, ref)
      const holder = requireHold(quest, step, force, "finish it")
      retrying(() => api.step(quest.id, step.id, "done", note || `finished by ${me}`))
      if (holder) retrying(() => api.store.apply(quest.id, "session-state", { callID: callIDFor(step.id), state: "completed", evidence: note || `step ${step.id} done`, result: "completed" }, source))
      const after = api.get(quest.id), progress = questProgress(after)
      return { quest: after.id, step: step.id, agent: me, progress: { done: progress.done, total: progress.total }, nextAction: after.nextAction }
    },

    /** Mark it blocked and keep the hold, so `list({ blocked: true })` finds it. */
    block(id, ref, reason, { force = false } = {}) {
      if (!reason) throw new BoardError("block needs the reason it is stuck", "usage")
      const quest = questOrFail(id), step = stepOrFail(quest, ref)
      const holder = requireHold(quest, step, force, "block it")
      retrying(() => api.step(quest.id, step.id, "blocked", reason))
      if (holder) retrying(() => api.store.apply(quest.id, "session-state", { callID: callIDFor(step.id), state: "blocked", evidence: reason, heartbeatAt: new Date().toISOString() }, source))
      return { quest: quest.id, step: step.id, blocked: reason }
    },

    /**
     * Hand the step back without claiming it was finished.
     *
     * The hold record is removed, not marked cancelled. A cancelled session is how the board says a
     * worker died — deriveState reads one as "a worker session failed, was cancelled, or went
     * missing" and moves the whole Quest into Needs attention. Handing a step back on purpose is not
     * an incident, so the hold simply stops existing; the journal still records who had it.
     */
    release(id, ref, reason, { force = false } = {}) {
      const quest = questOrFail(id), step = stepOrFail(quest, ref)
      const why = reason || `released by ${me}`
      const record = quest.sessions.find((session) => session.callID === callIDFor(step.id))
      if (!record) return { quest: quest.id, step: step.id, outcome: "free" }
      if (holderOf(quest, step.id)) requireHold(quest, step, force, "release it")
      retrying(() => api.store.apply(quest.id, "session-removed", { callID: callIDFor(step.id), summary: why }, source))
      if (step.status === "working") retrying(() => api.store.apply(quest.id, "stage-state", { stageID: step.id, status: "pending", evidence: why }, source))
      return { quest: quest.id, step: step.id, outcome: "released", reason: why }
    },

    /** Every step anyone is holding right now, most recent heartbeat first. */
    who({ mine = false, project, limit = 20 } = {}) {
      const matchesProject = projectMatcher(project)
      const cap = Math.max(1, Math.min(Number(limit) || 20, 200))
      return api.list().filter((q) => q.state !== "Archived").filter(matchesProject)
        .flatMap((q) => heldSteps(q, mine ? me : undefined).map((s) => ({ quest: q, session: s, step: s.callID.slice(5) })))
        .sort((a, b) => (b.session.lastHeartbeatAt ?? b.session.updatedAt).localeCompare(a.session.lastHeartbeatAt ?? a.session.updatedAt))
        .slice(0, cap)
        .map(({ quest, session, step }) => ({ quest: quest.id, questTitle: quest.title, step, ...holderJson(session) }))
    },
  }
}
