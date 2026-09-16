/**
 * @core-prevents delivered work staying unjudgeable because a worker has nowhere to record its check
 * @core-observed September 15: of 241 terminal runs in this installation, 120 delivered their assigned step
 * and recorded no passing verification, so they could not be accepted. evidence.tests held 34 entries across
 * 86 quests, all attached by the giver: the worker update guard rejected every key except id, state and note,
 * and the worker prompt told workers to put check evidence in note, where nothing can evaluate it.
 */
import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI, QuestError } from '../quest/api'
import { projectIdentity } from '../quest/project'
import { QuestStore } from '../quest/store'
import { judgeRun } from '../quest/run-judgment'

const setup = (root: string) => {
  const store = new QuestStore(root)
  const context: any = { sessionID: 'ses_giver', requestID: 'create', directory: root, project: projectIdentity(root) }
  const api = questsAPI(store, context, async () => ({ sessionID: 'unused' }))
  const created = api.create({ title: 'Record the check that was run', description: 'A delivered step should carry the command that proves it.', steps: [{ id: 'work', title: 'Do the work' }] })
  const runID = 'd'.repeat(26)
  store.apply(created.id, 'session-claimed', { callID: runID, runID, sessionID: 'ses_worker', parentID: 'ses_giver', role: 'worker', deliverables: ['work'], attempt: 1 }, 'test')
  return { store, api, id: created.id, runID }
}

test('a worker records the check it ran, and the run becomes judgeable', () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-verification-'))
  try {
    const { store, api, id, runID } = setup(root)
    api.update(id, { steps: [{ id: 'work', state: 'done', note: 'Implemented and checked.', verification: { command: 'bun test test/thing.test.ts', exitCode: 0, artifact: 'run/thing.txt' } }] })
    store.apply(id, 'session-state', { callID: runID, state: 'completed', result: 'done' }, 'test')

    const quest = store.read(id)!
    const recorded = quest.evidence.tests.at(-1)!
    expect(recorded).toMatchObject({ command: 'bun test test/thing.test.ts', result: 'passed', stepID: 'work', artifact: 'run/thing.txt' })
    // Global artifacts stay the giver's: the worker's check did not add one.
    expect(quest.evidence.artifacts).toHaveLength(0)

    const verdict = judgeRun(quest, quest.sessions.find(s => s.runID === runID)!)
    expect(verdict.accepted).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a failing check is recorded as failed, and does not accept the run', () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-verification-fail-'))
  try {
    const { store, api, id, runID } = setup(root)
    api.update(id, { steps: [{ id: 'work', state: 'done', note: 'Landed, but the suite is red.', verification: { command: 'bun test', exitCode: 1, artifact: 'run/red.txt' } }] })
    store.apply(id, 'session-state', { callID: runID, state: 'completed', result: 'done' }, 'test')
    const quest = store.read(id)!
    expect(quest.evidence.tests.at(-1)!.result).toBe('failed')
    expect(judgeRun(quest, quest.sessions.find(s => s.runID === runID)!).accepted).toBeNull()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('verification is refused where it would be a claim rather than a result', () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-verification-guard-'))
  try {
    const { api, id } = setup(root)
    // Not done: there is nothing delivered for the check to prove.
    expect(() => api.update(id, { steps: [{ id: 'work', state: 'working', verification: { command: 'bun test', exitCode: 0 } }] })).toThrow(QuestError)
    // A missing or non-integer exit code is a description of a check, not one that ran.
    expect(() => api.update(id, { steps: [{ id: 'work', state: 'done', verification: { command: 'bun test' } as any }] })).toThrow(QuestError)
    expect(() => api.update(id, { steps: [{ id: 'work', state: 'done', verification: { command: '', exitCode: 0 } }] })).toThrow(QuestError)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
