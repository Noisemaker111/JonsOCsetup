import { readRequests } from "../usage/telemetry-api"
import { aggregateTelemetry } from "../usage/telemetry-api"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { QuestWorkspaces } from "./workspaces"
import { RouteReservations } from "../models/route-reservations"
import { QuestStore } from "./store"
import { requestFingerprint, redact } from "./privacy"
import type { Quest, QuestSession } from "./types"
import { readAllQuests } from "./index"
import { parseWorkerReport } from "./report"
import { deferGoalTerminal } from './goal-lifecycle'
import {dispatchReservationFile} from '../models/dispatch-planner'
import { findStep } from "./steps"
import { workerIdentityFromEvent } from "../orchestration/dispatch"
import type { CompletionEvidence } from "../orchestration/orchestration-ledger"

export type QuestDispatch = { questID: string; callID: string; taskID?: string; role: string; deliverables: string[]; model?: string; harness?: string; branch?: string; worktree?: string; agentRole?: string; providerID?: string; modelID?: string; reasoningEffort?: QuestSession["reasoningEffort"]; fast?: boolean; runtime?: "native" | "claude-code"; runID?: string; task?: string; parentID?: string; scope?: Record<string, unknown> }

const terminalSession = (state: string) => ["completed", "failed", "cancelled", "missing", "stale"].includes(state)
const ACTIVE_SESSION = new Set(["planned", "executing", "waiting", "blocked"])
const SESSION_ID = /^ses_[A-Za-z0-9_-]+$/

/** Host execution lifecycle events that end a worker turn. */
const HOST_TERMINAL: Record<string, "completed" | "failed" | "cancelled"> = {
  "session.execution.succeeded": "completed",
  "session.execution.failed": "failed",
  // The host (beta-19059) emits `interrupted` for a cancelled turn; `cancelled` is kept for older runtimes.
  "session.execution.interrupted": "cancelled",
  "session.execution.cancelled": "cancelled",
}

function taskInput(event: unknown): Record<string, unknown> {
  const ev = (event ?? {}) as Record<string, unknown>
  const input = ev.input ?? ev.args
  return input && typeof input === "object" ? input as Record<string, unknown> : {}
}

function taskCallID(event: unknown): string {
  const ev = (event ?? {}) as Record<string, unknown>
  return String(ev.questCallID ?? ev.callID ?? ev.id ?? ev.messageID ?? "")
}

/**
 * The host's execute.after hook passes one object whose `result` carries the
 * tool output. Older shapes passed the output as a second argument or as
 * `event.output`. All three are searched so a session is never left unbound.
 */
function taskResult(event: unknown, output?: unknown): unknown {
  const ev = (event ?? {}) as Record<string, unknown>
  return output ?? ev.result ?? ev.output ?? {}
}

