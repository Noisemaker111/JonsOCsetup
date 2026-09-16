/**
 * Decide what a finished Quest run says about the model that ran it -- and what it does not.
 *
 * The router already has a consumer for measured work: `measuredOutcomeRoutes` feeds
 * `dispatchPlanInput` on every dispatch, and `evaluateTrials` reads `Trial.accepted`. That field is
 * `boolean | null` on purpose, and the null case is not "unknown, assume bad": a trial with
 * `accepted: null` raises "Unjudged outcomes", which withholds the route's evidence instead of
 * counting a loss against it.
 *
 * Nothing filled that field in, and the cost of getting it wrong is concrete. On 2026-09-15 a single
 * three-hour window -- an exhausted monthly pool, a wedged host, a killed backend -- produced 13 of
 * the 14 recorded failures on `opencode-go/deepseek-v4.1-flash#max` and 4 of the 5 on `#high`.
 * Scored naively that reads as a 33% model, and the same route outside that window is 12 of 13. A
 * ranking built on the naive reading would have demoted, permanently, whichever configuration
 * happened to be selected while the infrastructure was down.
 *
 * So the rule is: only the work itself may be judged. A run that never got a fair attempt is
 * unjudged, and an accepted result must carry the verification the evaluator demands, because
 * "the worker said it finished" is not a measurement.
 */
import { isSessionQuotaExhausted } from './session-lineage'
import type { Quest, QuestSession } from './types'

export type RunJudgment = { accepted: boolean | null; reason: string }

/**
 * Terminals that describe the delivery machinery, not the work. Each one was observed in this
 * installation's own saved run results and queued giver messages.
 */
const INFRASTRUCTURE: { pattern: RegExp; reason: string }[] = [
  { pattern: /dispatch owner .{0,80}exited/i, reason: 'the dispatching host exited before the run could finish' },
  { pattern: /socket connection was closed/i, reason: 'the tool transport closed mid-run' },
  { pattern: /operation timed out/i, reason: 'the tool transport timed out' },
  { pattern: /usage limit (has been )?reached/i, reason: 'the account allowance was exhausted' },
  { pattern: /monthly usage limit/i, reason: 'the account allowance was exhausted' },
  { pattern: /connection lost/i, reason: 'the host connection was lost' },
  { pattern: /execution interrupted/i, reason: 'execution was interrupted' },
  { pattern: /no healthy failover/i, reason: 'no healthy route was available' },
  { pattern: /working directory does not exist/i, reason: 'the assigned workspace was missing' },
]

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

/** Successful verification the evaluator will accept: a command that passed, with an artifact. */
export function runVerification(quest: Quest, run: QuestSession) {
  const artifact = quest.evidence.artifacts.at(-1)
  const passed = quest.evidence.tests.filter(t => t.result === 'passed')
  if (!passed.length || !artifact) return []
  return passed.map(test => ({ command: test.command, exitCode: 0, artifact: artifact.path ?? artifact.uri ?? artifact.name }))
}

export function judgeRun(quest: Quest, run: QuestSession): RunJudgment {
  if (!TERMINAL.has(run.state)) return { accepted: null, reason: 'Run has not reached a terminal state' }

  // Infrastructure first: a route cannot be blamed for a turn it never got.
  if (isSessionQuotaExhausted(run)) return { accepted: null, reason: 'Unjudged: the account allowance was exhausted' }
  const text = `${run.result ?? ''} ${run.evidence.join(' ')}`
  const infrastructure = INFRASTRUCTURE.find(entry => entry.pattern.test(text))
  if (infrastructure) return { accepted: null, reason: 'Unjudged: ' + infrastructure.reason }
  // Cancelled work was stopped by someone, so it carries no verdict on the model either.
  if (run.state === 'cancelled') return { accepted: null, reason: 'Unjudged: the run was cancelled before a verdict' }

  const assigned = run.deliverables.map(id => quest.stages.find(stage => stage.id === id)).filter(Boolean)
  if (!assigned.length) return { accepted: null, reason: 'Unjudged: the run carried no assigned step' }
  const delivered = assigned.every(stage => stage!.status === 'done')

  if (run.state === 'failed') return delivered
    // Its steps are done, so the work landed and something after it failed; that is not a rejection.
    ? { accepted: null, reason: 'Unjudged: the run failed after its assigned steps were already done' }
    : { accepted: false, reason: 'Rejected: the run ended without delivering its assigned steps' }

  if (!delivered) return { accepted: false, reason: 'Rejected: the run completed without delivering its assigned steps' }
  // "The worker said it finished" is not a measurement; the evaluator requires the artifact too.
  return runVerification(quest, run).length
    ? { accepted: true, reason: 'Accepted: assigned steps delivered with passing verification' }
    : { accepted: null, reason: 'Unjudged: delivered, but the Quest records no passing verification to check it against' }
}
