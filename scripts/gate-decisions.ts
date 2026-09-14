/**
 * Pure decisions the activation gate makes about what it has observed.
 *
 * The gate used to decide inside its timeout loop: every link read the store, the
 * database or a rendered frame and asked its own inline question. When one timed
 * out, the question and the answer were thrown away, so each failure read like a
 * new problem. Measured across 53 recorded gate runs this check passed 26 times
 * and failed 27, spread over twelve links -- which is what about fifteen serial
 * predicates at 95% each predicts (0.95^15 is roughly 46%).
 *
 * Every decision here is a pure function of state the caller already observed, so
 * the shapes that a full model turn and a live host used to be the only way to
 * exercise now have direct tests (test/gate-decisions.test.ts). The gate keeps the
 * I/O: it reads Quests, queries the database and renders frames, then asks these
 * functions what it saw.
 */

/** A session record as the gate reads it, including the v1 id aliases the store still returns. */
export type GateSession = {
  sessionID?: string
  openCodeSessionId?: string
  state?: string
  runID?: string
  callID?: string
  attempt?: number
  updatedAt?: string
  result?: string
  evidence?: string[]
  deliverables?: string[]
}
/** A saved Quest step as the gate reads it. */
export type GateStage = { id: string; status?: string; note?: string }
/** A Quest as the gate reads it from the store. */
export type GateQuest = { id: string; title?: string; createdAt?: string; sessions?: GateSession[]; stages?: GateStage[] }
/** An account reservation row. */
export type GateReservation = { runID?: string; state?: string }
/** A session message parsed from the host database. */
export type GateMessage = {
  type?: string
  text?: string
  finish?: string
  time?: { completed?: unknown } | null
  content?: unknown
  metadata?: { questWorkerReturn?: boolean; questID?: string; runID?: string }
}

/**
 * Bound means the host recorded a session id. A planned or refused record has
 * neither field, and the gate is asking whether a worker ran, not which slot it
 * sits in -- sessions[0] was a refused route once, and the gate waited forever
 * while the worker it wanted sat in front of it.
 */
export function boundSession(session?: GateSession): boolean {
  return !!(session?.sessionID || session?.openCodeSessionId)
}

/** Every session in a Quest that bound to a host session. */
export function boundSessions(quest?: GateQuest): GateSession[] {
  return (quest?.sessions ?? []).filter(boundSession)
}

/** The newest host-bound worker attempt for a Quest, ignoring planned/refused records. */
export function latestBoundSession(quest?: GateQuest): GateSession | undefined {
  return boundSessions(quest).reduce<GateSession | undefined>((latest, session) => {
    if (!latest) return session
    const attempt = session.attempt ?? 0
    const latestAttempt = latest.attempt ?? 0
    if (attempt !== latestAttempt) return attempt > latestAttempt ? session : latest
    const updatedAt = session.updatedAt ?? ""
    const latestUpdatedAt = latest.updatedAt ?? ""
    return updatedAt >= latestUpdatedAt ? session : latest
  }, undefined)
}

/**
 * A title is not an identity. Asked for two Quests the giver made three: two shared
 * one title 79 seconds apart, so duplicate admission never saw a duplicate and
 * `find` took the empty one. The run's Quest is the newest carrying a worker; when
 * none has bound yet, the newest created.
 */
export function runQuest(quests: GateQuest[], title: string): GateQuest | undefined {
  const titled = quests.filter(quest => quest.title === title).sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
  return titled.find(quest => boundSessions(quest).length > 0) ?? titled[0]
}

/**
 * Both Quests of one run, and whether each has a worker. They are created and
 * dispatched inside a single giver turn, so two serial predicates only doubled the
 * ways the same turn could time out; measured failures were the turn being slow,
 * never one milestone missing while the other arrived.
 */
export function runQuestPair(quests: GateQuest[], primaryTitle: string, siblingTitle: string): {
  primary?: GateQuest
  sibling?: GateQuest
  primaryBound: boolean
  siblingBound: boolean
  complete: boolean
} {
  const primary = runQuest(quests, primaryTitle), sibling = runQuest(quests, siblingTitle)
  const primaryBound = boundSessions(primary).length > 0, siblingBound = boundSessions(sibling).length > 0
  return { primary, sibling, primaryBound, siblingBound, complete: primaryBound && siblingBound }
}

/** A worker is done only when its session completed and the account reservation it held reached settled. */
export function sessionSettled(session: GateSession | undefined, reservations: GateReservation[]): boolean {
  return session?.state === "completed" && !!session.runID && reservations.some(row => row.runID === session.runID && row.state === "settled")
}

