/**
 * @core-prevents the five-second Quest sweep walking archived records and loading every worker session's whole message history
 * @core-observed September 17, 02:40 UTC: the dev host sat at 94-99% CPU with 4.2 GB resident and its trivial
 * /health answered in 13 to 40 seconds. Each five-second sweep walked all 110 records including the 88
 * archived, and for each of the 15 runs it called host.get, host.active and host.context — the session's
 * entire message history — so the host log filled with `InterruptError: All fibers interrupted` from the
 * five-second abort. One tick measured 5,891 ms of CPU against a copy of that ledger, on a 5,000 ms timer,
 * and `quest list` from the installed CLI answered UNAVAILABLE.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestStore } from '../quest/store'
import { clearQuestParseCache } from '../quest/index'
import { reconcileWorkers } from '../quest/worker-inspection'
import { serializeQuestMarkdown } from '../quest/cst'
import { newQuest } from '../quest/schema'

const ACTIVE = 4, ARCHIVED = 12

/** A host that answers the two liveness questions and records every call it is asked. */
function countingHost(idle: Record<string, { outcome: string; idleAt: number }>) {
  const calls: Record<string, number> = { get: 0, active: 0, context: 0 }
  const asked = new Set<string>()
  return {
    calls, asked,
    get: async ({ sessionID }: any) => {
      calls.get++; asked.add(sessionID)
      const settled = idle[sessionID]
      return { id: sessionID, time: { updated: Date.now() - 600_000, ...(settled ? { idle: settled.idleAt } : {}) }, ...(settled ? { outcome: settled.outcome } : {}), model: {} }
    },
    active: async () => { calls.active++; return {} },
    context: async () => { calls.context++; return [] },
  } as any
}

function ledgerWith() {
  const root = mkdtempSync(join(tmpdir(), 'quest-sweep-'))
  const store = new QuestStore(root)
  clearQuestParseCache()
  const activeIDs: string[] = []
  for (let i = 0; i < ACTIVE; i++) {
    const q = store.create({ id: String(i).padStart(26, 'a'), title: 'Active work ' + i, objective: 'o', description: 'd' })
    store.apply(q.id, 'stage-state', { id: 'work', title: 'Do it', detail: 'detail', status: 'working' }, 'test')
    store.apply(q.id, 'session-planned', { callID: 'run-' + i, runID: 'run-' + i, role: 'worker', agentRole: 'worker', deliverables: ['work'] }, 'test')
    store.apply(q.id, 'session-bound', { callID: 'run-' + i, sessionID: 'ses_worker' + i, openCodeSessionId: 'ses_worker' + i }, 'test')
    store.apply(q.id, 'session-state', { callID: 'run-' + i, state: 'executing' }, 'test')
    activeIDs.push(q.id)
  }
  // Archived records live in date folders under quests-archive/, which is where the ledger reader finds
  // them. Writing them there is exactly the shape turn-in leaves behind.
  const archive = join(root, '.opencode', 'quests-archive', '2026-09-01')
  mkdirSync(archive, { recursive: true })
  for (let i = 0; i < ARCHIVED; i++) {
    const q = newQuest({ id: String(i).padStart(26, 'b'), title: 'Turned in ' + i, objective: 'o', description: 'd' })
    q.state = 'Archived'
    q.sessions = [{ callID: 'old-' + i, runID: 'old-' + i, role: 'worker', agentRole: 'worker', deliverables: [], attempt: 1, evidence: [], state: 'executing', updatedAt: new Date().toISOString(), sessionID: 'ses_archived' + i, openCodeSessionId: 'ses_archived' + i } as any]
    writeFileSync(join(archive, q.id + '--turned-in.md'), serializeQuestMarkdown(q, ''))
  }
  return { store, activeIDs }
}

test('one sweep reads no message history, touches no archived record, and settles an idle run', async () => {
  const { store, activeIDs } = ledgerWith()
  // The host says these two sessions are not executing and carries a persisted outcome for each.
  const host = countingHost({ ses_worker0: { outcome: 'succeeded', idleAt: Date.now() - 500_000 }, ses_worker1: { outcome: 'failed', idleAt: Date.now() - 400_000 } })

  await reconcileWorkers(store, host)

  expect(host.calls.context).toBe(0)
  expect(host.calls.active).toBe(1)
  for (let i = 0; i < ARCHIVED; i++) expect(host.asked.has('ses_archived' + i)).toBe(false)
  for (let i = 0; i < ACTIVE; i++) expect(host.asked.has('ses_worker' + i)).toBe(true)

  // The two the host reported idle with an outcome stop owning their steps; the other two are retained.
  const settled = activeIDs.map(id => store.read(id)!.sessions[0].state)
  expect(settled[0]).toBe('completed')
  expect(settled[1]).toBe('failed')
  expect(settled[2]).toBe('executing')
  expect(settled[3]).toBe('executing')

  // Nothing about the remaining runs changed, so the next tick asks the host nothing about them.
  const before = { ...host.calls }
  await reconcileWorkers(store, host)
  expect(host.calls.context).toBe(0)
  expect(host.calls.get).toBe(before.get)
  expect(host.calls.active).toBe(before.active + 1)
})

test('a record that changes is reconciled again on the next tick', async () => {
  const { store, activeIDs } = ledgerWith()
  const host = countingHost({})
  await reconcileWorkers(store, host)
  const settledCalls = host.calls.get
  await reconcileWorkers(store, host)
  expect(host.calls.get).toBe(settledCalls)

  store.apply(activeIDs[2], 'session-state', { callID: 'run-2', state: 'waiting' }, 'test')
  clearQuestParseCache()
  await reconcileWorkers(store, host)
  expect(host.asked.has('ses_worker2')).toBe(true)
  expect(host.calls.get).toBeGreaterThan(settledCalls)
})
