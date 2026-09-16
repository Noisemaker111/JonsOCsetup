/**
 * @core-prevents a run whose session the owning host no longer has from staying owned and re-inspected forever
 * @core-observed September 15: the running host had spawned 36,000 HTTP spans and was holding 112% of a core.
 * Fifteen dead worker sessions were being re-fetched about fifty times each, every one answering 404 and none
 * answering 200, because inspectWorker derived `missing` on each sweep and the reconcile loop only persisted an
 * observation that carried a host `outcome`. The steps those runs owned read "Owned by an active or unconfirmed
 * run" and could not be dispatched or handed back, and the git discovery each poll triggered starved the TUI
 * that Jon was typing into.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { physicalDirectory, projectIdentity } from '../quest/project'
import { QuestStore } from '../quest/store'
import { reconcileWorkers } from '../quest/worker-inspection'

test('a session the owning host cannot produce is recorded terminal and never polled again', async () => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-missing-session-')))
  const store = new QuestStore(root)
  const context: any = { sessionID: 'ses_giver', requestID: 'create', directory: root, project: projectIdentity(root) }

  const fetched: string[] = []
  const host = {
    get: async ({ sessionID }: any) => { fetched.push(sessionID); throw Object.assign(new Error('Not found'), { status: 404 }) },
  } as any

  const api = questsAPI(store, context, async () => ({ sessionID: 'unused' }))
  const created = api.create({ title: 'Worker died with its host', description: 'The host no longer holds the session this run was bound to.', steps: [{ id: 'report', title: 'Report the outcome' }] })
  store.apply(created.id, 'session-claimed', { callID: 'run-1', runID: 'run-1', sessionID: 'ses_dead', parentID: 'ses_giver', role: 'worker', deliverables: ['report'], attempt: 1 }, 'test')
  store.apply(created.id, 'session-state', { callID: 'run-1', state: 'executing' }, 'test')

  await reconcileWorkers(store, host, created.id)

  // The absence is saved, so the run stops owning the step and the Quest asks for a decision.
  const settled = store.read(created.id)!
  expect(settled.sessions.find((s) => s.callID === 'run-1')!.state).toBe('missing')
  expect(settled.state).toBe('Needs attention')

  // And the dead session is not fetched a second time: that repetition is the storm.
  const afterFirstSweep = fetched.length
  expect(afterFirstSweep).toBeGreaterThan(0)
  await reconcileWorkers(store, host, created.id)
  expect(fetched.length).toBe(afterFirstSweep)
})

test('an unreachable host keeps its run, because absence was never established', async () => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-unreachable-host-')))
  const store = new QuestStore(root)
  const context: any = { sessionID: 'ses_giver', requestID: 'create', directory: root, project: projectIdentity(root) }
  const host = { get: async () => { throw Object.assign(new Error('socket hang up'), { status: 503 }) } } as any

  const api = questsAPI(store, context, async () => ({ sessionID: 'unused' }))
  const created = api.create({ title: 'Host briefly unreachable', description: 'A transport failure is not evidence the session is gone.', steps: [{ id: 'report', title: 'Report the outcome' }] })
  store.apply(created.id, 'session-claimed', { callID: 'run-1', runID: 'run-1', sessionID: 'ses_live', parentID: 'ses_giver', role: 'worker', deliverables: ['report'], attempt: 1 }, 'test')
  store.apply(created.id, 'session-state', { callID: 'run-1', state: 'executing' }, 'test')

  await reconcileWorkers(store, host, created.id)

  expect(store.read(created.id)!.sessions.find((s) => s.callID === 'run-1')!.state).toBe('executing')
})
