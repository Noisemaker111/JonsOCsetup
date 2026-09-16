/**
 * @core-prevents the update contract drifting from get, which is what makes a verifying get redundant
 * @core-observed September 15 audit of one Quest Giver conversation: 430 get calls, and 153 of them (36%)
 * followed an update, because the update description said "Get the Quest afterwards to verify" while
 * update already returned the saved Quest. Tool results are re-sent on every later turn, so each of those
 * repeats a payload the model already held for the rest of the session.
 */
import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { projectIdentity } from '../quest/project'
import { QuestStore } from '../quest/store'

test('update returns exactly what a verifying get would return', () => {
  const root = mkdtempSync(join(tmpdir(), 'quest-update-view-'))
  try {
    const store = new QuestStore(root)
    const context: any = { sessionID: 'ses_giver', requestID: 'create', directory: root, project: projectIdentity(root) }
    const api = questsAPI(store, context, async () => ({ sessionID: 'unused' }))
    const created = api.create({
      title: 'Prove the saved view comes back from the write',
      description: 'A write that already answers with the saved Quest needs no second read.',
      steps: [{ id: 'first', title: 'First step' }, { id: 'second', title: 'Second step', needs: ['first'] }],
    })

    const saved = api.update(created.id, { steps: [{ id: 'first', state: 'done', note: 'Recorded by the worker, and long enough to be worth not sending twice.' }] })
    const fetched = api.get(created.id)

    expect(saved).toEqual(fetched)
    // The fields a giver would re-read to confirm the write are already in the write's own answer.
    expect(saved.steps.find(s => s.id === 'first')).toMatchObject({ state: 'done', note: expect.stringContaining('Recorded by the worker') })
    expect(saved.nextStepID).toBe('second')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
