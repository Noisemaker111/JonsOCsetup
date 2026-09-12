import { compactQuestSummary } from './context'
import type { Quest, QuestSession } from './types'

const active = (run: QuestSession) => ['planned', 'executing', 'waiting', 'blocked'].includes(run.state)
const outcome = (run: QuestSession) => ({
  runID: run.runID ?? run.callID, sessionID: run.openCodeSessionId ?? run.sessionID,
  state: run.state, model: run.model, steps: run.deliverables,
  result: run.result ?? run.evidence.at(-1), updatedAt: run.updatedAt,
})

export function toolSummary(q: Quest) {
  return { ...compactQuestSummary(q), project: q.project,
    progress: { done: q.stages.filter(s => s.status === 'done').length, total: q.stages.length },
    lastOutcome: q.sessions.length ? outcome(q.sessions.at(-1)!) : undefined,
  }
}

/** One current record for decisions; historical attempts stay in inspect. */
export function toolDetail(q: Quest, continuations: any[] = []) {
  const queued = continuations.filter(c => !['done', 'stopped'].includes(c.state))
  return {
    ...toolSummary(q), description: q.description || q.objective, reward: q.reward,
    steps: q.stages.map(step => {
      const runs = q.sessions.filter(run => run.deliverables.includes(step.id))
      const owners = runs.filter(active)
      const latest = runs.at(-1)
      const dependencies = step.needs.filter(id => q.stages.find(s => s.id === id)?.status !== 'done')
      const continuation = queued.find(c => c.steps?.some((s: any) => s.id === step.id))
      const reason = step.status === 'done' ? 'Already done' : owners.length ? 'Owned by an active or unconfirmed run'
        : continuation ? 'Owned by a continuation' : dependencies.length ? 'Dependencies unfinished'
        : step.status !== 'pending' ? 'Review the saved note and outcome before returning this step to pending' : undefined
      return { id: step.id, title: step.title, state: step.status, detail: step.detail, note: step.note,
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
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 12000) throw new Error('Invalid detail pagination')
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
