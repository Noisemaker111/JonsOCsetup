/**
 * @core-prevents the CLI, the board and the composer footer counting one ledger into different numbers, and a Quest becoming unreadable because the project folder it names was deleted
 * @core-observed 2026-09-17 02:40 UTC: 110 records, 92 of them naming project roots that no longer exist (82 at the retired opencode-hub folder, 10 at the installed configuration directory). list returned all of them while get, status and plan refused, projectIdentity threw ENOENT on the read path, and the CLI, the board (project-scoped unless giver), the footer and the giver each reported a different backlog for the same ledger.
 */
import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { readAllQuests, clearQuestParseCache } from '../quest/index'
import { physicalDirectory, projectIdentity, clearProjectIdentityCache } from '../quest/project'
import { QuestStore } from '../quest/store'
import { questCounts } from '../quest/reachability'
import { observationFromActivity, type ActivitySnapshot } from '../quest/activity'
import { questListResult, toolSummary, toolStatus, toolPlan } from '../quest/tool-projection'
import { questTruths, filterTruths } from '../quest/tui-model'
import { scopeLabel, allProjectsByDefault } from '../quest/board-project'

function checkout(prefix: string) {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), prefix)))
  execFileSync('git', ['init', '-q'], { cwd: root })
  return root
}

function world() {
  clearProjectIdentityCache(); clearQuestParseCache()
  const ledgerRoot = checkout('quest-counts-ledger-')
  const store = new QuestStore(ledgerRoot)
  const home = projectIdentity(ledgerRoot)
  const api = (requestID: string, project = home) =>
    questsAPI(store, { sessionID: 'ses_giver', requestID, directory: project.root, project } as any, async () => ({ sessionID: 'unused' }))
  return { ledgerRoot, store, home, api }
}

const snapshot = (active: Record<string, unknown> = {}): ActivitySnapshot => ({ active, checkedAt: new Date().toISOString() })

test('the CLI result, the board filters and the footer read one counting function', () => {
  const { ledgerRoot, store, api } = world()
  const open = api('one').create({ title: 'Open work waiting for a worker', description: 'A saved Quest nothing has started yet, which every surface has to count the same way.', steps: [{ id: 'work', title: 'Do the waiting work' }] })
  const live = api('two').create({ title: 'Work with a confirmed live worker', description: 'A Quest whose owning host confirms an execution right now.', steps: [{ id: 'work', title: 'Do the live work' }] })
  store.apply(live.id, 'session-planned', { callID: 'd'.repeat(26), runID: 'd'.repeat(26), role: 'worker', model: 'opencode/claude-opus-5', deliverables: ['work'], attempt: 1 }, 'test')
  store.apply(live.id, 'session-bound', { callID: 'd'.repeat(26), sessionID: 'ses_live' }, 'test')

  clearQuestParseCache()
  const activity = snapshot({ ses_live: true })
  const listed = api('read').list({})
  const assembled = questListResult(listed as any, activity, (item: any) => toolSummary(store.read(item.id)!))
  const records = readAllQuests(ledgerRoot).flatMap(row => row.quest ? [row.quest] : [])
  const surfaces = questCounts(questTruths(records, observationFromActivity(activity)))

  // One function, one answer: the CLI payload, the footer's "N open" and the board's filter counts.
  expect(assembled.counts).toEqual(surfaces)
  expect(assembled.counts.open).toBe(2)
  expect(assembled.counts.working).toBe(1)
  expect(filterTruths(questTruths(records, observationFromActivity(activity)), 'open')).toHaveLength(assembled.counts.open)
  expect(filterTruths(questTruths(records, observationFromActivity(activity)), 'active')).toHaveLength(assembled.counts.working)
  expect(assembled.items.find((item: any) => item.id === open.id).state).toBe('Waiting')
  expect(assembled.items.find((item: any) => item.id === live.id).state).toBe('Working')
})

test('the all-projects-or-this-project choice is stated, and stated the same way everywhere', () => {
  const { home, api } = world()
  api('one').create({ title: 'A Quest in the current project', description: 'Something to count, so the scope line is answering about a real set.', steps: [{ id: 'work', title: 'Do the work' }] })

  expect(api('mine').list({}).scope).toBe(scopeLabel(false, home.root))
  expect(api('all').list({ allProjects: true }).scope).toBe(scopeLabel(true, home.root))
  expect(scopeLabel(true)).toBe('all projects')
  // The giver holds one conversation across projects, so its surfaces read the whole ledger.
  expect(allProjectsByDefault('ses_giver')).toBe(true)
  expect(allProjectsByDefault(undefined)).toBe(false)
})

test('a Quest whose project folder was deleted stays readable, listed and diagnosed', () => {
  const { store, api } = world()
  const gone = checkout('quest-counts-gone-')
  const stranded = api('one', projectIdentity(gone)).create({ title: 'Saved against a folder that later disappeared', description: 'The recorded project root is deleted underneath the Quest, exactly as the retired hub folder was.', steps: [{ id: 'work', title: 'Do the stranded work' }] })
  rmSync(gone, { recursive: true, force: true })
  clearProjectIdentityCache(); clearQuestParseCache()

  // Reads survive: the ledger is one shared store and the project only says where a worker runs.
  const record = api('read').get(stranded.id)
  expect(record.id).toBe(stranded.id)
  expect(toolStatus(store.read(stranded.id)!).id).toBe(stranded.id)
  expect(toolPlan(store.read(stranded.id)!).id).toBe(stranded.id)

  const listed = api('list').list({ allProjects: true })
  expect(listed.items.some((item: any) => item.id === stranded.id)).toBe(true)
  expect(listed.diagnostics.join(' ')).toMatch(/recorded project folder/)
  expect(listed.diagnostics.join(' ')).toContain(gone.split(/[\\/]/).filter(Boolean).at(-1))
})

test('only dispatch refuses a Quest whose project folder is gone, and it says how to move it', async () => {
  const { api } = world()
  const gone = checkout('quest-counts-dispatch-')
  const identity = projectIdentity(gone)
  const stranded = api('one', identity).create({ title: 'Started against a folder that disappeared', description: 'Dispatch is the one operation that cannot pretend the folder is still there.', steps: [{ id: 'work', title: 'Do the undispatchable work' }] })
  rmSync(gone, { recursive: true, force: true })
  clearProjectIdentityCache(); clearQuestParseCache()

  await expect(api('run', identity).run(stranded.id)).rejects.toThrow(/no longer exists.*update projectRoot/s)
})
