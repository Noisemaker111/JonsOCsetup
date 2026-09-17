/**
 * @core-prevents the shared-workspace guard deriving the whole Quest ledger again for every tool call in every session
 * @core-observed September 17: the guard wraps every tool of every session and derived the ledger three
 * separate times per call — once for the read-only research scope, once for the membership, once inside
 * assertSharedAssignment — each pass re-running normalizeState over all 110 records. Measured against a copy
 * of the live ledger that was 7.7 ms of the host's JS thread before every read, edit, shell and Quest call,
 * on the same thread whose saturation made /health answer in 13 to 40 seconds.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestStore } from '../quest/store'
import { clearQuestParseCache, readQuestLedger } from '../quest/index'
import { questMemberships } from '../quest/shared-guard'
import { createQuestService } from '../quest/service'

function ledger() {
  const root = mkdtempSync(join(tmpdir(), 'quest-toolcall-'))
  const store = new QuestStore(root)
  clearQuestParseCache()
  const q = store.create({ id: 'c'.repeat(26), title: 'Assigned work', objective: 'o', description: 'd' })
  store.apply(q.id, 'stage-state', { id: 'work', title: 'Do it', detail: 'detail', status: 'working' }, 'test')
  store.apply(q.id, 'session-planned', { callID: 'run-1', runID: 'run-1', role: 'worker', agentRole: 'worker', deliverables: ['work'] }, 'test')
  store.apply(q.id, 'session-bound', { callID: 'run-1', sessionID: 'ses_theWorker', openCodeSessionId: 'ses_theWorker' }, 'test')
  store.apply(q.id, 'session-state', { callID: 'run-1', state: 'executing' }, 'test')
  return { store, questID: q.id }
}

test('an unchanged ledger is derived once, however many tool calls ask it', () => {
  const { store, questID } = ledger()

  const first = readQuestLedger(store.projectRoot, { includeArchived: true })
  const second = readQuestLedger(store.projectRoot, { includeArchived: true })
  expect(second.fingerprint).toBe(first.fingerprint)
  // The same record object, not an equal one: a second derivation would have produced new conclusions
  // on a fresh parse, and re-running the derivation is the cost this guards.
  expect(second.rows[0].quest).toBe(first.rows[0].quest)

  // What every guarded tool call asks. The membership index is rebuilt only when the fingerprint moves.
  const a = questMemberships(store, 'ses_theWorker')
  const b = questMemberships(store, 'ses_theWorker')
  expect(b).toBe(a)
  expect(a).toHaveLength(1)
  expect(a[0].quest.id).toBe(questID)
  expect(a[0].run.runID).toBe('run-1')

  // A session belonging to no Quest — the giver's own, and most tool calls — answers from the same index.
  expect(questMemberships(store, 'ses_aStranger')).toHaveLength(0)
})

test('a Quest written between two tool calls is seen by the second one', () => {
  const { store, questID } = ledger()
  expect(questMemberships(store, 'ses_theWorker')[0].run.state).toBe('executing')

  store.apply(questID, 'session-state', { callID: 'run-1', state: 'completed', result: 'done' }, 'test')

  const after = questMemberships(store, 'ses_theWorker')
  expect(after[0].run.state).toBe('completed')
  expect(readQuestLedger(store.projectRoot, { includeArchived: true }).rows[0].quest!.sessions[0].state).toBe('completed')
})

test('the archived view and the active view do not share one derivation', () => {
  const { store } = ledger()
  const archived = readQuestLedger(store.projectRoot, { includeArchived: true })
  const active = readQuestLedger(store.projectRoot)
  expect(active.fingerprint).not.toBe(archived.fingerprint)
  expect(active.rows).toHaveLength(1)
})

/**
 * A listing is the most-repeated Quest API call there is: the board, the footer, the giver's own
 * inventory and `quest list` all make it. It read each Quest's journal-backed record twice per row.
 */
test('a listing reads each Quest once, not once per projection', async () => {
  const { store } = ledger()
  for (const n of [1, 2]) {
    const q = store.create({ id: String(n).repeat(26), title: 'More work ' + n, objective: 'o', description: 'd' })
    store.apply(q.id, 'stage-state', { id: 'work', title: 'Do it', detail: 'detail', status: 'pending' }, 'test')
  }
  const host: any = { get: async ({ sessionID }: any) => ({ id: sessionID, agent: 'quest-giver', location: { directory: store.projectRoot } }), active: async () => ({ data: {} }) }
  let dispose = () => {}
  const service = createQuestService(store, host, { directory: store.projectRoot, onDispose: (fn: any) => { dispose = fn }, startRun: async () => { throw Error('No dispatch') } })
  try {
    const reads: string[] = []
    const real = store.read.bind(store)
    ;(store as any).read = (id: string) => { reads.push(id); return real(id) }

    const listing = await service.call('list', { allProjects: true }, { sessionID: 'ses_giver', id: 'list-1' })
    expect(listing.items.length).toBe(3)
    expect(reads.length).toBe(listing.items.length)
    expect(new Set(reads).size).toBe(listing.items.length)
  } finally { dispose() }
})
