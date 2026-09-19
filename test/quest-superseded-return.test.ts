/**
 * @core-prevents a superseded attempt's worker return still waking the giver
 * @core-observed September 15: eleven of twelve messages queued on the one Quest Giver conversation were
 * no longer true when read - "Dispatch owner 10076 exited", "Dispatch owner 27212 exited" and three copies
 * of one quota error whose pool had since reset. Each still cost a turn over a 192K-token context.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { physicalDirectory, projectIdentity } from '../quest/project'
import { QuestStore } from '../quest/store'
import { QuestWorkerReturns } from '../quest/worker-returns'
import { runtimeQueuePath } from '../quest/runtime-queues'

test('a retried attempt settles the earlier return and delivers only the live one', async () => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-superseded-')))
  const store = new QuestStore(root)
  const giver = { id: 'ses_giver', agent: 'quest-giver', model: { providerID: 'provider', id: 'model' }, location: { directory: root } }
  const prompts: any[] = []
  const host = { get: async () => giver, prompt: async (input: any) => { prompts.push(input); return { id: input.id, sessionID: input.sessionID } } } as any
  const context: any = { sessionID: giver.id, requestID: 'create', directory: root, project: projectIdentity(root) }
  const returns = new QuestWorkerReturns(store, host, 'superseded-test')
  try {
    const first = 'a'.repeat(26), second = 'b'.repeat(26)
    const api = questsAPI(store, context, async () => ({ sessionID: 'unused' }))
    const created = api.create({ title: 'Retry after an interrupted host', description: 'The first attempt died with its host; the second is the live one.', steps: [{ id: 'report', title: 'Report the outcome' }] })
    const quest = store.read(created.id)!

    // Attempt 1: claimed, then failed the way an exited host leaves it.
    await returns.watch({ quest, runID: first, stepIDs: ['report'], context } as any)
    store.apply(created.id, 'session-claimed', { callID: first, runID: first, sessionID: 'ses_worker_1', parentID: giver.id, role: 'worker', deliverables: ['report'], attempt: 1 }, 'test')
    store.apply(created.id, 'session-state', { callID: first, state: 'failed', result: 'Dispatch owner exited during prompting' }, 'test')

    // Attempt 2 of the same lineage: the giver already knows, because it dispatched this.
    await returns.watch({ quest: store.read(created.id)!, runID: second, stepIDs: ['report'], context } as any)
    store.apply(created.id, 'session-claimed', { callID: second, runID: second, sessionID: 'ses_worker_2', parentID: giver.id, role: 'worker', deliverables: ['report'], resumedFrom: first, resumeRoot: first, attempt: 2 }, 'test')
    store.apply(created.id, 'stage-state', { stageID: 'report', status: 'done', evidence: 'second attempt finished' }, 'test')
    store.apply(created.id, 'session-state', { callID: second, state: 'completed', result: 'second attempt completed' }, 'test')

    await returns.tick()

    // Exactly one wake, for the attempt that is still live work.
    expect(prompts).toHaveLength(1)
    expect(prompts[0].metadata.runID).toBe(second)

    const queue = runtimeQueuePath(store.runtime, 'worker-returns', 'superseded-test')
    const rows = Object.fromEntries(readdirSync(queue).map(name => {
      const row = JSON.parse(readFileSync(join(queue, name), 'utf8'))
      return [row.runID, row]
    }))
    expect(rows[first].state).toBe('accepted')
    expect(rows[first].settled).toContain('Superseded')
    // The superseded outcome is not lost: it stays on the Quest in the lineage history.
    expect(api.get(created.id).runs.flatMap((r: any) => r.history.map((h: any) => h.id))).toContain(first)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
