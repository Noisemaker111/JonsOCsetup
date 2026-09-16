/**
 * @core-prevents a stale registered giver location leaving the board with no coordinator at all
 * @core-observed September 16: the giver was registered at Projects/opencode-hub on September 15 and never
 * re-recorded, while `oc` opens it in Projects/JonsOCsetup. Only the registered location runs the board polls,
 * so reconciliation, start admission, continuation and return delivery were all skipped on every launch.
 * Thirteen Quests sat still: workers that ended hours earlier still held their steps, two Quests with every
 * step done refused to archive with ACTIVE_RUNS, and three saved `quest start` requests were never consumed.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureUserGiver } from '../quest/user-giver'
import { readUserGiver, saveUserGiver } from '../quest/giver-registry.mjs'
import { physicalDirectory } from '../quest/project'
import { QuestStore } from '../quest/store'

const giverID = 'ses_giver_location_0001'

function bound(root: string, directory: string) {
  const store = new QuestStore(root)
  saveUserGiver(store.runtime, { state: 'bound', sessionID: giverID, directory: physicalDirectory(directory) })
  return store
}

test('the registered location follows the conversation the giver is open in', async () => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'giver-location-')))
  const opened = physicalDirectory(mkdtempSync(join(tmpdir(), 'giver-opened-')))
  const registered = physicalDirectory(mkdtempSync(join(tmpdir(), 'giver-registered-')))
  const store = bound(root, registered)
  const host = { get: async ({ sessionID }: any) => ({ id: sessionID, location: { directory: opened } }) }

  await ensureUserGiver(store, host, undefined, opened)

  // The board polls compare against this, so it has to name where the giver actually is.
  expect(physicalDirectory(readUserGiver(store.runtime)!.directory)).toBe(opened)
  expect(readUserGiver(store.runtime)!.sessionID).toBe(giverID)
})

test('a giver already open where it is registered is left alone', async () => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'giver-same-')))
  const where = physicalDirectory(mkdtempSync(join(tmpdir(), 'giver-same-at-')))
  const store = bound(root, where)
  const before = readUserGiver(store.runtime)!.updatedAt
  const host = { get: async ({ sessionID }: any) => ({ id: sessionID, location: { directory: where } }) }

  await ensureUserGiver(store, host, undefined, where)

  expect(readUserGiver(store.runtime)!.updatedAt).toBe(before)
})

test('a host that reports no location leaves the registration as it was', async () => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'giver-nowhere-')))
  const registered = physicalDirectory(mkdtempSync(join(tmpdir(), 'giver-nowhere-at-')))
  const store = bound(root, registered)
  const host = { get: async ({ sessionID }: any) => ({ id: sessionID }) }

  await ensureUserGiver(store, host, undefined, registered)

  expect(physicalDirectory(readUserGiver(store.runtime)!.directory)).toBe(registered)
})
