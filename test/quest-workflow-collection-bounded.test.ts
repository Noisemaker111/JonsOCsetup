/**
 * @core-prevents workflow attribution replaying every Quest's journal and reopening the telemetry ledger once per registration
 * @core-observed September 17: collecting workflow outcomes cost 1,273 ms on the live files and ran on
 * every five-second sweep and at the end of every Quest API call, on the same host thread whose saturation
 * made /health answer in 13 to 40 seconds. Traced after the first repair: 683 ms of the remaining 683 ms
 * was `store.read` replaying the journals of the 27 Quests behind its unsettled registrations — one of
 * them 2.2 MB — while every session query against the 90 MB telemetry ledger together took 2 ms.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const QUESTS = 4

/**
 * The telemetry file names are read once, when the module loads, so this test points them at a temporary
 * directory before importing anything that captures them. Nothing here touches the real ones.
 */
async function isolated(root: string) {
  process.env.OPENCODE_TELEMETRY_FILE = join(root, 'requests.jsonl')
  process.env.OPENCODE_PASSIVE_LEDGER_FILE = join(root, 'requests.jsonl.ledger.sqlite')
  process.env.OPENCODE_WORKFLOW_OUTCOMES_FILE = join(root, 'requests.jsonl.workflows.json')
  return {
    ...(await import('../quest/store')),
    ...(await import('../quest/index')),
    ...(await import('../quest/outcome-tracking')),
    ...(await import('../usage/telemetry-api')),
    ...(await import('../usage/passive-ledger')),
    ...(await import('../quest/project')),
  }
}

test('a collection reads no Quest journal and asks the telemetry ledger once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'quest-collect-'))
  const api: any = await isolated(root)
  const store = new api.QuestStore(api.physicalDirectory(root))
  api.clearQuestParseCache()

  const ids: string[] = []
  for (let i = 0; i < QUESTS; i++) {
    const quest = store.create({ id: String(i).padStart(26, 'e'), title: 'Attributed work ' + i, objective: 'o', description: 'd' })
    store.apply(quest.id, 'stage-state', { id: 'work', title: 'Do it', detail: 'detail', status: 'working' }, 'test')
    store.apply(quest.id, 'session-claimed', { callID: 'run-' + i, runID: 'run-' + i, sessionID: 'ses_worker' + i, parentID: 'ses_giver', role: 'worker', deliverables: ['work'] }, 'test')
    store.apply(quest.id, 'session-state', { callID: 'run-' + i, state: i === 0 ? 'completed' : 'executing', ...(i === 0 ? { result: 'Finished' } : {}) }, 'test')
    ids.push(quest.id)
  }
  // Registration goes through the production path the dispatcher uses.
  for (const [index, id] of ids.entries()) {
    await api.trackedStart(store, async () => ({}))({
      quest: store.read(id), runID: 'run-' + index, stepIDs: ['work'], task: 'coding', readOnly: false,
      context: { sessionID: 'ses_giver', project: { id: 'p', root }, directory: root, requestID: 'r' + index },
    })
  }

  const reads: string[] = []
  const real = store.read.bind(store)
  store.read = (id: string) => { reads.push(id); return real(id) }

  const asked: string[] = []
  const result = api.collectWorkflowOutcomes(store, { rows: (sessionID: string) => { asked.push(sessionID); return [] } })

  // The journal replay is the whole cost, and nothing here needs it: the Markdown record that
  // QuestStore.apply keeps current carries every run state and session this reads.
  expect(reads).toHaveLength(0)
  expect(result.diagnostics).toHaveLength(0)
  // Only the runs with something left to measure are asked about; the finished one settled at
  // registration and is not asked again.
  expect(asked).not.toContain('ses_worker0')
  expect(asked.sort()).toEqual(['ses_worker1', 'ses_worker2', 'ses_worker3'])

  const outcomes = api.readWorkflowOutcomes(process.env.OPENCODE_WORKFLOW_OUTCOMES_FILE!).runs
  expect(outcomes.find((r: any) => r.runID === 'run-0')?.observation?.state).toBe('completed')
  // A settled run drops out of the worklist, so the collection stays the length of the work outstanding.
  const tracked = JSON.parse(readFileSync(join(store.runtime, 'workflow-tracking.json'), 'utf8'))
  expect(tracked.runs.map((r: any) => r.runID)).not.toContain('run-0')
  expect(tracked.runs).toHaveLength(QUESTS - 1)
  rmSync(root, { recursive: true, force: true })
})

test('the telemetry ledger answers a whole collection on one connection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'quest-batch-'))
  const api: any = await isolated(root)
  const file = join(root, 'batch.ledger.sqlite')
  const at = Date.now() - 1000
  const request = (id: string, sessionID: string) => ({
    id, sessionID, startedAt: at, completedAt: at, recordedAt: at, kind: 'primary', state: 'completed',
    route: { providerID: 'p', modelID: 'm', reasoning: 'high', harness: 'native', serviceTier: 'default' },
    tokens: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0 }, outputTotal: 1,
  })
  // A missing file still answers once per query, in the order asked.
  expect(api.readSessionLedgerRowsBatch([{ sessionID: 'ses_a', from: 0, to: Date.now() }], file)).toEqual([[]])
  for (const [id, session] of [['a1', 'ses_a'], ['b1', 'ses_b'], ['b2', 'ses_b']]) api.recordLedgerRequest(request(id, session), file)

  const answers = api.readSessionLedgerRowsBatch([
    { sessionID: 'ses_b', from: 0, to: Date.now() },
    { sessionID: 'ses_a', from: 0, to: Date.now() },
    { sessionID: 'ses_a', from: at + 1, to: Date.now() },
  ], file)
  expect(answers.map((rows: any[]) => rows.length)).toEqual([2, 1, 0])
  expect(answers[1][0].sessionID).toBe('ses_a')
  expect(() => api.readSessionLedgerRowsBatch([{ sessionID: 'ses_a', from: 10, to: 1 }], file)).toThrow('Invalid session ledger query')
  rmSync(root, { recursive: true, force: true })
})
