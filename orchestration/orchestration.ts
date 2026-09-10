/**
 * Orchestration: keeping track of work that was spawned.
 *
 * Extracted from favorite-router.ts along with routing. This half answers
 * "what did we start, is it still alive, and did its result ever reach the
 * parent" — which is unrelated to which model a task should use, and was only
 * in the same file by accident.
 *
 * Three concerns live here:
 *  - the ledger of spawns, bindings and terminal states
 *  - the watchdog that re-injects a completion an idle parent never received
 *  - tracked child sessions for the live view
 *
 * The watchdog needs the host's session API, so unlike model-routing.ts this
 * module is not host-free; the pieces that can be pure (event parsing, child
 * summarisation, formatting) take their inputs as plain data so they stay
 * testable without a host.
 */
import { ledgerLockStatus, claimCompletionDelivery, suppressCompletionDelivery, recordCompletionDelivered, recordCompletionDeliveryFailed, recordNativeSessionLineage, recordNotification, recordTerminal, expireExecutionLeases, pendingCompletionEvidence, readLedger, type CompletionEvidence } from "./orchestration-ledger"
import { injectCompletion } from "./watchdog-inject"
import { detectProviderFailure, failureMessage, USAGE_REACHED, type ProviderFailure } from "../usage/usage-reached"

/**
 * A completion whose parent session no longer exists can never be delivered.
 * Before this check every server start re-claimed and re-failed each one,
 * which filled the 2 MB ledger with claimed/failed pairs and pruned the spawn
 * rows that carry questID. Such completions are suppressed once, for good.
 */
async function parentSessionGone(sessionApi: { get?: Function }, parentID: string): Promise<boolean> {
  if (typeof sessionApi?.get !== "function") return false
  try {
    const res = await sessionApi.get({ sessionID: parentID })
    const row = (res as { data?: unknown })?.data ?? res
    return !row
  } catch (error) {
    // Transport/auth/server failures do not prove deletion. Keep the notice retryable.
    const failure = error as { status?: number; statusCode?: number; response?: { status?: number } }
    if ((failure?.status ?? failure?.statusCode ?? failure?.response?.status) === 404) return true
    throw error
  }
}

export async function deliverPendingCompletion(sessionApi: { synthetic?: Function; get?: Function }, completion: CompletionEvidence, file?: string): Promise<boolean> {
  const pending = pendingCompletionEvidence(completion.parentID, file).find((entry) => entry.idempotencyKey === completion.idempotencyKey)
  if (!pending) return true
  if (await parentSessionGone(sessionApi, pending.parentID)) return suppressCompletionDelivery(pending, file)
  if (!claimCompletionDelivery(pending, file)) return true
  if (!await injectCompletion(sessionApi, pending)) {
    recordCompletionDeliveryFailed(pending.parentID, pending.idempotencyKey, file)
    return false
  }
  return recordCompletionDelivered(pending.parentID, pending.idempotencyKey, file)
}

/** The host emits `interrupted` for a cancelled turn (beta-19059); `cancelled` is the legacy name. */
const CANCEL_EVENTS = new Set(["session.execution.cancelled", "session.execution.interrupted"])


// ── watchdog: re-inject lost background-subagent completions ────────────────
// When a Task subagent finishes, the parent (orchestrator) session normally
// receives a synthetic result via task.ts injectBackgroundResult. That path is
// unreliable: delivery "steer" waits for a provider-turn boundary, and an idle
// parent has none (steer-into-idle-parent is never promoted). This watchdog
// re-injects a structured synthetic completion. Delivery acknowledgement is
// journaled separately, so transient host failures remain replayable. No timer
// injects user prompts or "Continue" into children.
//
// State lives on globalThis (Symbol.for) so plugin hot-reloads do NOT stack
// subscriptions or dedup sets: a reloaded module reuses the running watch.

// Key kept from the router era on purpose: it identifies the single running
// watch across a hot-reload. Renaming it would let an old and a new watchdog
// both register and double-inject every subagent result.
const WATCHDOG_STATE_KEY = Symbol.for("opencode-config.favorite-router.watchdog")

type WatchdogState = {
  installed: boolean
  notified: Set<string>
  notifying: Set<string>
  controller: AbortController
  sessionApi: Record<string, Function> | undefined
  leaseTimer?: ReturnType<typeof setInterval>
}

export function watchdogState(): WatchdogState {
  const g = globalThis as { [WATCHDOG_STATE_KEY]?: WatchdogState }
  if (!g[WATCHDOG_STATE_KEY]) {
    g[WATCHDOG_STATE_KEY] = { installed: false, notified: new Set(), notifying: new Set(), controller: new AbortController(), sessionApi: undefined }
  }
  return g[WATCHDOG_STATE_KEY]
}

