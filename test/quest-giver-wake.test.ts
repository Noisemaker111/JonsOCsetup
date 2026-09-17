/**
 * @core-prevents the Quest Giver being woken by notices it cannot act on, and the same permission request asking again every hour with no request id, action or resource in it
 * @core-observed 2026-09-17 in giver session ses_f53e4c026ffe (184 messages): between 00:34 and 02:37 UTC every automatic worker update spent a full giver turn, most of them reporting "All credentials for model claude-opus-5 are cooling down" for attempts the runtime had already re-dispatched, and Quest 20ebb1c6 delivered the identical "Permission review needs a new decision ... retry with fresh authority" notice at 01:38 and again at 02:37 with no request id, no action and no resource; the giver spent four turns trying to act on it.
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
import { completionWake, permissionWake, CAPACITY_FAILURE } from '../quest/giver-wake'
import { permissionReviewDue } from '../quest/permission-reviewer'
import type { Quest, QuestSession } from '../quest/types'

/** The exact terminal the live giver kept being woken for. */
const COOLING_DOWN = 'Host reported execution failed: All credentials for model claude-opus-5 are cooling down via provider claude (last error: rate_limit_error: This request would exceed your account\'s rate limit. Please try again later.)'

const RUN = (n: number) => String(n).repeat(26)

function ledger() {
  clearProjectIdentityCache(); clearQuestParseCache()
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-wake-')))
  execFileSync('git', ['init', '-q'], { cwd: root })
  const store = new QuestStore(root)
  const project = projectIdentity(root)
  const api = (requestID: string) => questsAPI(store, { sessionID: 'ses_giver', requestID, directory: root, project } as any, async () => ({ sessionID: 'unused' }))
  const reread = (id: string) => { clearQuestParseCache(); return readAllQuests(root, { includeArchived: true }).flatMap(r => r.quest ? [r.quest] : []).find(q => q.id === id)! }
  return { root, store, api, reread }
}

const runOf = (q: Quest, id: string): QuestSession => q.sessions.find(s => (s.runID ?? s.callID) === id)!

test('a route failure the runtime already re-dispatched settles without a giver turn', () => {
  const { store, api, reread } = ledger()
  const quest = api('one').create({ title: 'Route Quest workers across every subscription', description: 'The route was cooling down and the runtime dispatched the same step again by itself.', steps: [{ id: 'trace', title: 'Trace why no route is chosen today' }] })
  store.apply(quest.id, 'session-planned', { callID: RUN(1), runID: RUN(1), role: 'worker', deliverables: ['trace'], attempt: 1 }, 'test')
  store.apply(quest.id, 'session-bound', { callID: RUN(1), sessionID: 'ses_first' }, 'test')
  store.apply(quest.id, 'session-state', { callID: RUN(1), state: 'failed', result: COOLING_DOWN, evidence: COOLING_DOWN }, 'test')
  // The runtime's own retry, in the shape it actually takes: a fresh run from a new request, so it
  // starts its own lineage and the superseded rule alone never sees it.
  store.apply(quest.id, 'session-planned', { callID: RUN(2), runID: RUN(2), role: 'worker', deliverables: ['trace'], attempt: 1 }, 'test')
  store.apply(quest.id, 'session-bound', { callID: RUN(2), sessionID: 'ses_second' }, 'test')

  const saved = reread(quest.id)
  expect(CAPACITY_FAILURE.test(COOLING_DOWN)).toBe(true)
  const wake = completionWake(saved, runOf(saved, RUN(1)))
  expect(wake.wake).toBe(false)
  expect(wake.wake === false && wake.settled).toMatch(/already re-dispatched/)
})

test('a superseded attempt and a turned-in Quest settle without a giver turn', () => {
  const { store, api, reread } = ledger()
  const quest = api('one').create({ title: 'Deliver a finished run without replay delay', description: 'An older attempt in the same lineage describes a state the giver has already moved past.', steps: [{ id: 'trace', title: 'Trace what a held claim means today' }] })
  store.apply(quest.id, 'session-planned', { callID: RUN(3), runID: RUN(3), role: 'worker', deliverables: ['trace'], attempt: 1 }, 'test')
  store.apply(quest.id, 'session-state', { callID: RUN(3), state: 'failed', result: 'Worker stopped' }, 'test')
  store.apply(quest.id, 'session-planned', { callID: RUN(4), runID: RUN(4), role: 'worker', deliverables: ['trace'], attempt: 2, resumedFrom: RUN(3), resumeRoot: RUN(3) }, 'test')
  store.apply(quest.id, 'session-state', { callID: RUN(4), state: 'completed', result: 'Traced' }, 'test')

  const saved = reread(quest.id)
  const superseded = completionWake(saved, runOf(saved, RUN(3)))
  expect(superseded.wake).toBe(false)
  expect(superseded.wake === false && superseded.settled).toMatch(/Superseded/)

  api('two').update(quest.id, { steps: [{ id: 'trace', state: 'done', note: 'Traced' }] })
  api('three').update(quest.id, { archive: { accepted: true } })
  const archived = reread(quest.id)
  const turnedIn = completionWake(archived, runOf(archived, RUN(4)))
  expect(turnedIn.wake).toBe(false)
  expect(turnedIn.wake === false && turnedIn.settled).toMatch(/archived/)
})

