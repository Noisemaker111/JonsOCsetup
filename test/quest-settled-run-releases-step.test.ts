/**
 * @core-prevents a settled run leaving its step owned, so reconciliation frees nothing
 * @core-observed September 16: four settles shipped in one night — session missing, workspace deleted,
 * external lease expired, execution ended with the host — and the board did not move. terminalStepUpdates
 * released a working step only for completed, failed or cancelled, so every run reconciliation settled as
 * `stale` or `missing` freed the run and left the step owned by it. Six steps read working with no run behind
 * them at all, and the giver had nothing eligible to dispatch.
 */
import { expect, test } from 'bun:test'
import { terminalStepUpdates } from '../quest/session-lineage'

const quest = (runState: string, stepStatus = 'working') => ({
  stages: [{ id: 'work', title: 'Do the work', status: stepStatus }],
  sessions: [{ callID: 'run-1', state: runState, deliverables: ['work'], evidence: [], result: 'why it ended' }],
}) as any

test('a run settled stale or missing releases the step it owned', () => {
  for (const state of ['stale', 'missing']) {
    const [update] = terminalStepUpdates(quest(state))
    expect(update).toBeDefined()
    expect(update.status).toBe('pending')
    // The wording has to say the run ended, not that a worker reported something it never reported.
    expect(update.evidence).toContain(`Run recorded ${state}`)
  }
})

test('the states a worker reports for itself still release it, worded as before', () => {
  for (const state of ['completed', 'failed', 'cancelled']) {
    const [update] = terminalStepUpdates(quest(state))
    expect(update.status).toBe('pending')
    expect(update.evidence).toContain(`Worker ${state} without saving this step as done`)
  }
})

test('a step is not released while any run on it is still live', () => {
  const q = quest('stale')
  q.sessions.push({ callID: 'run-2', state: 'executing', deliverables: ['work'], evidence: [] })
  expect(terminalStepUpdates(q)).toEqual([])
})

test('a step that is not working is left alone', () => {
  expect(terminalStepUpdates(quest('stale', 'done'))).toEqual([])
  expect(terminalStepUpdates(quest('stale', 'pending'))).toEqual([])
})

test('a step recorded working that no run ever claimed is released, and says so', () => {
  const q = quest('completed')
  q.sessions = []
  const [update] = terminalStepUpdates(q)
  expect(update).toBeDefined()
  expect(update.status).toBe('pending')
  expect(update.evidence).toContain('no run on this Quest that ever claimed it')
})

test('a run on another step does not count as this one’s owner', () => {
  const q = quest('executing')
  q.sessions = [{ callID: 'run-1', state: 'executing', deliverables: ['something-else'], evidence: [] }]
  // The step has no owner of its own, so it is released rather than left waiting on unrelated work.
  expect(terminalStepUpdates(q)[0]?.status).toBe('pending')
})
