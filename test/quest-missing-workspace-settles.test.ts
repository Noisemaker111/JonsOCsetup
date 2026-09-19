/**
 * @core-prevents a run whose workspace directory was deleted under it owning its step forever
 * @core-observed September 16: run 44939757780991801b3b769b22 on "Explain OpenCode2 updates" was recorded
 * executing in a research workspace inside release dev-3e56492813da-1789343593806, which retirement had since
 * removed. The host threw PlatformError NotFound FileSystem.realPath starting a process there 236 times in a
 * four-minute window, inspectWorker read that as `unreachable` rather than a 404 so nothing settled it, and the
 * Quest sat with all three steps done refusing to archive with ACTIVE_RUNS.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
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
  const created = api.create({ title: 'Worker workspace removed under it', description: 'The release the run worked in was retired while the run was still recorded executing.', steps: [{ id: 'report', title: 'Report the outcome' }] })
  return { store, id: created.id }
}

test('a run whose recorded workspace is gone is settled without asking the host', async () => {
  const { store, id } = quest('quest-missing-workspace-')
  const workspace = physicalDirectory(mkdtempSync(join(tmpdir(), 'retired-release-')))
  let asked = 0
  const host = { get: async () => { asked++; throw Object.assign(new Error('NotFound: FileSystem.realPath'), {}) } } as any

  store.apply(id, 'session-claimed', { callID: 'run-1', runID: 'run-1', sessionID: 'ses_worker', parentID: 'ses_giver', role: 'worker', deliverables: ['report'], attempt: 1, scope: { worktree: workspace, workspaceMode: 'research' } }, 'test')
  store.apply(id, 'session-state', { callID: 'run-1', state: 'executing' }, 'test')
  rmSync(workspace, { recursive: true, force: true })

  await reconcileWorkers(store, host, id)

  const run = store.read(id)!.sessions.find((s) => s.callID === 'run-1')!
  expect(run.state).toBe('stale')
  // The directory is gone; there is nothing the host could add, and asking is what looped.
  expect(asked).toBe(0)
})

test('a run whose workspace still exists is left to the host to judge', async () => {
  const { store, id } = quest('quest-live-workspace-')
  const workspace = physicalDirectory(mkdtempSync(join(tmpdir(), 'live-worktree-')))
  const host = { get: async ({ sessionID }: any) => ({ id: sessionID, time: {}, model: {} }) } as any

  store.apply(id, 'session-claimed', { callID: 'run-1', runID: 'run-1', sessionID: 'ses_worker', parentID: 'ses_giver', role: 'worker', deliverables: ['report'], attempt: 1, scope: { worktree: workspace, workspaceMode: 'worktree' } }, 'test')
  store.apply(id, 'session-state', { callID: 'run-1', state: 'executing' }, 'test')

  await reconcileWorkers(store, host, id)

  expect(store.read(id)!.sessions.find((s) => s.callID === 'run-1')!.state).toBe('executing')
})