function taskSessionID(output: unknown, event: unknown): string | undefined {
  const values: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === "string") { values.push(value); return }
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit)
  }
  visit(taskResult(event, output))
  const exact = values.find((value) => SESSION_ID.test(value))
  if (exact) return exact
  // Host output shapes seen so far: `(sessionID: ses_x)` from a backgrounded
  // subagent, `sessionID="ses_x"` from the completion tag, `Session: ses_x`.
  for (const value of values) {
    const found = value.match(/(?:Session:\s*|sessionID\s*[:=]\s*"?)(ses_[A-Za-z0-9_-]+)/i)?.[1]
    if (found) return found
  }
  // Last resort: any session id in the result that is not the parent's own.
  const parentID = String((event as Record<string, unknown> | undefined)?.sessionID ?? "")
  for (const value of values) {
    const found = (value.match(/ses_[A-Za-z0-9_-]+/g) ?? []).find((id) => id !== parentID)
    if (found) return found
  }
}

function toolError(event: unknown, output?: unknown): string | undefined {
  const ev = (event ?? {}) as Record<string, unknown>
  if (ev.status === "error" || ev.error) {
    const error = ev.error as { message?: unknown } | string | undefined
    return typeof error === "string" ? error : typeof error?.message === "string" ? error.message : "Quest dispatch returned an error"
  }
  let found: string | undefined
  const visit = (value: unknown) => {
    if (found || !value || typeof value !== "object") return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const row = value as Record<string, unknown>
    if (row.isError === true || row.error) {
      found = typeof row.error === "string" ? row.error : "Quest dispatch returned an error"
      return
    }
    Object.values(row).forEach(visit)
  }
  visit(taskResult(event, output))
  return found
}

function eventData(event: unknown): { type?: string; data: Record<string, unknown> } {
  const ev = (event ?? {}) as { type?: unknown; data?: unknown; properties?: unknown }
  const data = (ev.data ?? ev.properties ?? {}) as Record<string, unknown>
  return { type: typeof ev.type === "string" ? ev.type : undefined, data }
}

export type SessionRef = { questID: string; session: QuestSession }

export class QuestTracker {
  readonly enabled = process.env.OPENCODE_QUEST_MODE !== "off"
  private index = new Map<string, SessionRef>()
  private indexedAt = 0
  constructor(readonly store: QuestStore, readonly sessionApi?: { get?: Function }) {}

  /**
   * Ask the host which provider/model a bound session is pinned to. A harness
   * worker (vendor CLI) never produces an assistant message with a modelID,
   * so the session row is the only place its model is named.
   */
  async identifyFromHost(questID: string, callID: string, sessionID: string): Promise<boolean> {
    const get = this.sessionApi?.get
    if (typeof get !== "function") return false
    try {
      const res = await get({ sessionID })
      const info = ((res as { data?: unknown })?.data ?? res ?? {}) as Record<string, unknown>
      const model = (info.model ?? {}) as Record<string, unknown>
      if (typeof model.providerID !== "string" || typeof model.id !== "string") return false
      const current = this.store.read(questID)?.sessions.find((session) => session.callID === callID)
      if (!current || (current.providerID === model.providerID && current.modelID === model.id)) return false
      this.store.apply(questID, "session-state", { callID, state: current.state, providerID: model.providerID, modelID: model.id, model: `${model.providerID}/${model.id}` }, "host:session")
      this.indexedAt = 0
      return true
    } catch { return false }
  }
  admit(input: { title: string; objective: string; request: unknown; kind?: Quest["kind"]; priority?: Quest["priority"]; scope?: Quest["scope"]; deliverables?: Quest["deliverables"]; acceptanceCriteria?: Quest["acceptanceCriteria"]; owner?: string; integrationOwner?: string; createdAt?: string }): Quest {
    return this.store.admit({ ...input, requestFingerprint: requestFingerprint(input.request) })
  }
  beforeDispatch(input: { questID?: string; callID: string; taskID?: string; description?: string; role?: string; deliverables?: string[]; model?: string; harness?: string; branch?: string; worktree?: string; fingerprint?: string; agentRole?: string; providerID?: string; modelID?: string; reasoningEffort?: QuestSession["reasoningEffort"]; fast?: boolean; runtime?: "native" | "claude-code"; runID?: string; task?: string; parentID?: string; scope?: Record<string, unknown> }): QuestDispatch | undefined {
    if (!this.enabled) return
    const questID = input.questID
    if (!questID) throw new Error("Quest dispatch requires a Quest binding; create or select a Quest before spawning work")
    const q = this.store.read(questID); if (!q) throw new Error(`Quest dispatch references unknown Quest ${questID}`)
    this.store.apply(questID, "session-planned", { ...input, callID: input.callID, taskID: input.taskID, role: redact(input.role ?? "worker", 100), deliverables: (input.deliverables ?? []).slice(0, 50), model: redact(input.model ?? "", 150), harness: redact(input.harness ?? "", 100), branch: input.branch, worktree: input.worktree })
    this.indexedAt = 0
    return { ...input, questID, role: input.role ?? input.agentRole ?? "worker", deliverables: input.deliverables ?? [] }
  }
  bind(questID: string, callID: string, sessionID: string) {
    if (!this.enabled) return
    this.indexedAt = 0
    return this.store.apply(questID, "session-bound", { callID, sessionID })
  }
  terminal(questID: string, callID: string, state: "completed" | "failed" | "cancelled", evidence?: string) { if (this.enabled) return this.store.apply(questID, "session-state", { callID, state, evidence }) }
  /** Every dispatched unit belongs to a Quest; role is derived from lineage. */
  onTaskBefore(event: unknown): QuestDispatch | undefined {
    const ev = (event ?? {}) as Record<string, unknown>
    const input = taskInput(event)
    if (typeof input.questID !== "string") throw new Error("Quest dispatch requires questID")
    const identity = workerIdentityFromEvent(event)
    const quest = this.store.read(input.questID)
    if (!quest) throw new Error(`Quest dispatch references unknown Quest ${input.questID}`)
    const parentID = String(ev.sessionID ?? identity?.parentID ?? "")
    const continuationID = typeof input.sessionID === "string" ? input.sessionID : undefined
    if (continuationID) {
      const target = quest.sessions.find((session) => session.sessionID === continuationID || session.openCodeSessionId === continuationID)
      if (!target) throw new Error(`Quest dispatch session ${continuationID} is not bound to Quest ${input.questID}`)
      // Any giver session may continue a worker (board turns and composer
      // sessions come and go); only a live worker of this Quest may not.
      const parentIsLiveWorker = quest.sessions.some((session) => (session.sessionID === parentID || session.openCodeSessionId === parentID) && session.role === "worker" && !terminalSession(session.state))
      if (parentIsLiveWorker) throw new Error(`Quest dispatch continuation ${continuationID} violates Quest lineage: workers cannot spawn`)
      if (parentID && quest.integrationOwner !== parentID) this.store.apply(input.questID, "patched", { integrationOwner: parentID }, "quest:giver-bind")
      ev.questCallID = target.callID
      if (identity) identity.agentRole = "worker"
      this.store.apply(input.questID, "session-state", { callID: target.callID, state: "executing", evidence: "continued through Quest dispatch" }, "quest:dispatch-continuation")
      return { questID: input.questID, callID: target.callID, taskID: target.taskID, role: target.role, deliverables: target.deliverables, model: target.model, agentRole: "worker", providerID: target.providerID, modelID: target.modelID, reasoningEffort: target.reasoningEffort, fast: target.fast, runtime: target.runtime, runID: identity?.runID, task: identity?.task, parentID }
    }
    const parentIsWorker = quest.sessions.some((session) => (session.sessionID === parentID || session.openCodeSessionId === parentID) && session.role === "worker" && !terminalSession(session.state))
    if (parentIsWorker) throw new Error(`Quest ${input.questID} workers cannot spawn; the Quest giver dispatches work`)
    if (identity) identity.agentRole = "worker"
    // The newest giver session owns integration: board turns and composer sessions come and go.
    if (parentID && quest.integrationOwner !== parentID) this.store.apply(input.questID, "patched", { integrationOwner: parentID }, "quest:giver-bind")
    return this.beforeDispatch({
      questID: input.questID,
      callID: taskCallID(event),
      taskID: String(input.taskID ?? ev.id ?? ev.callID ?? ""),
      role: "worker",
      deliverables: undefined,
      model: typeof input.model === "string" ? input.model : undefined,
      harness: typeof input.harness === "string" ? input.harness : undefined,
      branch: typeof input.branch === "string" ? input.branch : undefined,
      worktree: typeof input.worktree === "string" ? input.worktree : undefined,
      agentRole: identity?.agentRole,
      providerID: identity?.providerID,
      modelID: identity?.modelID,
      reasoningEffort: identity?.reasoningEffort,
      fast: identity?.fast,
      runtime: identity?.runtime,
      runID: identity?.runID,
      task: identity?.task ?? (typeof input.task === "string" ? input.task : undefined),
      parentID: identity?.parentID ?? parentID,
      scope: input.scope && typeof input.scope === "object" ? input.scope as Record<string, unknown> : undefined,
    })
  }
  onCompletion(completion: CompletionEvidence, parkedDeliverySuppressed = false): "recorded" | "duplicate" | "parked" | undefined {
    if (!completion.questID || !this.enabled) return
    const quest = this.store.read(completion.questID)
    if (!quest) return
    const session = quest.sessions.find((candidate) => candidate.callID === completion.callID)
    const keys = Array.isArray(quest.extensions.completionKeys) ? quest.extensions.completionKeys.map(String) : []
    if (keys.includes(completion.idempotencyKey)) return session && ["completed", "failed", "cancelled", "missing", "stale"].includes(session.state) ? "duplicate" : undefined
    if (session?.state === "blocked" && session.dependency && session.dependency.status !== "resumed") {
      if (!parkedDeliverySuppressed) return "parked"
      this.store.apply(completion.questID, "session-state", { callID: completion.callID, state: "blocked", evidence: `Terminal ${completion.state} suppressed while dependency ${session.dependency.sessionID} owns ${session.dependency.file}`, completionKey: completion.idempotencyKey }, "orchestration:completion")
      return "parked"
    }
    const state = completion.state === "completed" ? "completed" : completion.state === "cancelled" ? "cancelled" : completion.state === "missing-result" || completion.state === "stopped" ? "missing" : "failed"
    this.store.apply(completion.questID, "session-state", { callID: completion.callID, state, evidence: completion.summary, result: completion.summary, openCodeSessionId: completion.openCodeSessionId, runtimeSessionId: completion.runtimeSessionId, runID: completion.runID, providerID: completion.providerID, modelID: completion.modelID, reasoningEffort: completion.reasoningEffort, fast: completion.fast, completionKey: completion.idempotencyKey }, "orchestration:completion")
    this.applyWorkerReport(completion.questID, completion.summary)
    return "recorded"
  }

  /**
   * Harness workers (Claude Code, Codex, Grok CLIs) have no `quest` tool, so
   * their final answer carries `STEP <id>: done — evidence` and
   * `TESTS: <command> — passed` lines. Apply them exactly as the tool would.
   */
  applyWorkerReport(questID: string, text: string | undefined): number {
    if (!text) return 0
    const report = parseWorkerReport(text)
    if (!report.steps.length && !report.tests.length) return 0
    let applied = 0
    for (const step of report.steps) {
      try {
        const quest = this.store.read(questID)
        const target = quest ? findStep(quest, step.ref) : undefined
        if (!target) continue
        const at = new Date().toISOString()
        this.store.apply(questID, "stage-state", { stageID: target.id, status: step.status, evidence: step.evidence || undefined }, "quest:worker-report")
        if (step.status === "done" && quest?.contractVersion !== 2) {
          this.store.apply(questID, "proof-added", { stageID: target.id, proof: { id: `${target.id}:command:${target.attempt}:report`, kind: "command", at, attempt: target.attempt, result: "passed", command: step.evidence || `reported done at ${at}` } }, "quest:worker-report")
          for (const todo of target.todos) if (todo.status !== "done") this.store.apply(questID, "stage-state", { stageID: target.id, todoID: todo.id, status: "done" }, "quest:worker-report")
        }
        applied++
      } catch (error) { console.error(`[quests] worker report step ${step.ref} failed:`, error) }
    }
    for (const test of report.tests) {
      try { this.store.apply(questID, "evidence-added", { kind: "tests", value: { command: test.command, result: test.result, at: new Date().toISOString() } }, "quest:worker-report"); applied++ } catch (error) { console.error("[quests] worker report tests failed:", error) }
    }
    // Cheap models skip the TESTS line even when told. The giver always makes
    // the last step a "Verify: ..." step; its done report with evidence IS the
    // test run, so record it as one when no TESTS line came.
    if (!report.tests.length && this.store.read(questID)?.contractVersion !== 2) {
      const quest = this.store.read(questID)
      for (const step of report.steps) {
        if (step.status !== "done" || !step.evidence) continue
        const target = quest ? findStep(quest, step.ref) : undefined
        if (!target || !/^verif/i.test(target.title) && !/^verif/i.test(target.id)) continue
        try { this.store.apply(questID, "evidence-added", { kind: "tests", value: { command: step.evidence, result: "passed", at: new Date().toISOString(), summary: `verify step ${target.id}` } }, "quest:worker-report"); applied++ } catch {}
      }
    }
    try {
      const quest = this.store.read(questID)
      if (quest) {
        const remaining = quest.stages.filter((stage) => stage.status !== "done")
        const blocked = remaining.find((stage) => stage.status === "blocked")
        const next = remaining.find((stage) => stage.status === "working") ?? remaining[0]
        const nextAction = blocked ? `Unblock step ${blocked.id}` : next ? `Step ${quest.stages.indexOf(next) + 1}/${quest.stages.length}: ${next.title}` : "All steps done; verify evidence and turn in"
        this.store.apply(questID, "patched", { nextAction, ...(blocked ? { reason: `Step ${blocked.id} is blocked` } : {}) }, "quest:worker-report")
      }
    } catch {}
    return applied
  }
  /** Bind the OpenCode session returned by native subagent dispatch. Success is not turn-in. */
  onTaskAfter(event: unknown, output?: unknown) {
    const input = taskInput(event)
    const questID = typeof input.questID === "string" ? input.questID : undefined
    if (!questID) throw new Error("Quest dispatch completion is missing its Quest binding")
    const callID = taskCallID(event)
    const sessionID = taskSessionID(output, event)
    if (sessionID) { this.bind(questID, callID, sessionID); void this.identifyFromHost(questID, callID, sessionID) }
    const error = toolError(event, output)
    if (error) this.terminal(questID, callID, "failed", error)
    else if (this.enabled) this.store.apply(questID, "session-state", { callID, state: "executing", evidence: "subagent session started from canonical Quest" })
  }

  /** Active Quest sessions by exact host session id, rebuilt at most every few seconds. */
  sessionIndex(maxAgeMs = 5_000): Map<string, SessionRef> {
    if (Date.now() - this.indexedAt < maxAgeMs) return this.index
    const next = new Map<string, SessionRef>()
    for (const { quest } of readAllQuests(this.store.projectRoot)) {
      if (!quest || quest.state === "Archived") continue
      for (const session of quest.sessions) {
        for (const id of [session.openCodeSessionId, session.sessionID]) if (id && SESSION_ID.test(id) && !next.has(id)) next.set(id, { questID: quest.id, session })
      }
    }
    this.index = next
    this.indexedAt = Date.now()
    return next
  }

  /** Compatibility entry point. Elapsed time cannot prove that an unbound launch stopped. */
  reconcileUnbound(_maxAgeMs = 30 * 60_000, _now = Date.now()): number {
    return 0 // Preserve legacy and v2 outcomes until an authoritative receipt or terminal event is available.
  }

  /**
   * Host events are the truth about a worker: the assistant message names the
   * provider/model that actually answered, and the execution lifecycle says
   * when the turn ended. Neither passes through the subagent tool result.
   */
  onHostEvent(event: unknown): "identified" | "settled" | undefined {
    if (!this.enabled) return
    const { type, data } = eventData(event)
    if (!type) return
    if (type === "message.updated") {
      const info = (data.info ?? {}) as Record<string, unknown>
      if (info.role !== "assistant" || typeof info.sessionID !== "string" || typeof info.modelID !== "string") return
      const ref = this.sessionIndex().get(info.sessionID)
      if (!ref) return
      const providerID = typeof info.providerID === "string" ? info.providerID : undefined
      const modelID = info.modelID
      if (ref.session.providerID === providerID && ref.session.modelID === modelID) return
      const model = providerID ? `${providerID}/${modelID}` : modelID
      this.store.apply(ref.questID, "session-state", { callID: ref.session.callID, state: ref.session.state, providerID, modelID, model, agentRole: typeof info.agent === "string" ? info.agent : undefined }, "host:message")
      this.indexedAt = 0
      return "identified"
    }
    // A harness worker (vendor CLI) produces no assistant message with a
    // modelID; the session row itself names the pinned model.
    if (type === "session.updated" || type === "session.created") {
      const info = (data.info ?? {}) as Record<string, unknown>
      const model = (info.model ?? {}) as Record<string, unknown>
      if (typeof info.id !== "string" || typeof model.providerID !== "string" || typeof model.id !== "string") return
      const ref = this.sessionIndex().get(info.id)
      if (!ref || (ref.session.providerID === model.providerID && ref.session.modelID === model.id)) return
      this.store.apply(ref.questID, "session-state", { callID: ref.session.callID, state: ref.session.state, providerID: model.providerID, modelID: model.id, model: `${model.providerID}/${model.id}` }, "host:session")
      this.indexedAt = 0
      return "identified"
    }
    const terminal = HOST_TERMINAL[type]
    if (terminal && typeof data.sessionID === "string") {
      if(deferGoalTerminal(this.store.runtime,data.sessionID,()=>this.onHostEvent(event),String((event as any).id??data.executionID??'')))return
      const ref = this.sessionIndex(0).get(data.sessionID)
      if (!ref || !ACTIVE_SESSION.has(ref.session.state)) return
      if (ref.session.state === "blocked" && ref.session.dependency && ref.session.dependency.status !== "resumed") return
      const error = data.error as { message?: unknown; data?: { message?: unknown } } | string | undefined
      const detail = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : typeof error?.data?.message === "string" ? error.data.message : undefined
      const result = "Host reported execution " + type.split(".").pop() + (detail ? ": " + redact(detail, 2000) : "")
      this.store.apply(ref.questID, "session-state", { callID: ref.session.callID, state: terminal, evidence: result, result }, "host:execution")
      if (ref.session.runID) {
        try { const workspaces=new QuestWorkspaces(this.store.runtime);if(workspaces.get(ref.session.runID)){workspaces.collect(ref.session.runID);workspaces.releaseShared(ref.session.runID,this.store,"Observed host terminal outcome")} } catch(error) { console.error("[quests] Could not collect completed worker changes",error) }
        const file=dispatchReservationFile(this.store.runtime)
        if(existsSync(file))try{const ledger=new RouteReservations(file),reservation=ledger.get(ref.session.runID),requests=readRequests().records.filter(r=>r.sessionID===data.sessionID);const currency=reservation?.cash?.currency;const cash=currency&&requests.length&&requests.every(r=>r.completedAt!==undefined&&r.actualCharge?.currency===currency&&Number.isFinite(r.actualCharge.value)&&r.actualCharge.value>=0)?{currency,value:aggregateTelemetry(requests).actualCharges[currency]}:undefined;ledger.settle(ref.session.runID,{state:"settled",completedAt:new Date().toISOString(),cash})}catch(error){console.error("[quests] Could not settle route reservation",error)}
      }
      this.indexedAt = 0
      return "settled"
    }
  }
}