function eventSessionID(event: unknown): { type?: string; sessionID?: string; idle: boolean } {
  const evt = (event ?? {}) as { type?: unknown; data?: unknown; properties?: unknown }
  const type = typeof evt.type === "string" ? evt.type : undefined
  const data = (evt.data ?? evt.properties ?? {}) as Record<string, unknown>
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
  let idle = false
  // V2 execution lifecycle (current runtime): terminal when an execution ends.
  if (type === "session.execution.succeeded" || type === "session.execution.failed" || type === "session.execution.cancelled" || type === "session.execution.interrupted") {
    idle = true
  }
  // Legacy/compat signals kept for older runtimes.
  if (type === "session.idle") idle = true
  if (type === "session.status") {
    const status = data.status as { type?: unknown } | undefined
    idle = status?.type === "idle"
  }
  if (type === "session.next.step.failed") idle = true
  return { type, sessionID, idle }
}

function messageTexts(message: unknown): string[] {
  const m = (message ?? {}) as { content?: unknown; parts?: unknown; text?: unknown }
  const texts: string[] = []
  for (const part of (Array.isArray(m.content) ? m.content : [...(Array.isArray(m.parts) ? m.parts : [])]) as Array<{
    text?: unknown
  }>) {
    if (typeof part?.text === "string") texts.push(part.text)
  }
  if (typeof m.text === "string") texts.push(m.text)
  return texts
}

function sessionMessages(res: unknown): unknown[] {
  if (Array.isArray(res)) return res
  if (res && typeof res === "object") {
    const o = res as { data?: unknown; messages?: unknown }
    if (Array.isArray(o.data)) return o.data
    if (Array.isArray(o.messages)) return o.messages
  }
  return []
}

function messageRole(message: unknown): string {
  const m = (message ?? {}) as Record<string, unknown>
  if (typeof m.type === "string") return m.type
  if (typeof m.role === "string") return m.role
  const info = m.info as Record<string, unknown> | undefined
  if (info && typeof info.role === "string") return info.role
  if (info && typeof info.type === "string") return info.type
  return ""
}

/** Only a host execution error is failure evidence; conversation text is not. */
function findProviderFailure(blob: string): ProviderFailure | undefined { return detectProviderFailure(blob) }
function renderFailure(failure: ProviderFailure): string { return failureMessage(failure) }

type ChildScan = { summary: string; providerError?: string; failure?: ProviderFailure }

async function parentAlreadyHasResult(sessionApi: { context?: Function }, parentID: string, childID: string) {
  try {
    const res = await sessionApi.context?.({ sessionID: parentID })
    const messages = sessionMessages(res)
    for (const message of messages) {
      // Only a TERMINAL rendering counts: the spawn call itself embeds
      // `state="running"` for the same child id, so a bare `task id=` match
      // would make us skip every completion. Also match the core's own
      // `<subagent ...>` completion format so a working core inject
      // suppresses the watchdog's copy.
      if (
        messageTexts(message).some(
          (text) =>
            text.includes(`<task id="${childID}" state="completed">`) ||
            text.includes(`<task id="${childID}" state="error">`) ||
            text.includes(`<subagent sessionID="${childID}" state="completed"`) ||
            text.includes(`<subagent sessionID="${childID}" state="error"`),
        )
      ) {
        return true
      }
    }
  } catch {}
  return false
}

async function parentAlreadyHasProviderError(sessionApi: { context?: Function }, parentID: string, childID: string) {
  try {
    const res = await sessionApi.context?.({ sessionID: parentID })
    for (const message of sessionMessages(res)) {
      if (
        messageTexts(message).some(
          (text) =>
            (text.includes(USAGE_REACHED) || text.includes("Provider unavailable —")) &&
            (text.includes(`<task id="${childID}"`) || text.includes(`sessionID="${childID}"`)),
        )
      ) {
        return true
      }
    }
  } catch {}
  return false
}

