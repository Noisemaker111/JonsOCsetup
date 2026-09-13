import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { acquireLock } from './locking'
import { QuestError } from './api'
import { readContinuations, devQueueGeneration } from './runtime-queues'
import { readUserGiver } from './giver-registry.mjs'
import { adoptQuestGiver, giverContext, verifyGiverBinding } from './user-giver'
import { questWorkflow } from './workflow'
import type { QuestStore } from './store'
import type { QuestHost } from './runtime'
import type { QuestContinuation } from './continuation'
import type { Quest } from './types'

type Request = {
  quest: string; requestID: string; kind?: 'review'; generation?: string; createdAt: string
  state: 'queued' | 'admitting' | 'started' | 'failed' | 'unknown'
  authorization?: { at: string; action: 'Start saved Quest'; definition: string; giverID?: string }
  result?: unknown; error?: string
}
const active = (state: string) => ['planned', 'executing', 'waiting', 'blocked'].includes(state)
// Route/concurrency preferences may change for later workers without withdrawing authority for work already started.
// Publishing still needs its own authority; a delivery preference never grants it.
const definition = (quest: Quest) => createHash('sha256').update(JSON.stringify([quest.project, quest.description ?? quest.objective, quest.stages.map(step => [step.id, step.title, step.detail, step.needs])])).digest('hex')
const directory = (store: QuestStore) => join(store.runtime, 'start-requests')
const path = (store: QuestStore, id: string) => join(directory(store), id + '.json')
function save(store: QuestStore, row: Request) {
  mkdirSync(directory(store), { recursive: true })
  const file = path(store, row.requestID), temporary = file + '.' + process.pid + '.tmp'
  writeFileSync(temporary, JSON.stringify(row)); renameSync(temporary, file)
}
export function startRequests(store: QuestStore, quest?: string): Request[] {
  if (!existsSync(directory(store))) return []
  return readdirSync(directory(store)).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(directory(store), name), 'utf8')) as Request).filter(row => !quest || row.quest === quest)
}

/** An id-only durable admission. Repeated calls return the same pending or active work. */
export function requestQuestStart(store: QuestStore, id: string, generation?: string): Request | { quest: string; state: string; runID?: string; sessionID?: string } {
  const lock = acquireLock(store.runtime, 'start-requests')
  try {
    const quest = store.read(id)
    if (!quest) throw new QuestError('QUEST_NOT_FOUND', 'Quest not found')
    if (quest.archive || quest.state === 'Archived') throw new QuestError('QUEST_ARCHIVED', 'Reopen the Quest before starting it')
    const pending = startRequests(store, id).find(row => !row.kind && ['queued', 'admitting', 'unknown'].includes(row.state))
    if (pending) return pending
    const run = quest.sessions.findLast(row => active(row.state))
    if (run) return { quest: id, state: run.state, runID: run.runID, sessionID: run.openCodeSessionId ?? run.sessionID }
    if (readContinuations(store.runtime).some(row => row.questID === id && !['done', 'stopped'].includes(row.state))) return { quest: id, state: 'running' }
    if (!quest.stages.some(step => step.status === 'pending')) throw new QuestError('NO_ELIGIBLE_STEPS', 'No pending steps; inspect the saved result or blocker')
    const createdAt = new Date().toISOString()
    const row: Request = { quest: id, requestID: randomUUID(), generation, createdAt, state: 'queued', authorization: { at: createdAt, action: 'Start saved Quest', definition: definition(quest) } }
    save(store, row)
    return row
  } finally { lock.release() }
}

