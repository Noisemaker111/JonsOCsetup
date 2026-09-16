/**
 * @core-prevents a continuation from a retired runtime generation owning a step nothing can advance
 * @core-observed September 16: schedulers read only their own generation's continuations file, while ownership
 * and conflict checks read every generation. The generation changes whenever the code does, so eight restarts
 * on new code left thirty-six continuations-*.json files behind. Six steps read "Owned by a continuation" with
 * the intent sitting in a file no scheduler would ever open, and the board produced no model request for
 * twenty-two minutes while every dispatch reported running.
 */
import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestContinuation } from '../quest/continuation'
import { physicalDirectory } from '../quest/project'
import { runtimeQueuePath } from '../quest/runtime-queues'
import { QuestStore } from '../quest/store'

const intent = (id: string, state: string) => ({
  id, questID: 'q', description: 'd', context: { sessionID: 'ses_giver', project: { id: 'p', root: 'r' } },
  steps: [{ id: 'work', title: 'Do the work', needs: [] }],
  state, attempt: 0, refreshes: 0, nextAt: 0, reason: 'Confirmed worker/command launch',
})

function boardWithGenerations() {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-foreign-gen-')))
  const store = new QuestStore(root)
  mkdirSync(store.runtime, { recursive: true })
  const mine = runtimeQueuePath(store.runtime, 'continuations', undefined, '.json')
  // A file belonging to a generation that is no longer running, named the way runtimeQueuePath does.
  const foreign = join(store.runtime, 'continuations-' + 'a'.repeat(24) + '.json')
  writeFileSync(mine, JSON.stringify([intent('mine', 'waiting')]))
  writeFileSync(foreign, JSON.stringify([intent('stranded', 'running'), intent('finished', 'done')]))
  return { store, mine, foreign }
}

const rows = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as any[]

test('a running intent from a retired generation is stopped, and says why', async () => {
  const { store, foreign } = boardWithGenerations()

  await new QuestContinuation(store, (async () => ({ sessionID: 'unused' })) as any, {}).tick()

  const stranded = rows(foreign).find(r => r.id === 'stranded')!
  expect(stranded.state).toBe('stopped')
  expect(String(stranded.reason)).toMatch(/no longer running/)
})

test('an already finished intent from that generation is not rewritten', async () => {
  const { store, foreign } = boardWithGenerations()

  await new QuestContinuation(store, (async () => ({ sessionID: 'unused' })) as any, {}).tick()

  expect(rows(foreign).find(r => r.id === 'finished')!.reason).toBe('Confirmed worker/command launch')
})

test('this generation’s own intents are left for its scheduler', async () => {
  const { store, mine } = boardWithGenerations()

  await new QuestContinuation(store, (async () => ({ sessionID: 'unused' })) as any, {}).tick()

  // Whatever the scheduler decides, retirement must not be what decided it.
  expect(rows(mine).find(r => r.id === 'mine')!.reason).not.toMatch(/no longer running/)
})
