/**
 * @core-prevents a planned run that never bound a session waiting on an admission nobody will make
 * @core-observed September 16: run 027372c447e9335efb43ad5ccb on "Measure model efficiency and route Quests
 * from real session evidence" was planned on 2026-09-15T00:53 against cliproxyapi/gpt-5.6-luna#max, the route
 * whose account was exhausted, and never bound a session. It left no preflight receipt, so interruptedPreflight
 * could not settle it, and it held the measure step for 29 hours. The giver had already recorded the gap:
 * "do not retry until the runtime can terminalize a sessionless pre-reboot planned run."
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { physicalDirectory } from '../quest/project'
import { reconcileWorkers } from '../quest/worker-inspection'

const host = { get: async () => { throw new Error('a run with no session cannot be asked about') } } as any

/** A store holding one run, recording what reconciliation writes back to it. */
function storeWith(run: Record<string, unknown>) {
  const runtime = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-unadmitted-')))
  const applied: Array<{ kind: string; payload: any; actor: string }> = []
  const quest = {
    id: 'q', state: 'Working', title: 'Planned against a route that never admitted it', description: 'd',
    stages: [{ id: 'measure', title: 'Measure the thing', status: 'working', needs: [], todos: [], proofs: [], attempt: 1, claim: { repos: [], include: [], exclude: [] } }],
    sessions: [{ callID: 'run-1', runID: 'run-1', role: 'worker', agentRole: 'worker', deliverables: ['measure'], attempt: 1, evidence: [], ...run }],
    unresolvedWork: [], evidence: { tests: [], commits: [], builds: [], publish: [], artifacts: [] }, extensions: {},
  }
  const store: any = {
    runtime, projectRoot: runtime,
    read: () => quest,
    apply: (_id: string, kind: string, payload: any, actor: string) => { applied.push({ kind, payload, actor }); return quest },
  }
  return { store, applied }
}

const settledStale = (applied: Array<{ kind: string; payload: any; actor: string }>) =>
  applied.find(a => a.kind === 'session-state' && a.payload.state === 'stale')

test('a planned run from before this host started stops owning its step', async () => {
  const stale = new Date(Date.now() - 29 * 60 * 60 * 1000).toISOString()
  const { store, applied } = storeWith({ state: 'planned', updatedAt: stale, model: 'cliproxyapi/gpt-5.6-luna#max' })

  await reconcileWorkers(store, host, 'q')

  const settle = settledStale(applied)
  expect(settle).toBeDefined()
  expect(settle!.actor).toBe('quest:unadmitted-plan')
  expect(String(settle!.payload.result)).toContain(stale)
})

test('a planned run this host recorded is left alone, its admission still pending', async () => {
  const { store, applied } = storeWith({ state: 'planned', updatedAt: new Date().toISOString() })

  await reconcileWorkers(store, host, 'q')

  expect(settledStale(applied)).toBeUndefined()
})

test('an old planned run that did bind a session is settled too, by the host that ended under it', async () => {
  // Written first as "the host's to judge, not the clock's", which was too broad: the host cannot
  // judge it. There is no terminal outcome and no execution event, and the process that would have
  // run it is gone, so it settles as an execution lost with its host rather than as an unadmitted
  // plan. Either way it stops owning the step, which is the point.
  const stale = new Date(Date.now() - 29 * 60 * 60 * 1000).toISOString()
  const { store, applied } = storeWith({ state: 'planned', updatedAt: stale, sessionID: 'ses_bound', openCodeSessionId: 'ses_bound' })

  await reconcileWorkers(store, host, 'q')

  const settle = applied.find(a => a.kind === 'session-state' && a.payload.state === 'stale')
  expect(settle).toBeDefined()
  expect(settle!.actor).toBe('quest:execution-lost-with-host')
})
