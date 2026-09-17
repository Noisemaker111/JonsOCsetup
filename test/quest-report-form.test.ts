/**
 * @core-prevents the Quest Giver composing Jon's backlog answer from raw records, so the groups, the counts and the asks are whatever the model wrote that turn
 * @core-observed 2026-09-17 between 00:34 and 02:37 UTC the giver answered every automatic worker update with a report whose DONE line was literally "DONE | 88 archived Quests | No action" while five Quests sat blocked, and the report form corrected in PR #221 could not reach Jon at all because the running generation predated it and nothing on screen said which generation was serving him.
 */
import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { readAllQuests, clearQuestParseCache } from '../quest/index'
import { physicalDirectory, projectIdentity, clearProjectIdentityCache } from '../quest/project'
import { QuestStore } from '../quest/store'
import { questReport } from '../quest/quest-report'
import { questTruths } from '../quest/tui-model'
import { questOperations } from '../quest/operations.mjs'
import type { QuestSession } from '../quest/types'

const RUN = (n: number) => String(n).repeat(26)

function backlog() {
  clearProjectIdentityCache(); clearQuestParseCache()
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-report-')))
  execFileSync('git', ['init', '-q'], { cwd: root })
  const store = new QuestStore(root)
  const project = projectIdentity(root)
  const api = (requestID: string) => questsAPI(store, { sessionID: 'ses_giver', requestID, directory: root, project } as any, async () => ({ sessionID: 'unused' }))

  const working = api('w').create({ title: 'Cut the Quest Giver per-request tool calls', description: 'A worker is running this one right now and the report has to name the model and the step.', steps: [{ id: 'signatures', title: 'Hand the giver the operation signatures up front' }] })
  const you = api('y').create({ title: 'Make Esc interrupt a running giver turn', description: 'This one stopped on a decision only Jon can make, so it belongs under YOU with words he can type back.', steps: [{ id: 'trace', title: 'Trace what a single Esc does while a turn runs' }] })
  const queued = api('q').create({ title: 'Rescue the Quests whose project folder is gone', description: 'Nothing has started this one; it is waiting for a free worker.', steps: [{ id: 'reproduce', title: 'Reproduce the missing-root failure' }, { id: 'rescue', title: 'Relocate the stranded records', needs: ['reproduce'] }] })
  const done = api('d').create({ title: 'Refuse dispatch on an exhausted subscription window', description: 'Delivered and turned in, so the report says what landed and what is still missing.', steps: [{ id: 'refuse', title: 'Refuse a dispatch whose window is exhausted' }] })

  store.apply(working.id, 'session-planned', { callID: RUN(1), runID: RUN(1), role: 'worker', deliverables: ['signatures'], attempt: 1 }, 'test')
  store.apply(working.id, 'session-bound', { callID: RUN(1), sessionID: 'ses_live' }, 'test')
  store.apply(working.id, 'session-state', { callID: RUN(1), state: 'executing', providerID: 'opencode', modelID: 'claude-opus-5', reasoningEffort: 'high' }, 'test')
  store.apply(you.id, 'session-planned', { callID: RUN(2), runID: RUN(2), role: 'worker', deliverables: ['trace'], attempt: 1 }, 'test')
  store.apply(you.id, 'session-bound', { callID: RUN(2), sessionID: 'ses_stuck' }, 'test')
  api('y2').update(you.id, { steps: [{ id: 'trace', state: 'blocked', note: 'A directory-wide scan exceeds the saved step' }] })
  api('d2').update(done.id, { steps: [{ id: 'refuse', state: 'done', note: 'Implemented and merged' }] })

  clearQuestParseCache()
  const records = readAllQuests(root, { includeArchived: true }).flatMap(row => row.quest ? [row.quest] : [])
  /** The owning host's answer, in the shape every reader of it already produces. */
  const observation = (run: QuestSession) => run.sessionID === 'ses_live' ? { state: 'running' }
    : run.sessionID === 'ses_stuck' ? { state: 'blocked', permissions: [{ id: 'per_1', action: 'external_directory', resources: ['C:/Users/Jk101/Projects/opencode2/*'] }] }
    : { state: 'unknown', reason: 'Recorded as executing, but the owning host does not confirm an execution for it' }
  return { records, truths: questTruths(records, observation), ids: { working: working.id, you: you.id, queued: queued.id, done: done.id } }
}