test('an outcome that still needs a decision wakes the giver, carrying its report line', () => {
  const { store, api, reread } = ledger()
  const quest = api('one').create({ title: 'Make plain opencode run on this machine again', description: 'The only attempt failed for a reason the route cannot explain away, so someone has to decide.', steps: [{ id: 'reproduce', title: 'Run plain opencode and record every failure' }] })
  store.apply(quest.id, 'session-planned', { callID: RUN(5), runID: RUN(5), role: 'worker', deliverables: ['reproduce'], attempt: 1 }, 'test')
  store.apply(quest.id, 'session-bound', { callID: RUN(5), sessionID: 'ses_only' }, 'test')
  store.apply(quest.id, 'session-state', { callID: RUN(5), state: 'failed', result: 'The command exits before any window opens' }, 'test')

  const saved = reread(quest.id)
  const wake = completionWake(saved, runOf(saved, RUN(5)))
  expect(wake.wake).toBe(true)
  // The answer arrives with the question, so the giver relays instead of re-deriving it.
  expect(wake.wake === true && wake.text).toContain('Make plain opencode run on this machine again')
  expect(wake.wake === true && wake.text).toMatch(/Ask: /)
})

test('a permission notice names the request, the action and the resource, and is sent once', () => {
  const { api, reread } = ledger()
  const quest = api('one').create({ title: 'Make Esc interrupt a running giver turn', description: 'A worker asked for access the reviewer could not settle, exactly as Quest 20ebb1c6 did.', steps: [{ id: 'trace', title: 'Trace what a single Esc does while a turn runs' }] })
  const saved = reread(quest.id)
  const request = { id: 'per_9f2', action: 'external_directory', resources: ['C:/Users/Jk101/Projects/opencode2/*'] }
  const reason = 'The user instructions do not cover a directory-wide scan of another repository.'

  const first = permissionWake(saved, request, reason)
  expect(first.wake).toBe(true)
  const text = first.wake === true ? first.text : ''
  expect(text).toContain('per_9f2')
  expect(text).toContain('external_directory')
  expect(text).toContain('opencode2')
  expect(text).toContain('/quest-approvals')
  expect(text).not.toMatch(/needs a new decision/)

  // The second sweep over the same pending request says nothing new, so it is not sent.
  const again = permissionWake(saved, request, reason, { per_9f2: '2026-09-17T01:38:38.000Z' })
  expect(again.wake).toBe(false)
  expect(again.wake === false && again.settled).toMatch(/Already asked/)

  // A different request is a different decision and still reaches the giver.
  const other = permissionWake(saved, { id: 'per_a01', action: 'bash', resources: ['rg keymap'] }, reason, { per_9f2: 'x' })
  expect(other.wake).toBe(true)
})

test('an authority digest that moved mid-review is reviewed again, not escalated at Jon', () => {
  // "User instructions, reviewer settings or assignment changed during review; retry with fresh
  // authority" was an escalation, so it queued a notice; the digest moved again an hour later and
  // queued the identical one. Retrying is due immediately once the key differs.
  const retrying = { state: 'retrying' as const, authorizationKey: 'before', churn: 1, retryAt: Date.now() + 60_000, reason: 'discarded' }
  expect(permissionReviewDue(retrying, 'after')).toBe(true)
  expect(permissionReviewDue(retrying, 'before', Date.now())).toBe(false)
  expect(permissionReviewDue(retrying, 'before', Date.now() + 120_000)).toBe(true)
  // An escalation still reaches the giver once, and only once, per authority.
  const escalated = { state: 'escalated' as const, authorizationKey: 'before', reason: 'cannot settle' }
  expect(permissionReviewDue(escalated, 'before')).toBe(false)
})
