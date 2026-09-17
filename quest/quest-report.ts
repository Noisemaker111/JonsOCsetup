import { devQueueGeneration } from "./runtime-queues"
import { liveCheckOf } from "../orchestration/verify-live-gate"
import { REPORT_GROUPS, questCounts, type QuestCounts, type QuestTruth, type ReportGroup } from "./reachability"
import type { Quest, QuestSession, QuestStage } from "./types"

/**
 * Jon's Quest report, built by code.
 *
 * The giver used to compose this from raw records every time it was asked, and what reached him was
 * a line reading "DONE | 88 archived Quests | No action" while five Quests sat blocked. The form is
 * not a writing style the model has to remember -- it is a projection of the ledger, so the giver
 * relays it and cannot get the grouping, the counts or the asks wrong.
 *
 * Four groups in this order, empty groups skipped: YOU, WORKING, QUEUED, DONE. One bullet per
 * Quest, always the same three parts: the plain name, one plain-language sentence of where it
 * stands, and the ask. No step id, session id, run id, revision number or internal state name ever
 * reaches a bullet -- `plain()` strips them and nothing here emits one deliberately.
 */

/** Ids Jon has to decode before he can act: session and message handles, ULIDs, long hex digests. */
const ID_TOKEN = /\b(?:ses_[A-Za-z0-9]+|msg_[A-Za-z0-9]+|run_[A-Za-z0-9]+|[0-9a-f]{12,}|[0-9a-hjkmnp-tv-z]{26})\b/g
/** Internal state words the report replaces with what they mean. */
const STATE_WORD = /\b(?:Needs attention|Ready to complete|Archived|Verifying|executing|unconfirmed|reachability)\b/g

export const plain = (value: unknown): string =>
  String(value ?? "").replace(ID_TOKEN, "").replace(STATE_WORD, "").replace(/\brevision \d+\b/gi, "")
    .replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/\(\s*\)/g, "").trim()

/** The recorded provider, model and reasoning level of a run, or an honest placeholder. */
export function workerLabel(session: QuestSession): string {
  const base = session.providerID && session.modelID ? `${session.providerID}/${session.modelID}` : session.model
  if (!base) return session.agentRole && session.agentRole !== "worker" ? session.agentRole : "worker"
  const tags = [session.fast ? "fast" : undefined, session.reasoningEffort ? `${session.reasoningEffort} reasoning` : undefined].filter(Boolean)
  return tags.length ? `${base} (${tags.join(" · ")})` : base
}

/** The assigned work of a run, named by its step titles rather than their ids. */
export function workerTask(quest: Quest, session: QuestSession): string {
  return session.deliverables.map(id => quest.stages.find(step => step.id === id)?.title ?? id).join(" · ")
    || session.task || session.taskDescription || "delegated work"
}

const quoted = (value: string) => `"${plain(value)}"`
const stepTitle = (q: Quest, id: string) => q.stages.find(step => step.id === id)?.title ?? id
const nextStep = (q: Quest): QuestStage | undefined =>
  q.stages.find(step => step.status === "working") ?? q.stages.find(step => step.status === "pending")
const lastDone = (q: Quest): QuestStage | undefined => [...q.stages].reverse().find(step => step.status === "done")
const done = (q: Quest) => q.stages.filter(step => step.status === "done").length

/** The pending request a worker is paused on, in the words of the action it asked to perform. */
function pendingAction(truth: QuestTruth): string | undefined {
  const request = truth.runs.flatMap(run => run.pending).at(0)
  if (!request) return undefined
  return plain([request.action, ...request.resources.slice(0, 2)].join(" ")) || undefined
}

function youBullet(truth: QuestTruth): { sentence: string; ask: string } {
  const q = truth.quest
  const blocked = q.stages.find(step => step.status === "blocked")
  if (truth.pendingPermissions > 0) {
    const action = pendingAction(truth)
    return {
      sentence: `A worker is paused waiting for permission${action ? ` to ${action}` : ""} and cannot continue until you decide.`,
      ask: "Open `/quest-approvals` and allow or reject the request.",
    }
  }
  if (blocked) return {
    sentence: `Work stopped on ${quoted(blocked.title)} and it cannot go further without a decision.`,
    ask: "Reply `retry it` or `drop it`.",
  }
  const over = truth.runs.find(run => run.over) ?? truth.runs.at(-1)
  const step = over ? workerTask(q, over.run) : nextStep(q)?.title
  return {
    sentence: `The last worker stopped without finishing${step ? ` ${quoted(step)}` : " its step"}, so nothing is moving it.`,
    ask: "Reply `retry it` or `drop it`.",
  }
}

