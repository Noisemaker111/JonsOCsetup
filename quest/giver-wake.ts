import { latestSessionAttempts, OWNED_RUN } from './session-lineage'
import { questCompletionReturn } from './completion-return'
import { questTruth } from './reachability'
import { reportBullet, plain } from './quest-report'
import type { Quest, QuestSession } from './types'

/**
 * What is worth a Quest Giver turn.
 *
 * Every queued notice costs a full giver turn, and on 2026-09-17 between 00:34 and 02:37 UTC almost
 * all of them bought nothing: terminal outcomes for attempts the runtime had already re-dispatched
 * after a rate limit, returns for superseded attempts, and the same unresolvable permission notice
 * twice an hour apart with no request id, no action and no resource in it. The giver replied to each
 * with a re-verification call and a report; four turns went on one permission it could not act on.
 *
 * A notice now exists for exactly one reason: a decision only the giver or Jon can make. Everything
 * else settles silently with a recorded reason, and the notices that do go out carry the
 * code-built report line for their Quest so the answer is already in the message.
 */

/**
 * Provider capacity, not a verdict on the work. These failures say the route was unavailable, and
 * the runtime's own retry is the answer to them -- waking the giver to be told a credential is
 * cooling down invites it to re-dispatch work that is already re-dispatched.
 */
export const CAPACITY_FAILURE = /cooling down|rate[_ ]?limit|server_is_overloaded|servers are currently overloaded|usage reached|no evidenced, funded route|window is exhausted/i

const runID = (run: QuestSession) => run.runID ?? run.callID

/** Another attempt on this Quest that already covers the same steps and is not over. */
function reDispatched(quest: Quest, run: QuestSession): boolean {
  return quest.sessions.some(other => runID(other) !== runID(run)
    && other.deliverables.some(step => run.deliverables.includes(step))
    && (OWNED_RUN.has(other.state) || other.attempt > run.attempt))
}

export type Wake = { wake: true; text: string } | { wake: false; settled: string }

/** The observation a delivery path has: it holds a settled run and asks no host to confirm anything. */
const settledObservation = () => ({ state: 'unknown', reason: 'The owning host was not asked; this run is already over' })

/** One line of the built report for this Quest, so a woken giver has the answer in the message. */
export function reportLine(quest: Quest): string {
  const bullet = reportBullet(questTruth(quest, settledObservation), new Map([[quest.id, quest]]))
  return `${bullet.name} — ${bullet.sentence} Ask: ${bullet.ask}`
}

/** Whether a terminal worker outcome is worth waking the giver for, and what it should read. */
export function completionWake(quest: Quest, run: QuestSession): Wake {
  if (quest.state === 'Archived') return { wake: false, settled: 'Quest archived before delivery; the result stays on the Quest' }
  if (!latestSessionAttempts(quest.sessions).some(row => runID(row) === runID(run)))
    return { wake: false, settled: 'Superseded by a newer attempt in this run lineage' }
  const failure = `${run.result ?? ''} ${run.evidence.at(-1) ?? ''}`
  if (run.state === 'failed' && CAPACITY_FAILURE.test(failure) && reDispatched(quest, run))
    return { wake: false, settled: 'The route was unavailable and the runtime already re-dispatched these steps; nothing here needs a decision' }
  return { wake: true, text: questCompletionReturn({ quest, label: 'Automatic Quest worker update', stepIDs: run.deliverables, run }) + '\n' + reportLine(quest) }
}

export type PendingRequest = { id?: string; action?: unknown; resources?: unknown }

/**
 * The permission notice, once per request.
 *
 * It used to be keyed on the request plus the authorization digest behind the review, and that
 * digest rotates on its own, so Quest 20ebb1c6 produced the identical "needs a new decision"
 * message at 01:38 and again at 02:37 with nothing in it to act on. Dedupe is the request id and
 * nothing else, and the text names the request, the action, the resource and the single control
 * that resolves it.
 */
export function permissionWake(quest: Quest, request: PendingRequest, reason: string, notified: Record<string, string> = {}): Wake {
  const id = typeof request.id === 'string' ? request.id : ''
  if (!id) return { wake: false, settled: 'The owning host reported a pending request with no identity; nothing to ask about' }
  if (notified[id]) return { wake: false, settled: 'Already asked about this request; a repeat says nothing new' }
  const action = plain(String(request.action ?? 'permission'))
  const resources = (Array.isArray(request.resources) ? request.resources : []).map(value => plain(String(value))).filter(Boolean)
  return {
    wake: true,
    text: [
      `A worker on "${quest.title}" is waiting for permission and cannot continue.`,
      `Request ${id} · action ${action}${resources.length ? ` · resource ${resources.join(', ')}` : ''}`,
      reason ? `The reviewer could not decide it: ${reason}` : '',
      'Resolve it with the Review worker permissions control (/quest-approvals), or tell the user exactly which authorization is missing and ask for that one thing. Prose cannot approve native access and there is no giver permission-reply tool. Do not redispatch the worker.',
      reportLine(quest),
    ].filter(Boolean).join('\n'),
  }
}