/** A recorded start is authority to execute these saved steps, not permission for unrelated actions. */
export function questStartAuthorization(store: QuestStore, questID: string, runID: string, giverID: string) {
  const quest = store.read(questID)
  if (!quest) return
  const continuation = readContinuations(store.runtime).find(row => row.questID === questID && row.context?.sessionID === giverID && (row.runID === runID || row.admissions?.some((admission: any) => admission.runID === runID)))
  if (!continuation) return
  const row = startRequests(store, questID).find(row => row.requestID === continuation.context.requestID && !row.kind && ['admitting', 'started'].includes(row.state))
  if (!row?.authorization || row.authorization.giverID !== giverID || row.authorization.definition !== definition(quest)) return
  return { action: row.authorization.action, at: row.authorization.at, questID, scope: 'Execute the saved Quest steps using its chosen workflow, including necessary project instruction reads and ordinary verification. This does not authorize unrelated access, destructive operations, new spending, publishing or production changes.' }
}

/** Completing externally held steps returns their saved results for review; it never accepts its own work. */
export function requestQuestReview(store: QuestStore, id: string, generation?: string) {
  const lock = acquireLock(store.runtime, 'start-requests')
  try {
    const quest = store.read(id)
    if (!quest || !quest.stages.length || quest.stages.some(step => step.status !== 'done') || quest.sessions.some(run => active(run.state))) return
    const requestID = createHash('sha256').update(JSON.stringify([id, quest.lifecycleEpoch, quest.stages.map(step => [step.id, step.note])])).digest('hex')
    if (existsSync(path(store, requestID))) return
    save(store, { quest: id, requestID, kind: 'review', generation, createdAt: new Date().toISOString(), state: 'queued' })
  } finally { lock.release() }
}

/** The connected OpenCode adapter executes requests, using the same continuation and returns as its tools. */
export async function consumeQuestStarts(store: QuestStore, host: QuestHost, continuation: QuestContinuation) {
  const generation = devQueueGeneration()
  const giver = readUserGiver(store.runtime)
  if (giver?.state !== 'bound' || !giver.sessionID) return
  for (const pending of startRequests(store).filter(row => row.state === 'queued' && (!row.generation || row.generation === generation))) {
    let row: Request
    const lock = acquireLock(store.runtime, 'start-requests')
    try {
      row = JSON.parse(readFileSync(path(store, pending.requestID), 'utf8'))
      if (row.state !== 'queued') continue
      row.state = 'admitting'; save(store, row)
    } finally { lock.release() }
    try {
      const response = await host.get({ sessionID: giver.sessionID }), session = response?.data ?? response
      const context = giverContext(store, session, row.requestID, row.quest)
      verifyGiverBinding(store, context, session)
      adoptQuestGiver(store, row.quest)
      const quest = store.read(row.quest)!
      if (row.kind === 'review') {
        if (quest.stages.some(step => step.status !== 'done') || quest.sessions.some(run => active(run.state))) throw new QuestError('QUEST_CHANGED', 'Quest changed before review; inspect its saved result')
        await host.prompt({ sessionID: giver.sessionID, id: 'msg_questreview' + row.requestID, text: 'Quest ready for review: ' + quest.title + '.\n' + JSON.stringify({ questID: quest.id, workflow: questWorkflow(quest), steps: quest.stages.map(step => ({ id: step.id, title: step.title, note: step.note })) }) + '\nInspect the saved work and evidence, then deliver according to its workflow and existing project authorization. Completion notes are not independent verification.', metadata: { questReview: true, questID: quest.id } })
        row.state = 'started'; save(store, row)
        continue
      }
      if (!row.authorization || row.authorization.definition !== definition(quest)) throw new QuestError('QUEST_CHANGED', 'Quest definition changed after Start; review its saved settings and start again')
      row.authorization.giverID = giver.sessionID
      save(store, row)
      const { task, model, maxConcurrent } = questWorkflow(quest)
      const result = await continuation.run(row.quest, { task, model, maxConcurrent }, context)
      row.result = { continuationID: result.continuation?.id, state: result.continuation?.state, runID: result.continuation?.runID }
      row.state = 'started'
    } catch (error) {
      row.state = error instanceof QuestError ? 'failed' : 'unknown'
      row.error = error instanceof Error ? error.message : String(error)
    }
    save(store, row)
  }
}