async function childSummary(sessionApi: { context?: Function }, childID: string, event?: unknown): Promise<ChildScan> {
  let lastAssistant = ""
  let failure: ProviderFailure | undefined
  try {
    const res = await sessionApi.context?.({ sessionID: childID })
    const messages = sessionMessages(res)
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!lastAssistant && messageRole(message) === "assistant") {
        const text = messageTexts(message).join("").trim()
        // Keep the TAIL: a harness turn is one long message (CLI activity first, the STEP report last).
        if (text) lastAssistant = text.length > 4000 ? text.slice(-4000) : text
      }
      if (failure && lastAssistant) break
    }
  } catch {}
  const error = (event as any)?.data?.error
  failure = error ? findProviderFailure(JSON.stringify(error)) : undefined
  // `providerError` stays the internal detail (logs, papercuts, cap collection);
  // `summary` is the blanket user-facing line. It names a quest session, never
  // the hidden worker agent: Jk reads "quest/session finished", never "build
  // finished" (the host binary derives its own "Build …" chip/notification
  // from the agent id itself, which is host-internal and out of scope).
  if (failure) return { summary: renderFailure(failure), providerError: failure.detail, failure }
  return { summary: lastAssistant || "Quest session completed" }
}

async function emitSessionText(
  sessionApi: { synthetic?: Function } | undefined,
  sessionID: string | undefined,
  text: string,
  label: string,
) {
  if (typeof sessionApi?.synthetic !== "function" || !sessionID) {
    console.warn(`[orchestration] ${label}: ctx.session.synthetic unavailable`)
    return
  }
  await sessionApi.synthetic({ sessionID, text })
}

async function handleSubagentEvent(event: unknown, sessionApi: any) {
  const { type, sessionID, idle } = eventSessionID(event)
  if (!type || !sessionID || !idle) return
  const scanned = await childSummary(sessionApi, sessionID, event)
  const child = await sessionApi.get({ sessionID }).catch((err: unknown) => {
    console.error(`[orchestration] watchdog: session.get(${sessionID}) failed:`, err)
    return undefined
  })
  const info = child?.data ?? child
  const parentID = info?.parentID
  if (!parentID) return
  const key = `${parentID}:${sessionID}`
  const notified = watchdogState().notified
  const failed =
    type === "session.next.step.failed" ||
    type === "session.execution.failed" ||
    type === "session.execution.cancelled" || type === "session.execution.interrupted" ||
    Boolean(scanned.providerError)
  recordTerminal(parentID, sessionID, failed ? (CANCEL_EVENTS.has(type) ? "cancelled" : "failed") : "completed")
  if (await parentAlreadyHasProviderError(sessionApi, parentID, sessionID)) {
    notified.add(key)
    return
  }
  if (!scanned.providerError && (await parentAlreadyHasResult(sessionApi, parentID, sessionID))) {
    notified.add(key)
    return
  }
  let summary = scanned.summary
  if (failed && !scanned.providerError && summary === "Quest session completed") {
    summary = "Quest session failed"
  }
  const terminalState = failed ? (CANCEL_EVENTS.has(type) ? "cancelled" : "failed") : "completed"
  const callID = readLedger().findLast((event) => event.parentID === parentID && event.childID === sessionID)?.callID ?? sessionID
  recordNativeSessionLineage(parentID, callID, sessionID)
  if (notified.has(key) || watchdogState().notifying.has(key)) return
  watchdogState().notifying.add(key)
  try {
    recordNotification(parentID, callID, sessionID, terminalState, summary)
    const completion = pendingCompletionEvidence(parentID).find((entry) => entry.callID === callID)
    if (!completion || await deliverPendingCompletion(sessionApi, completion)) notified.add(key)
  } finally {
    watchdogState().notifying.delete(key)
  }
}