test('the report is four groups in order, and an empty group is skipped', () => {
  const { truths } = backlog()
  const report = questReport(truths, truths, 'all projects', 'gen-34c10bb9bda5')

  expect(report.sections.map(section => section.heading)).toEqual(['YOU', 'WORKING', 'QUEUED', 'DONE'])
  expect(report.counts.you).toBe(1)
  expect(report.counts.working).toBe(1)
  expect(report.counts.queued).toBe(1)
  expect(report.counts.done).toBe(1)
  expect(report.scope).toBe('all projects')
  // Nothing on screen said which generation was serving Jon, so a fixed report could not be seen.
  expect(report.serving).toBe('gen-34c10bb9bda5')

  const onlyDone = questReport(truths.filter(t => t.group === 'done'), truths, 'all projects')
  expect(onlyDone.sections.map(section => section.heading)).toEqual(['DONE'])
})

test('every bullet is a name, one sentence and an ask, and never an id', () => {
  const { truths } = backlog()
  const report = questReport(truths, truths, 'all projects')
  const bullets = report.sections.flatMap(section => section.bullets)

  expect(bullets).toHaveLength(4)
  for (const bullet of bullets) {
    expect(bullet.name.length).toBeGreaterThan(0)
    expect(bullet.sentence.length).toBeGreaterThan(0)
    expect(bullet.ask.length).toBeGreaterThan(0)
    const line = `${bullet.name} ${bullet.sentence} ${bullet.ask}`
    // No step id, session id, run id, revision number or internal state name.
    expect(line).not.toMatch(/ses_|msg_|\b[0-9a-f]{12,}\b|\brevision\b/i)
    expect(line).not.toMatch(/\b(?:Needs attention|Ready to complete|Verifying|executing)\b/)
  }
  for (const section of report.sections.filter(s => s.group !== 'you')) {
    for (const bullet of section.bullets) expect(bullet.ask).toBe('nothing from you')
  }
})

test('YOU carries the words Jon types back; WORKING names the model and the step', () => {
  const { truths } = backlog()
  const report = questReport(truths, truths, 'all projects')
  const you = report.sections.find(s => s.group === 'you')!.bullets[0]
  const working = report.sections.find(s => s.group === 'working')!.bullets[0]

  expect(you.name).toBe('Make Esc interrupt a running giver turn')
  expect(you.sentence).toMatch(/waiting for permission to external_directory/)
  expect(you.ask).toContain('/quest-approvals')
  expect(working.sentence).toContain('opencode/claude-opus-5')
  expect(working.sentence).toContain('high reasoning')
  expect(working.sentence).toContain('Hand the giver the operation signatures up front')
})

test('QUEUED names what it waits on and DONE says merged and tested, or which is missing', () => {
  const { truths } = backlog()
  const report = questReport(truths, truths, 'all projects')
  const queued = report.sections.find(s => s.group === 'queued')!.bullets[0]
  const done = report.sections.find(s => s.group === 'done')!.bullets[0]

  expect(queued.sentence).toMatch(/waiting for a free worker/)
  expect(queued.sentence).toContain('Reproduce the missing-root failure')
  expect(done.sentence).toContain('Refuse a dispatch whose window is exhausted')
  expect(done.sentence).toMatch(/not merged into agents yet/)
  expect(done.sentence).toMatch(/not tested in OpenCode yet/)
})

test('the public contract exposes the report, or the giver cannot relay one', () => {
  // A giver that has to compose the form from records is the defect; it reaches the built one
  // through the operation contract and nothing else.
  const view = (questOperations as any).list.input.properties.view
  expect(view.enum).toContain('report')
  const output = (questOperations as any).list.output.properties
  expect(output.counts).toBeDefined()
  expect(output.report).toBeDefined()
  expect(output.report.properties.sections).toBeDefined()
})
