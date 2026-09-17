/**
 * @core-prevents two Quest surfaces deriving a different state for one record, so a recorded-executing run nothing is running reads Working in one place and Waiting in another
 * @core-observed 2026-09-17 02:40 UTC: the live ledger held 110 records, all 15 "Working" carried an executing run, and the host confirmed an execution for none of them. deriveState said Working from the ledger, withQuestActivity downgraded only some tool reads, and the board's own status() mapped the ledger state straight to RUNNING, so the CLI, the board, the footer and the giver each reported a different backlog.
 */
import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { readAllQuests, clearQuestParseCache } from '../quest/index'
import { physicalDirectory, projectIdentity, clearProjectIdentityCache } from '../quest/project'
import { QuestStore } from '../quest/store'
import { questTruth, questCounts } from '../quest/reachability'
import { observationFromActivity, withQuestActivity, type ActivitySnapshot } from '../quest/activity'
import { toolSummary } from '../quest/tool-projection'
import { questTruths, filterTruths } from '../quest/tui-model'
import { questLane } from '../quest/board'
import type { Quest } from '../quest/types'

function ledger() {
  clearProjectIdentityCache(); clearQuestParseCache()
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-derivation-')))
  execFileSync('git', ['init', '-q'], { cwd: root })
  const store = new QuestStore(root)
  const project = projectIdentity(root)
  // One tool call admits one Quest, so each create needs its own request identity, exactly as a
  // giver turn gives it.
  const api = (requestID: string) => questsAPI(store, { sessionID: 'ses_giver', requestID, directory: root, project } as any, async () => ({ sessionID: 'unused' }))
  return { root, store, api }
}

/** A saved run that the ledger calls executing: written when the prompt was sent, never by the host. */
function recordExecuting(store: QuestStore, id: string, callID: string, sessionID: string, stepID: string) {
  store.apply(id, 'session-planned', { callID, runID: callID, role: 'worker', model: 'opencode/claude-opus-5', deliverables: [stepID], attempt: 1 }, 'test:plan')
  store.apply(id, 'session-bound', { callID, sessionID }, 'test:bind')
}

function build() {
  const { root, store, api } = ledger()
  const step = (title: string) => [{ id: 'work', title }]
  const unconfirmed = api('one').create({ title: 'Recorded executing with nothing running it', description: 'A run the ledger calls executing while the owning host confirms no execution for it.', steps: step('Do the recorded work') })
  const confirmed = api('two').create({ title: 'Recorded executing with a live worker on it', description: 'A run the owning host confirms an active execution for right now.', steps: step('Do the confirmed work') })
  const blocked = api('three').create({ title: 'Recorded executing with a blocked step under it', description: 'A run the ledger calls executing whose step is already blocked on a decision.', steps: step('Do the blocked work') })
  const archived = api('four').create({ title: 'Finished and turned in already', description: 'A record that was accepted and archived and must never read as live work.', steps: step('Do the finished work') })

  recordExecuting(store, unconfirmed.id, 'a'.repeat(26), 'ses_quiet', 'work')
  recordExecuting(store, confirmed.id, 'b'.repeat(26), 'ses_live', 'work')
  recordExecuting(store, blocked.id, 'c'.repeat(26), 'ses_blocked', 'work')
  api('three').update(blocked.id, { steps: [{ id: 'work', state: 'blocked', note: 'Needs a decision before it can continue' }] })
  api('four').update(archived.id, { steps: [{ id: 'work', state: 'done', note: 'Delivered' }] })
  api('four').update(archived.id, { archive: { accepted: true } })

  clearQuestParseCache()
  const records = readAllQuests(root, { includeArchived: true }).flatMap(row => row.quest ? [row.quest] : [])
  const by = (id: string) => records.find(q => q.id === id)!
  const snapshot: ActivitySnapshot = { active: { ses_live: true }, checkedAt: new Date().toISOString() }
  return { root, store, records, snapshot, observation: observationFromActivity(snapshot),
    unconfirmed: by(unconfirmed.id), confirmed: by(confirmed.id), blocked: by(blocked.id), archived: by(archived.id) }
}

