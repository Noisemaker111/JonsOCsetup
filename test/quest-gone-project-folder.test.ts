/**
 * @core-prevents the Quest Giver's own reads of a Quest whose project folder was retired failing with a raw realpath error
 * @core-observed September 17, integrated check of origin/agents: `quest list` reported "1 recorded project
 * folder is gone, so Quests saved against C:\Users\Jk101\Projects\opencode-hub can be read and moved but
 * not started", and `quest get` on one of those same records answered
 * `{"code":"ENOENT","message":"ENOENT: no such file or directory, realpath 'C:\\Users\\Jk101\\Projects\\opencode-hub'"}`.
 * 82 of this installation's 110 records name that retired folder. Only the registered giver hit it:
 * giverContext resolved the recorded root through the filesystem for every read.
 */
import { expect, test } from 'bun:test'
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestStore } from '../quest/store'
import { physicalDirectory } from '../quest/project'
import { createQuestService } from '../quest/service'
import { saveUserGiver } from '../quest/giver-registry.mjs'

const GIVER = 'ses_theGiver'

async function givenAQuestWhoseFolderIsRetired() {
  const home = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-gone-')))
  const ledger = join(home, 'ledger'), retired = join(home, 'retired-hub'), destination = join(home, 'still-here')
  // Real checkouts, because moving a Quest requires one -- that is the operation the fix points at.
  for (const path of [ledger, retired, destination]) { mkdirSync(path, { recursive: true }); expect(spawnSync('git', ['init', path], { windowsHide: true }).status).toBe(0) }
  const store = new QuestStore(ledger)
  saveUserGiver(store.runtime, { state: 'bound', sessionID: GIVER, directory: ledger })

  const host: any = { get: async ({ sessionID }: any) => ({ id: sessionID, agent: 'quest-giver', location: { directory: ledger } }), active: async () => ({ data: {} }) }
  let dispose = () => {}
  const service = createQuestService(store, host, { directory: ledger, onDispose: (fn: any) => { dispose = fn }, startRun: async () => { throw Error('A worker must never be started for a folder that is gone') } })

  const created = await service.call('create', { title: 'Work recorded in a folder that later went away', description: 'It still has to be readable.', steps: [{ id: 'work', title: 'Do it' }] }, { sessionID: GIVER, id: 'create' })
  // Move it to the folder that is about to be retired, through the public operation that does that.
  await service.call('update', { id: created.id, projectRoot: retired }, { sessionID: GIVER, id: 'move' })
  rmSync(retired, { recursive: true, force: true })
  return { service, dispose, store, id: created.id, retired, destination }
}

test('a Quest whose project folder is gone still reads, and says so when asked to run', async () => {
  const { service, dispose, id, retired, destination } = await givenAQuestWhoseFolderIsRetired()
  try {
    for (const method of ['get', 'status', 'plan']) {
      const answer = await service.call(method, { id }, { sessionID: GIVER, id: method })
      expect(answer.id).toBe(id)
      expect(answer.title).toBe('Work recorded in a folder that later went away')
    }
    // The listing said these can be read and moved but not started; this is the "not started" half,
    // in the same words rather than a realpath error.
    for (const action of [
      () => service.call('run', { id, task: 'coding' }, { sessionID: GIVER, id: 'run' }),
      () => service.call('start', { id }, { sessionID: GIVER, id: 'start' }),
    ]) {
      const failure = await action().then(() => undefined, (error: any) => error)
      expect(failure?.code).toBe('PROJECT_FOLDER_GONE')
      expect(failure?.message).toContain(retired)
      expect(failure?.message).toContain('update projectRoot')
    }
    // And the move the message names is the one that works.
    const moved = await service.call('update', { id, projectRoot: destination }, { sessionID: GIVER, id: 'move-back' })
    expect(moved.id).toBe(id)
    const after = await service.call('get', { id }, { sessionID: GIVER, id: 'after' })
    expect(after.project.root).toBe(destination)
    // The move also clears the recorded giver source, which pointed at the folder it was created in.
    // Leaving it behind made the recommended move answer PROJECT_MISMATCH on the next read, so the
    // gate is past and dispatch reaches the launcher.
    const dispatched = await service.call('run', { id, task: 'coding' }, { sessionID: GIVER, id: 'run-after' }).then(() => undefined, (error: any) => error)
    expect(dispatched?.code).not.toBe('PROJECT_FOLDER_GONE')
    expect(dispatched?.code).not.toBe('PROJECT_MISMATCH')
  } finally { dispose() }
})