function workingSentence(truth: QuestTruth): string {
  const run = truth.runs.find(row => row.confirmed) ?? truth.run
  const model = run ? workerLabel(run.run) : "a worker"
  const step = run ? workerTask(truth.quest, run.run) : nextStep(truth.quest)?.title
  return plain(`${model} is working on ${step ? quoted(step) : "it"} right now.`)
}

function queuedSentence(truth: QuestTruth, byID: Map<string, Quest>): string {
  const q = truth.quest
  if (truth.lane === "verifying") return "Every step is finished and it is waiting to be exercised in OpenCode before it can be turned in."
  const dependency = (q.relationships?.dependencies ?? []).map(id => byID.get(id)).find(other => other && other.state !== "Archived" && other.stages.some(step => step.status !== "done"))
  if (dependency) return `It is waiting for ${quoted(dependency.title)} to land first.`
  const step = nextStep(q)
  const unmet = step?.needs.filter(id => q.stages.find(other => other.id === id)?.status !== "done") ?? []
  if (step && unmet.length) return `${quoted(step.title)} is waiting for ${unmet.map(id => quoted(stepTitle(q, id))).join(" and ")} to finish first.`
  if (truth.recordedState === "Working" && !truth.confirmed) return `Nothing is running it: the worker it was handed to is not executing, so ${step ? quoted(step.title) : "its next step"} is waiting to be picked up again.`
  if (step) return `${quoted(step.title)} is ready and waiting for a free worker.`
  return "It is saved and waiting for its next step to be planned."
}

function doneSentence(q: Quest): string {
  const total = q.stages.length
  const finished = lastDone(q)
  const merged = q.evidence.commits.some(commit => commit.verified) ? "merged into agents" : "not merged into agents yet"
  const tested = liveCheckOf(q).status === "passed" ? "tested in OpenCode" : "not tested in OpenCode yet"
  const delivered = finished ? `Delivered ${quoted(finished.title)}` : "Delivered its saved result"
  return `${delivered}${total ? ` (${done(q)} of ${total} steps)` : ""}; ${merged} and ${tested}.`
}

export type ReportBullet = { group: ReportGroup; name: string; sentence: string; ask: string }
export type ReportSection = { group: ReportGroup; heading: string; bullets: ReportBullet[] }
export type QuestReport = {
  /** The generation this answer was served by, when the service knows its own. */
  serving?: string
  counts: QuestCounts
  /** All projects, or one named project: the report says which set it counted. */
  scope: string
  sections: ReportSection[]
}

const HEADING: Record<ReportGroup, string> = { you: "YOU", working: "WORKING", queued: "QUEUED", done: "DONE" }
const NOTHING = "nothing from you"

export function reportBullet(truth: QuestTruth, byID: Map<string, Quest>): ReportBullet {
  const name = plain(truth.quest.title)
  if (truth.group === "you") { const built = youBullet(truth); return { group: "you", name, sentence: plain(built.sentence), ask: built.ask } }
  if (truth.group === "working") return { group: "working", name, sentence: workingSentence(truth), ask: NOTHING }
  if (truth.group === "queued") return { group: "queued", name, sentence: plain(queuedSentence(truth, byID)), ask: NOTHING }
  return { group: "done", name, sentence: plain(doneSentence(truth.quest)), ask: NOTHING }
}

/**
 * The four groups, in order, with empty groups skipped. `counts` covers every record the query
 * matched even when the page shows fewer, so the header number and the bullets never imply
 * different backlogs.
 */
export function questReport(page: QuestTruth[], all: QuestTruth[], scope: string, serving = devQueueGeneration()): QuestReport {
  const byID = new Map(all.map(truth => [truth.quest.id, truth.quest]))
  const bullets = page.map(truth => reportBullet(truth, byID))
  return {
    ...(serving ? { serving } : {}),
    counts: questCounts(all), scope,
    sections: REPORT_GROUPS.flatMap(group => {
      const rows = bullets.filter(bullet => bullet.group === group)
      return rows.length ? [{ group, heading: HEADING[group], bullets: rows }] : []
    }),
  }
}