/** Every projection a surface draws, asked the same question about the same record. */
function everyProjection(q: Quest, snapshot: ActivitySnapshot) {
  const observation = observationFromActivity(snapshot)
  const truth = questTruth(q, observation)
  return {
    // quests.get / quests.status / quests.list item, and the CLI that calls them
    tool: withQuestActivity(q, toolSummary(q), snapshot).state,
    // board row and detail badge
    row: truth.reach.run ? truth.reach.label : truth.reach.lifecycle.short,
    // board lane, sidebar tone, footer filter vocabulary
    lane: truth.lane, tone: truth.reach.tone,
    // the giver's report
    group: truth.group,
    state: truth.state, confirmed: truth.confirmed, reason: truth.reason,
  }
}

test('a recorded executing run the host does not confirm is not Working on any surface', () => {
  const world = build()
  const seen = everyProjection(world.unconfirmed, world.snapshot)

  expect(world.unconfirmed.state).toBe('Working')       // what the ledger saved
  expect(seen.state).toBe('Waiting')                    // what every surface shows
  expect(seen.tool).toBe('Waiting')
  expect(seen.row).toBe('UNKNOWN')
  expect(seen.lane).toBe('assigned')
  expect(seen.group).toBe('queued')
  expect(seen.confirmed).toBe(false)
  // The reason travels with the downgrade, so the surface says why rather than just showing less.
  expect(seen.reason).toMatch(/does not confirm an execution/)
  expect(filterTruths(questTruths([world.unconfirmed], world.observation), 'active')).toHaveLength(0)
})

test('Working means the owning host confirms an execution for an attempt this Quest owns', () => {
  const world = build()
  const seen = everyProjection(world.confirmed, world.snapshot)

  expect(seen.state).toBe('Working')
  expect(seen.tool).toBe('Working')
  expect(seen.row).toBe('RUNNING')
  expect(seen.tone).toBe('live')
  expect(seen.lane).toBe('assigned')
  expect(seen.group).toBe('working')
  expect(seen.confirmed).toBe(true)
  expect(filterTruths(questTruths([world.confirmed], world.observation), 'active')).toHaveLength(1)
})

test('an unconfirmed run over a blocked step needs attention everywhere, not Waiting', () => {
  const world = build()
  const seen = everyProjection(world.blocked, world.snapshot)

  expect(seen.state).toBe('Needs attention')
  expect(seen.tool).toBe('Needs attention')
  expect(seen.lane).toBe('attention')
  expect(seen.group).toBe('you')
  expect(seen.reason).toMatch(/does not confirm an execution/)
})

test('an archived record reads archived on every surface and counts as nothing live', () => {
  const world = build()
  const seen = everyProjection(world.archived, world.snapshot)

  expect(seen.state).toBe('Archived')
  expect(seen.tool).toBe('Archived')
  expect(seen.lane).toBe('archived')
  expect(seen.group).toBe('done')
  expect(seen.confirmed).toBe(false)
  expect(questLane(world.archived, seen.state)).toBe('archived')
})

test('one ledger, one set of numbers', () => {
  const world = build()
  const counts = questCounts(questTruths(world.records, world.observation))

  expect(counts.total).toBe(4)
  expect(counts.working).toBe(1)
  expect(counts.you).toBe(1)
  expect(counts.queued).toBe(1)
  expect(counts.done).toBe(1)
  expect(counts.open).toBe(3)
})

test('no surface keeps its own ledger-state table to disagree with', () => {
  // The board mapped `q.state === "Working"` to RUNNING in its own status()/badge() helpers, which
  // is why it could paint a Quest live that the same second's tool read called Waiting. A surface
  // that derives state itself is the defect, so the source is what this pins.
  const board = readFileSync(join(import.meta.dir, '..', 'quest', 'tui-active', 'quest-board.tsx'), 'utf8')
  const footer = readFileSync(join(import.meta.dir, '..', 'quest', 'tui-active', 'quests.tsx'), 'utf8')
  for (const source of [board, footer]) {
    expect(source).not.toMatch(/\bq(?:uest)?\(?\)?\.state\s*===\s*["'](?:Working|Needs attention|Verifying|Ready to complete)["']/)
  }
  expect(board).toMatch(/questTruth/)
  expect(footer).toMatch(/questTruth|questCounts/)
})
