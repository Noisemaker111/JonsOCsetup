/**
 * @core-prevents a Quest poll stopping for as long as an unanswered host read takes, because the read carries no deadline
 * @core-observed September 17, 02:40 UTC: the dev host's own `/health`, which reads one small JSON file,
 * answered in 13.0, 15.8, 18.5, 13.1, 14.9, 40.7, 32.8 and 21.6 seconds across eight probes two seconds
 * apart, and its log showed the giver's `quests` MCP calls timing out after 344,068 ms. The worker-return
 * delivery poll read the giver's session row on every tick with no deadline at all, so on that host the
 * five-second poll was not advancing and terminal results were not being delivered.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestStore } from '../quest/store'
import { physicalDirectory } from '../quest/project'
import { QuestWorkerReturns } from '../quest/worker-returns'

test('a host that never answers does not stop the worker-return pass', async () => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-read-deadline-')))
  const store = new QuestStore(root)
  const quest = store.create({ id: 'd'.repeat(26), title: 'Its result is waiting to be delivered', objective: 'o', description: 'd' })
  store.apply(quest.id, 'stage-state', { id: 'work', title: 'Do it', detail: 'detail', status: 'working' }, 'test')
  store.apply(quest.id, 'session-claimed', { callID: 'run-1', runID: 'run-1', sessionID: 'ses_worker', parentID: 'ses_giver', role: 'worker', deliverables: ['work'] }, 'test')
  store.apply(quest.id, 'session-state', { callID: 'run-1', state: 'completed', result: 'Finished' }, 'test')

  let prompts = 0
  const answered: string[] = []
  // Accepts the read and never answers it — what a saturated host looks like from here.
  const host: any = {
    get: ({ sessionID }: any, options: any) => new Promise((_resolve, reject) => {
      answered.push(sessionID)
      options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    }),
    prompt: async () => { prompts++; return { id: 'msg' } },
  }
  const returns = new QuestWorkerReturns(store, host)
  // The receipt the dispatcher leaves behind, written through the same path a real run uses.
  const watching = returns.watch({ quest, runID: 'run-1', stepIDs: ['work'], context: { sessionID: 'ses_giver', project: { id: 'p', root }, directory: root, requestID: 'r' } } as any)
  await expect(watching).rejects.toThrow(/timed out/)

  store.apply(quest.id, 'session-state', { callID: 'run-1', state: 'executing' }, 'test')
  store.apply(quest.id, 'session-state', { callID: 'run-1', state: 'completed', result: 'Finished' }, 'test')
  await returns.watch({ quest, runID: 'run-1', stepIDs: ['work'], context: { sessionID: 'ses_giver', project: { id: 'p', root }, directory: root, requestID: 'r' } } as any)
    .catch(() => {})

  const started = Date.now()
  await returns.tick()
  const elapsed = Date.now() - started
  // The read is bounded, so the pass ends; without a deadline this never returned.
  expect(elapsed).toBeLessThan(30_000)
  expect(answered.length).toBeGreaterThan(0)
  // Nothing was delivered on an unread giver, and nothing was marked accepted.
  expect(prompts).toBe(0)
})
