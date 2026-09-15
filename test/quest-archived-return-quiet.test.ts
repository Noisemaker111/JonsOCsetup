/**
 * @core-prevents a turned-in Quest still waking the giver with an automatic worker update
 * @core-observed September 15: ten messages queued on the one Quest Giver conversation. Three were updates for
 * Quests already in state Archived, so each cost a turn to read a result for work the giver had already turned in.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { physicalDirectory, projectIdentity } from '../quest/project'
import { QuestStore } from '../quest/store'
import { QuestWorkerReturns } from '../quest/worker-returns'
import { runtimeQueuePath } from '../quest/runtime-queues'

test('an archived Quest settles its worker return instead of waking the giver', async () => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-archived-return-')))
  const store = new QuestStore(root)
  const giver = { id: 'ses_giver', agent: 'quest-giver', model: { providerID: 'provider', id: 'model' }, location: { directory: root } }
  const prompts: any[] = []
  const host = { get: async () => giver, prompt: async (input: any) => { prompts.push(input); return { id: input.id, sessionID: input.sessionID } } } as any
  const context: any = { sessionID: giver.id, requestID: 'create', directory: root, project: projectIdentity(root) }
  const returns = new QuestWorkerReturns(store, host, 'archived-test')
  try {
    const runID = 'c'.repeat(26)
    const api = questsAPI(store, context, async () => ({ sessionID: 'unused' }))
    const created = api.create({ title: 'Turned in before its worker returned', description: 'The result belongs on the Quest, not in a new turn.', steps: [{ id: 'report', title: 'Report the outcome' }] })
    await returns.watch({ quest: store.read(created.id)!, runID, stepIDs: ['report'], context } as any)
    store.apply(created.id, 'session-claimed', { callID: runID, runID, sessionID: 'ses_worker', parentID: giver.id, role: 'worker', deliverables: ['report'] }, 'test')
    store.apply(created.id, 'stage-state', { stageID: 'report', status: 'done', evidence: 'worker finished' }, 'test')
    store.apply(created.id, 'session-state', { callID: runID, state: 'completed', result: 'worker completed' }, 'test')
    api.update(created.id, { archive: { accepted: true } })
    expect(store.read(created.id)!.state).toBe('Archived')

    await returns.tick()

    expect(prompts).toHaveLength(0)
    const queue = runtimeQueuePath(store.runtime, 'worker-returns', 'archived-test')
    const row = JSON.parse(readFileSync(join(queue, readdirSync(queue)[0]), 'utf8'))
    expect(row.state).toBe('accepted')
    expect(row.settled).toContain('archived')
    // The result itself is untouched: the return was only ever a routing summary.
    expect(api.get(created.id).steps[0].state).toBe('done')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
