/**
 * @core-prevents an outage being scored as model failure when measured outcomes reach the router
 * @core-observed September 15: one three-hour window produced 13 of the 14 recorded failures on
 * opencode-go/deepseek-v4.1-flash#max and 4 of the 5 on #high. Scored naively that route reads 33%;
 * outside the window it is 12 of 13. Trial.accepted is boolean|null and null withholds evidence
 * rather than counting a loss, so infrastructure terminals must land in null.
 */
import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { projectIdentity } from '../quest/project'
import { QuestStore } from '../quest/store'
import { judgeRun } from '../quest/run-judgment'
import { evaluateTrials } from '../usage/benchmark-evaluation'

const build = (root: string) => {
  const store = new QuestStore(root)
  const context: any = { sessionID: 'ses_giver', requestID: 'create', directory: root, project: projectIdentity(root) }
  const api = questsAPI(store, context, async () => ({ sessionID: 'unused' }))
  const created = api.create({ title: 'Judge one run', description: 'One assigned step, one run.', steps: [{ id: 'work', title: 'Do the work' }] })
  return { store, api, id: created.id }
}
const claim = (store: QuestStore, id: string, runID: string) =>
  store.apply(id, 'session-claimed', { callID: runID, runID, sessionID: 'ses_' + runID, parentID: 'ses_giver', role: 'worker', deliverables: ['work'], attempt: 1 }, 'test')
const run = (store: QuestStore, id: string, runID: string) => store.read(id)!.sessions.find(s => s.runID === runID)!

test('infrastructure terminals are unjudged, not rejections', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-judgment-infra-'))
  try {
    const cases: [string, string][] = [
      ['Dispatch owner 10076 on Jons-pc exited during prompting', 'the dispatching host exited'],
      ['The socket connection was closed unexpectedly', 'the tool transport closed'],
      ['Host reported execution failed: Monthly usage limit reached. Resets in 1 day.', 'the account allowance was exhausted'],
      ['Host reported execution interrupted', 'execution was interrupted'],
      ['Working directory does not exist: C:\\Users\\Jk101\\...', 'the assigned workspace was missing'],
    ]
    for (const [result, expected] of cases) {
      const { store, id } = build(mkdtempSync(join(root, 'q')))
      const runID = 'a'.repeat(26)
      claim(store, id, runID)
      store.apply(id, 'session-state', { callID: runID, state: 'failed', result }, 'test')
      const verdict = judgeRun(store.read(id)!, run(store, id, runID))
      expect(verdict.accepted).toBeNull()
      expect(verdict.reason).toContain(expected)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('work that ended without delivering its step is a rejection', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-judgment-reject-'))
  try {
    const { store, id } = build(root)
    const runID = 'b'.repeat(26)
    claim(store, id, runID)
    store.apply(id, 'session-state', { callID: runID, state: 'failed', result: 'Could not work out how to change the file' }, 'test')
    expect(judgeRun(store.read(id)!, run(store, id, runID))).toEqual({ accepted: false, reason: 'Rejected: the run ended without delivering its assigned steps' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('delivery without recorded verification is unjudged, and with it is accepted by the evaluator', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-judgment-accept-'))
  try {
    const { store, id } = build(root)
    const runID = 'c'.repeat(26)
    claim(store, id, runID)
    store.apply(id, 'stage-state', { stageID: 'work', status: 'done', evidence: 'the work landed' }, 'test')
    store.apply(id, 'session-state', { callID: runID, state: 'completed', result: 'done' }, 'test')
    expect(judgeRun(store.read(id)!, run(store, id, runID)).accepted).toBeNull()

    const quest = store.read(id)!
    quest.evidence.tests.push({ command: 'bun test', result: 'passed', at: new Date().toISOString() })
    quest.evidence.artifacts.push({ name: 'core-suite', path: 'run/core.txt' } as any)
    const verdict = judgeRun(quest, run(store, id, runID))
    expect(verdict.accepted).toBe(true)

    // The evaluator refuses an accepted trial without successful verification, so this is the
    // property that makes the judgment usable rather than merely optimistic.
    const report = evaluateTrials([{
      id: 'trial', taskID: id, routeID: 'route', startedAt: 1, completedAt: 2, sessionIDs: ['ses_' + runID],
      accepted: true, verification: [{ command: 'bun test', exitCode: 0, artifact: 'run/core.txt' }], phases: [],
    }], [])
    expect(report.trials[0].accepted).toBe(true)
    expect(report.trials[0].measurementIssues).toContain('No request measurements')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