export async function watchSubagentCompletions(ctx: any) {
  const state = watchdogState()
  // A reloaded module instance must not create a second subscription: the
  // original one stays live for the server process (its controller is never
  // aborted), and it keeps shared state via globalThis.
  if (state.installed) return
  state.installed = true
  const eventApi = ctx?.event
  const sessionApi = ctx?.session
  if (!eventApi || typeof eventApi.subscribe !== "function") {
    console.error("[orchestration] watchdog: ctx.event.subscribe unavailable")
    return
  }
  if (!sessionApi || typeof sessionApi.get !== "function") {
    console.error("[orchestration] watchdog: ctx.session.get unavailable")
    return
  }
  state.sessionApi = sessionApi
  if (typeof sessionApi.synthetic === "function") void (async () => {
    // Yield before historical replay so registration and event subscription can finish.
    await new Promise(resolve => setTimeout(resolve, 0))
    const lock = ledgerLockStatus()
    if (lock.state !== 'available') {
      console.error(`[orchestration] completion replay deferred: ${lock.state}; preserve the lock and verify its owner before explicit recovery`)
      return
    }
    const latest = new Map<string, ReturnType<typeof readLedger>[number]>()
    for (const event of readLedger()) {
      if (event.kind === "terminal" && event.childID) latest.set(`${event.parentID}:${event.childID}`, event)
    }
    for (const event of latest.values()) {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (ledgerLockStatus().state !== 'available') break
      if (!event.childID) continue
      const summary = event.state === "missing-result" ? `Worker result unavailable; resume the same session ID: ${event.childID}` : `Quest session ${event.state ?? "finished"}: ${event.childID}`
      try {
        const state = event.state === "completed" ? "completed" : event.state === "failed" ? "failed" : event.state === "cancelled" ? "cancelled" : "missing-result"
        recordNotification(event.parentID, event.callID, event.childID, state, summary)
      } catch {}
    }
    for (const completion of pendingCompletionEvidence()) {
      try { await deliverPendingCompletion(sessionApi, completion) } catch {}
    }
  })()
  state.leaseTimer = setInterval(async () => {
    for (const event of expireExecutionLeases()) {
      if (!event.childID) continue
      const key = `${event.parentID}:${event.childID}`
      if (state.notified.has(key) || state.notifying.has(key)) continue
      state.notifying.add(key)
      try {
        const summary = `Worker lease expired; result unavailable. Resume the same session ID: ${event.childID}`
        recordNotification(event.parentID, event.callID, event.childID, "missing-result", summary)
        const completion = pendingCompletionEvidence(event.parentID).find((entry) => entry.callID === event.callID)
        if (!completion || await deliverPendingCompletion(sessionApi, completion)) state.notified.add(key)
      } finally { state.notifying.delete(key) }
    }
  }, 10_000)
  try {
    const stream = await eventApi.subscribe({ signal: state.controller.signal })
    if (stream && typeof stream[Symbol.asyncIterator] === "function") {
      for await (const event of stream) {
        await handleSubagentEvent(event, sessionApi)
      }
    } else if (stream && typeof stream.next === "function") {
      for (;;) {
        const res = await stream.next()
        if (res.done) break
        await handleSubagentEvent(res.value, sessionApi)
      }
    } else {
      console.error("[orchestration] watchdog: unsupported event stream shape")
    }
  } catch (err) {
    console.error("[orchestration] watchdog: event subscription failed:", err)
  }
}

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "claude-code-harness": "Claude Code (Harness)",
  "claude-code": "Claude Code (Harness)",
  build: "Build",
  explore: "Explore",
  orchestrator: "Orchestrator",
  reviewer: "Reviewer",
  "model-openai-gpt-5-6-luna-fast": "OpenAI/GPT-5.6 Luna Fast",
  "model-grok-sub-grok-4-6": "Grok 4.6",
  "model-opencode-go-muse-spark-1-2-contributor": "Muse Spark 1.2",
  "model-x-preview-f-free": "Preview",
}

/** Friendly name for a Task target, without changing the internal identifier. */
export function formatAgentLabel(agent: unknown, _description?: unknown): string {
  const id = String(agent ?? "").trim()
  if (AGENT_DISPLAY_NAMES[id]) return AGENT_DISPLAY_NAMES[id]
  if (!id) return "Unknown agent"
  if (id.startsWith("model-")) {
    return id.slice("model-".length).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return id
}

/** Convert internal check/integration task ids into concise user-facing progress. */
export function formatTaskDescription(description: unknown, prompt?: unknown): string {
  const raw = String(description ?? "").trim()
  const explicit = typeof prompt === "object" && prompt !== null
    ? String((prompt as Record<string, unknown>).humanLabel ?? "").trim()
    : ""
  if (explicit) return explicit
  if (/^integrate-lean-/i.test(raw)) return "Updating orchestrator scaling (3 → N)"
  if (/^commit-review-skill/i.test(raw)) return "Reviewing integrated changes"
  if (/^verify-shell/i.test(raw)) return "Verifying shell guards"
  if (/^verify-/i.test(raw)) return "Verifying changes"
  if (/^check-/i.test(raw)) return "Checking implementation"
  return raw || "Working on assigned task"
}

/** Presentation-only normalization for a host Task.execute.before payload. */
export function normalizeTaskDisplay(input: unknown): void {
  if (!input || typeof input !== "object") return
  const args = input as Record<string, unknown>
  const description = args.description ?? args.title
  const label = formatTaskDescription(description, args)
  if (String(args.agent ?? "").trim().toLowerCase() === "claude-code") {
    args.description = `Claude Code (Harness) — ${label}`
    if ("title" in args) args.title = `Claude Code (Harness) — ${label}`
    return
  }
  if ("description" in args) args.description = label
  if ("title" in args) args.title = label
}
