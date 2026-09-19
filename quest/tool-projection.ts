import { compactQuestSummary } from './context'
import { questWorkflow } from './workflow'
import { observationFromActivity, withQuestActivity, type ActivitySnapshot } from './activity'
import { questCounts, questTruth } from './reachability'
import { questReport } from './quest-report'
import type { Quest, QuestSession } from './types'

const active = (run: QuestSession) => ['planned', 'executing', 'waiting', 'blocked'].includes(run.state)
const outcome = (run: QuestSession) => ({
  runID: run.runID ?? run.callID, sessionID: run.openCodeSessionId ?? run.sessionID,
  state: run.state, model: run.model, reasoning: run.reasoningEffort, steps: run.deliverables, permissions: run.permissionDecisions,
  result: run.result ?? run.evidence.at(-1), updatedAt: run.updatedAt,
})

export function toolSummary(q: Quest) {
  return { ...compactQuestSummary(q), title: q.title, revision: q.revision, project: q.project,
    progress: { done: q.stages.filter(s => s.status === 'done').length, total: q.stages.length },
  }
}

export function toolStatus(q: Quest) {
  return { ...toolSummary(q), steps: q.stages.map(step => ({ id: step.id, state: step.status })),
    runs: q.sessions.filter(active).map(run => ({ runID: run.runID ?? run.callID, sessionID: run.openCodeSessionId ?? run.sessionID, state: run.state, model: run.model, reasoning: run.reasoningEffort })) }
}

export function toolPlan(q: Quest, continuations: any[] = []) {
  const detail = toolDetail(q, continuations)
  return { ...toolSummary(q), description: detail.description, workflow: detail.workflow,
    steps: detail.steps.map(({ note, runs, lastOutcome, ...step }) => step), continuation: detail.continuation }
}

/** One current record for decisions; historical attempts stay in inspect. */
export function toolDetail(q: Quest, continuations: any[] = []) {
  const queued = continuations.filter(c => !['done', 'stopped'].includes(c.state))
  return {
    ...toolSummary(q), description: q.description || q.objective, reward: q.reward, workflow: questWorkflow(q),
    steps: q.stages.map(step => {
      const runs = q.sessions.filter(run => run.deliverables.includes(step.id))
      const owners = runs.filter(active)
      const latest = runs.at(-1)
      const dependencies = step.needs.filter(id => q.stages.find(s => s.id === id)?.status !== 'done')
      const continuation = queued.find(c => c.steps?.some((s: any) => s.id === step.id))
      const reason = step.status === 'done' ? 'Already done' : owners.length ? 'Owned by an active or unconfirmed run'
        : continuation ? 'Owned by a continuation' : dependencies.length ? 'Dependencies unfinished'
        : step.status !== 'pending' ? 'Review the saved note and outcome before returning this step to pending' : undefined
      return { id: step.id, title: step.title, state: step.status, detail: step.detail, note: step.note, commandID: step.commandID,
        needs: step.needs, ready: !reason, blockedBy: reason,
        runs: owners.map(outcome), lastOutcome: latest ? outcome(latest) : undefined }
    }),
    continuation: continuations.map(c => ({ id: c.id, state: c.state, reason: c.reason,
      stepIDs: c.steps?.map((s: any) => s.id), model: c.model })),
    artifacts: q.evidence.artifacts,
    inspect: 'This is the current decision record. Inspect only a specific historical detail that is missing; data is typed and nextOffset pages whole entries.',
  }
}

/** Page records, never fragments of serialized JSON. A single record stays intact. */
export function toolSection(value: unknown, section: string, offset = 0, limit = 8000) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) throw new Error('Invalid detail pagination')
  if (!Array.isArray(value)) {
    if (offset) throw new Error('This section is one value; omit offset')
    return { section, data: value ?? null, nextOffset: null }
  }
  const data: unknown[] = []
  let size = 2
  for (const item of value.slice(offset)) {
    const length = JSON.stringify(item).length + 1
    if (data.length && size + length > limit) break
    data.push(item); size += length
  }
  return { section, offset, totalItems: value.length, data,
    nextOffset: offset + data.length < value.length ? offset + data.length : null }
}

/**
 * The whole `list` answer, assembled once.
 *
 * Every field here is derived from the same records and the same single host activity read:
 * each item's state, the `counts` by group, and -- for `view=report` -- Jon's four groups. That is
 * what stops the CLI, the board's filter counts, the composer footer and the giver's report from
 * answering four different numbers for one ledger, which is what 110 records did on 2026-09-17.
 */
export function questListResult(
  result: { diagnostics: string[]; items: any[]; records: Quest[]; page: Quest[]; scope: string; total: number; nextOffset: number | null },
  activity: ActivitySnapshot,
  project: (item: any) => any,
  view?: string,
) {
  const observation = observationFromActivity(activity)
  const truths = result.records.map(q => questTruth(q, observation))
  const byID = new Map(truths.map(truth => [truth.quest.id, truth]))
  const page = result.page.flatMap(q => byID.get(q.id) ?? [])
  return {
    diagnostics: result.diagnostics.slice(0, 10),
    items: result.items.map(item => withQuestActivity(byID.get(item.id)!.quest, project(item), activity)),
    scope: result.scope, counts: questCounts(truths),
    ...(view === 'report' ? { report: questReport(page, truths, result.scope) } : {}),
    total: result.total, nextOffset: result.nextOffset,
  }
}