/** A Quest is settled only when its latest bound worker attempt completed and released its reservation. */
export function questSettled(quest: GateQuest | undefined, reservations: GateReservation[]): boolean {
  return sessionSettled(latestBoundSession(quest), reservations)
}

/** The saved worker result must belong to the latest bound attempt, not an older successful run. */
export function latestRunSavedResult(quest: GateQuest | undefined, marker: string): boolean {
  const run = latestBoundSession(quest)
  if (!run || run.state !== "completed" || !run.runID || !run.result) return false
  return (quest?.stages ?? []).some(stage => run.deliverables?.includes(stage.id)
    && stage.status === "done" && stage.note?.includes(marker))
}

/** The real board is up: its search affordance is drawn. */
export const boardVisible = (text: string) => text.includes("Search quests")
/** The Quest picker is open. */
export const pickerVisible = (text: string) => text.includes("Select Quest")
/** The nudge composer is open above the Quest detail. */
export const nudgeComposerVisible = (text: string) => text.includes("Nudge Quest Giver")
/** The open detail says the worker is executing right now. */
export const detailRunning = (text: string) => text.includes("RUNNING · Saved: executing")
/** The open detail says the worker completed. */
export const detailCompleted = (text: string) => text.includes("COMPLETED · Saved: completed")

/**
 * The detail pane is on this Quest: the title is drawn past the list column. The
 * title also appears in the left list, so matching anywhere in the frame is not
 * the same decision -- the recorded `selected assigned Quest` timeouts were this
 * predicate applied while the board was still the only thing on screen.
 */
export function detailSelected(text: string, title: string): boolean {
  return !!title && text.split("\n").some(line => line.indexOf(title) > 35)
}

/**
 * The native worker transcript for this Quest is open: the worker's saved marker
 * and the title are on screen and the board is not.
 */
export function transcriptVisible(text: string, title: string, marker: string): boolean {
  return text.includes(marker) && text.includes(title) && !boardVisible(text)
}

/** Back on the saved Quest detail after returning from a worker. */
export function stepsVisible(text: string, title: string): boolean {
  return text.includes("QUEST STEPS") && detailSelected(text, title)
}

/**
 * The giver's automatic response: its worker-return notice for this Quest, followed
 * by an assistant turn that completed. Returns where each was found so a timeout can
 * say whether the notice never arrived or arrived without a response.
 */
export function automaticReturn(messages: GateMessage[], title: string, expected: { questID?: string; runID?: string; marker?: string } = {}, notice = "Automatic Quest worker update"): {
  received: boolean
  noticeAt: number
  responseAt: number
} {
  const serialized = messages.map(message => JSON.stringify(message))
  const noticeAt = messages.findIndex((message, index) => message.type === "user"
    && message.metadata?.questWorkerReturn === true
    && (!expected.questID || message.metadata.questID === expected.questID)
    && (!expected.runID || message.metadata.runID === expected.runID)
    && serialized[index].includes(notice) && serialized[index].includes(title)
    && (!expected.marker || serialized[index].includes(expected.marker)))
  if (noticeAt < 0) return { received: false, noticeAt, responseAt: -1 }
  for (let index = noticeAt + 1; index < messages.length; index++) {
    const message = messages[index]
    // One giver turn can coalesce sibling worker returns before it emits the single
    // completed assistant response. Those tagged notices are still automatic wake
    // input; an untagged/manual user prompt must invalidate this automatic result.
    if (message.type === "user") {
      if (message.metadata?.questWorkerReturn === true) continue
      return { received: false, noticeAt, responseAt: -1 }
    }
    if (message.type === "assistant" && !!message.time?.completed && message.finish === "stop") return { received: true, noticeAt, responseAt: index }
  }
  return { received: false, noticeAt, responseAt: -1 }
}

/** The giver's nudge reply: a user turn carrying the marker, then a completed assistant text repeating it. */
export function nudgeReply(messages: GateMessage[], marker: string): boolean {
  const at = messages.findLastIndex(message => message.type === "user" && message.text?.includes(marker))
  if (at < 0) return false
  for (const message of messages.slice(at + 1)) {
    if (message.type === "user") return false
    if (message.type === "assistant" && !!message.time?.completed && message.finish === "stop") {
      return (message.content as Array<{ type?: string; text?: string }> | undefined)?.some(part => part.type === "text" && part.text?.includes(marker)) === true
    }
  }
  return false
}
