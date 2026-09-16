/**
 * @core-prevents a continuation holding "running" over a run reconciliation already settled
 * @core-observed September 16: after a restart, continuation b8f6f234609caf2725a2e55e59 on "Consolidate
 * remaining runtime and UI ownership" stayed running with reason "Confirmed worker/command launch" while its
 * run had been settled stale by reconciliation. The step read pending and never became ready, so eight
 * dispatches reported running and the board produced no model request at all for twenty-two minutes.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { QuestContinuation } from '../quest/continuation'
import { physicalDirectory, projectIdentity } from '../quest/project'
import { runtimeQueuePath } from '../quest/runtime-queues'
import { QuestStore } from '../quest/store'
import { TERMINAL_RUN } from '../quest/session-lineage'

async function board(runState: string) {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-cont-terminal-')))
  const store = new QuestStore(root)
  const project = projectIdentity(root)
  const context: any = { sessionID: 'ses_giver', requestID: 'create', directory: root, project }
  const description = 'The run behind this continuation was settled by reconciliation, not by the worker.'
  const created = questsAPI(store, context, async () => ({ sessionID: 'unused' }))
    .create({ title: 'Its continuation outlived the run', description, steps: [{ id: 'work', title: 'Do the work' }] })

  store.apply(created.id, 'session-claimed', { callID: 'run-1', runID: 'run-1', sessionID: 'ses_w', parentID: 'ses_giver', role: 'worker', deliverables: ['work'], attempt: 1 }, 'test')
  store.apply(created.id, 'session-state', { callID: 'run-1', state: runState, result: 'settled by reconciliation' }, 'test')

  const quest = store.read(created.id)!
  const intent = {
    id: 'cont-1', questID: created.id, description, context, maxConcurrent: 1,
    steps: quest.stages.map(s => ({ id: s.id, title: s.title, detail: s.detail, needs: s.needs })),
    state: 'running', attempt: 0, refreshes: 0, nextAt: 0, reason: 'Confirmed worker/command launch',
    admissions: [{ stepID: 'work', requestID: 'req-1', runID: 'run-1', state: 'running', attempt: 1, refreshes: 0, nextAt: 0, reason: 'Confirmed worker/command launch' }],
  }
  writeFileSync(runtimeQueuePath(store.runtime, 'continuations', undefined, '.json'), JSON.stringify([intent]))

  const continuation = new QuestContinuation(store, (async () => ({ sessionID: 'unused' })) as any, { now: () => Date.now() })
  await continuation.tick()
  return continuation.read().find(r => r.id === 'cont-1')!
}

test('a run settled stale by reconciliation ends its admission', async () => {
  const row = await board('stale')
  expect(row.admissions![0].state).not.toBe('running')
})

test('a run the worker completed still ends its admission, as before', async () => {
  const row = await board('completed')
  expect(row.admissions![0].state).not.toBe('running')
})

test('a run still executing keeps its admission running', async () => {
  const row = await board('executing')
  expect(row.admissions![0].state).toBe('running')
})

test('the canonical terminal set is what reconciliation writes', () => {
  for (const settled of ['completed', 'failed', 'cancelled', 'missing', 'stale']) expect(TERMINAL_RUN.has(settled)).toBe(true)
  for (const live of ['planned', 'executing', 'waiting', 'blocked']) expect(TERMINAL_RUN.has(live)).toBe(false)
})
