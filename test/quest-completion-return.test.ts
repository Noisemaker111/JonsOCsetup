/**
 * @core-prevents completed Quest workers replaying every saved step note into the giver conversation instead of a bounded actionable return
 * @core-observed On September 13, 2026 ten post-decision review envelopes delivered 28,315 characters, including 22,629 characters of notes already saved on their Quests.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectIdentity } from '../quest/project'
import { saveUserGiver } from '../quest/giver-registry.mjs'
import { questsAPI } from '../quest/api'
import { QuestStore } from '../quest/store'
import { consumeQuestStarts, requestQuestReview, startRequests } from '../quest/start-request'
import { QuestWorkerReturns } from '../quest/worker-returns'

const id = (lead: string) => lead.repeat(26).slice(0, 26)

test('terminal worker delivery carries one outcome line while the complete note stays readable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'quest-bounded-return-')), store = new QuestStore(root)
  const project = projectIdentity(root), giverID = 'ses_bounded_return', runID = id('a')
  const model = { providerID: 'provider', id: 'model', variant: 'max' }, prompts: any[] = []
  const host = {
    create: async () => undefined,
    get: async () => ({ id: giverID, agent: 'quest-giver', model, location: { directory: root } }),
    prompt: async (input: any) => { prompts.push(input) },
  }
  try {
    saveUserGiver(store.runtime, { state: 'bound', sessionID: giverID, directory: root, model })
    const quest = store.create({ id: id('b'), title: 'Keep the detailed completion on its Quest', objective: 'Return only what the giver acts on', contractVersion: 2, project, integrationOwner: giverID, stages: [{ id: 'bounded-return', title: 'Bound the completion return', status: 'pending', needs: [] }] })
    const context = { project, directory: root, giverDirectory: root, sessionID: giverID, requestID: 'start' }
    const returns = new QuestWorkerReturns(store, host, 'bounded-return-test')
    await returns.watch({ quest, runID, stepIDs: ['bounded-return'], context })
    store.apply(quest.id, 'session-planned', { callID: runID, runID, parentID: giverID, role: 'worker', deliverables: ['bounded-return'] }, 'test')
    const secret = 'token=abcdefghijklmnopqrstuv'
    const note = `Implemented the bounded return and verified the saved record; ${secret}.\n` + 'Detailed artifact, hash and command evidence stays here. '.repeat(300)
    const stages = structuredClone(store.read(quest.id)!.stages)
    stages[0].status = 'done'; stages[0].note = note
    store.apply(quest.id, 'patched', { stages }, 'test')
    store.apply(quest.id, 'session-state', { callID: runID, state: 'completed', result: 'Host reported execution succeeded with a long result that is not replayed' }, 'test')

    await returns.tick()
    expect(prompts).toHaveLength(1)
    const text = prompts[0].text as string, payload = JSON.parse(text.split('\n')[1])
    expect(Object.keys(payload)).toEqual(['questID', 'title', 'state', 'finishedStep', 'outcome', 'notes'])
    expect(payload).toMatchObject({ questID: quest.id, title: quest.title, state: 'Ready to complete', finishedStep: { id: 'bounded-return', title: 'Bound the completion return', state: 'done' }, outcome: 'Implemented the bounded return and verified the saved record; [REDACTED]' })
    expect(payload.notes).toContain('quests.inspect')
    expect(text).not.toContain(secret)
    expect(text).not.toContain('Detailed artifact')
    expect(questsAPI(store, context, async () => ({ sessionID: 'unused' })).get(quest.id).steps[0].note).toBe(note)
    await new QuestWorkerReturns(store, host, 'bounded-return-test').tick()
    expect(prompts).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('review delivery uses the same bounded shape and accepted records queue no envelope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'quest-bounded-review-')), store = new QuestStore(root)
  const project = projectIdentity(root), giverID = 'ses_bounded_review', prompts: any[] = []
  const host = {
    create: async () => undefined,
    get: async () => ({ id: giverID, agent: 'quest-giver', location: { directory: root } }),
    prompt: async (input: any) => { prompts.push(input) },
  }
  try {
    saveUserGiver(store.runtime, { state: 'bound', sessionID: giverID, directory: root })
    const note = 'Review only this one-line outcome.\n' + 'Full review evidence remains saved. '.repeat(300)
    const historical = 'Historical step outcome.\n' + 'Earlier artifact and command evidence stays saved. '.repeat(300)
    const quest = store.create({ id: id('c'), title: 'Review a bounded completion', objective: 'Keep full evidence on the Quest', contractVersion: 2, project, integrationOwner: giverID, stages: [
      { id: 'historical-step', title: 'Preserve the earlier result', status: 'done', note: historical, needs: [] },
      { id: 'review-return', title: 'Return the review summary', status: 'done', note, needs: ['historical-step'] },
    ] })
    requestQuestReview(store, quest.id, undefined, 'review-return')
    await consumeQuestStarts(store, host, {} as any)
    expect(prompts).toHaveLength(1)
    const payload = JSON.parse((prompts[0].text as string).split('\n')[1])
    expect(payload).toMatchObject({ questID: quest.id, state: 'Ready to complete', finishedStep: { id: 'review-return', state: 'done' }, outcome: 'Review only this one-line outcome.' })
    expect(prompts[0].text).not.toContain('Full review evidence')
    expect(prompts[0].text).not.toContain('Historical step outcome')
    const context = { project, directory: root, giverDirectory: root, sessionID: giverID, requestID: 'get' }
    const saved = questsAPI(store, context, async () => ({ sessionID: 'unused' })).get(quest.id)
    expect(saved.steps.map(step => step.note)).toEqual([historical, note])

    store.apply(quest.id, 'patched', { archive: { accepted: true, at: new Date().toISOString() } }, 'test')
    requestQuestReview(store, quest.id)
    expect(startRequests(store, quest.id)).toHaveLength(1)
    await consumeQuestStarts(store, host, {} as any)
    expect(prompts).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
