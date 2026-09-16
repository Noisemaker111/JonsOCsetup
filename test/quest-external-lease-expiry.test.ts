/**
 * @core-prevents an external harness run holding its step forever after it stopped renewing its lease
 * @core-observed September 16: two Codex runs recorded executing on September 13, callIDs
 * step:verify-public-controls-persistence and step:complete-a-substantial-existing, with leases that had
 * expired 59 and 73 hours earlier. inspectWorker answers `external` for a run on another harness because no
 * native session exists to ask about, and nothing read leaseExpiresAt back, so both still owned their steps.
 * "Create, run and deliver Quests without redundant agent work" had all three steps done and refused to
 * archive with ACTIVE_RUNS.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { physicalDirectory, projectIdentity } from '../quest/project'
import { QuestStore } from '../quest/store'
import { reconcileWorkers } from '../quest/worker-inspection'

function quest(prefix: string) {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), prefix)))
  const store = new QuestStore(root)
  const context: any = { sessionID: 'ses_giver', requestID: 'create', directory: root, project: projectIdentity(root) }
  const api = questsAPI(store, context, async () => ({ sessionID: 'unused' }))
  const created = api.create({ title: 'Work dispatched to another harness', description: 'A Codex run executes outside this host, so its lease is the only liveness signal.', steps: [{ id: 'report', title: 'Report the outcome' }] })
  return { store, id: created.id }
}

const host = { get: async () => { throw new Error('an external run has no native session to ask about') } } as any

test('an external run whose lease has expired stops owning its step', async () => {
  const { store, id } = quest('quest-lease-expired-')
  const expired = new Date(Date.now() - 59 * 60 * 60 * 1000).toISOString()

  store.apply(id, 'session-claimed', { callID: 'step:report', role: 'codex', harness: 'codex', deliverables: ['report'], attempt: 1 }, 'test')
  store.apply(id, 'session-state', { callID: 'step:report', state: 'executing', heartbeatAt: expired, leaseExpiresAt: expired }, 'test')

  await reconcileWorkers(store, host, id)

  expect(store.read(id)!.sessions.find((s) => s.callID === 'step:report')!.state).toBe('stale')
})

test('an external run still renewing its lease keeps its step', async () => {
  const { store, id } = quest('quest-lease-live-')
  const soon = new Date(Date.now() + 60_000).toISOString()

  store.apply(id, 'session-claimed', { callID: 'step:report', role: 'codex', harness: 'codex', deliverables: ['report'], attempt: 1 }, 'test')
  store.apply(id, 'session-state', { callID: 'step:report', state: 'executing', heartbeatAt: new Date().toISOString(), leaseExpiresAt: soon }, 'test')

  await reconcileWorkers(store, host, id)

  expect(store.read(id)!.sessions.find((s) => s.callID === 'step:report')!.state).toBe('executing')
})

test('an external run that never recorded a lease is left alone', async () => {
  // No lease is not an expired lease; there is nothing to conclude from it.
  const { store, id } = quest('quest-lease-absent-')

  store.apply(id, 'session-claimed', { callID: 'step:report', role: 'codex', harness: 'codex', deliverables: ['report'], attempt: 1 }, 'test')
  store.apply(id, 'session-state', { callID: 'step:report', state: 'executing' }, 'test')

  await reconcileWorkers(store, host, id)

  expect(store.read(id)!.sessions.find((s) => s.callID === 'step:report')!.state).toBe('executing')
})
