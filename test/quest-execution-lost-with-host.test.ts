/**
 * @core-prevents a run recorded executing across a host restart holding its step with nothing running
 * @core-observed September 16: after a restart, six runs stayed recorded executing with intact worktrees and
 * the board did nothing for twenty-three minutes — no model request at all. A native execution lives in the
 * host process, so it stopped with the host, but the session row and the worktree both survived: the session
 * settle needs a 404, the workspace settle needs a missing directory, the lease settle needs an external
 * harness, and observeWorker answered `unknown`, which nothing settled.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { physicalDirectory } from '../quest/project'
import { reconcileWorkers } from '../quest/worker-inspection'

/** The host still has the session and reports no terminal outcome: exactly the surviving-row case. */
const host = { get: async ({ sessionID }: any) => ({ id: sessionID, time: {}, model: {} }) } as any

function storeWith(run: Record<string, unknown>) {
  const runtime = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-lost-exec-')))
  const workspace = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-lost-exec-tree-')))
  const applied: Array<{ kind: string; payload: any; actor: string }> = []
  const quest = {
    id: 'q', state: 'Working', title: 'Its worker died with the host', description: 'd',
    stages: [{ id: 'work', title: 'Do the work', status: 'working', needs: [], todos: [], proofs: [], attempt: 1, claim: { repos: [], include: [], exclude: [] } }],
    sessions: [{ callID: 'run-1', runID: 'run-1', role: 'worker', agentRole: 'worker', deliverables: ['work'], attempt: 1, evidence: [], scope: { worktree: workspace }, ...run }],
    unresolvedWork: [], evidence: { tests: [], commits: [], builds: [], publish: [], artifacts: [] }, extensions: {},
  }
  const store: any = {
    runtime, projectRoot: runtime,
    read: () => quest,
    apply: (_id: string, kind: string, payload: any, actor: string) => { applied.push({ kind, payload, actor }); return quest },
  }
  return { store, applied, workspace }
}

const lostSettle = (applied: Array<{ kind: string; payload: any; actor: string }>) =>
  applied.find(a => a.kind === 'session-state' && a.actor === 'quest:execution-lost-with-host')

test('a run executing since before this host started stops owning its step', async () => {
  const before = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { store, applied } = storeWith({ state: 'executing', updatedAt: before, sessionID: 'ses_survivor', openCodeSessionId: 'ses_survivor' })

  await reconcileWorkers(store, host, 'q')

  const settle = lostSettle(applied)
  expect(settle).toBeDefined()
  expect(settle!.payload.state).toBe('stale')
  // The work on disk is not the thing that ended, so it is not what gets cleaned up here.
  expect(String(settle!.payload.result)).toContain('workspace is untouched')
})

test('a run this host started keeps its step', async () => {
  const { store, applied } = storeWith({ state: 'executing', updatedAt: new Date().toISOString(), sessionID: 'ses_live', openCodeSessionId: 'ses_live' })

  await reconcileWorkers(store, host, 'q')

  expect(lostSettle(applied)).toBeUndefined()
})

test('an external run is left to its lease, not to this host’s lifetime', async () => {
  const before = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { store, applied } = storeWith({ state: 'executing', updatedAt: before, harness: 'codex', leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() })

  await reconcileWorkers(store, host, 'q')

  // It never ran in this process, so this process ending says nothing about it.
  expect(lostSettle(applied)).toBeUndefined()
})
