/**
 * @core-prevents a Quest stranded on a project root that is not a checkout, with no way to move it
 * @core-observed September 16: "Choose economical capable models automatically" was recorded against
 * C:\Users\Jk101\.config\opencode, which the hub defines as installed configuration and runtime storage and
 * forbids re-initialising as a repository. Every dispatch failed before reaching a worker with "Cannot
 * establish selected Git checkout", the worker traced it and said the fix belonged to the runtime, and the
 * public update operation had no field for it: the Quest was unreachable by any route or model.
 */
import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questsAPI } from '../quest/api'
import { physicalDirectory, projectIdentity, clearProjectIdentityCache } from '../quest/project'
import { QuestStore } from '../quest/store'

function checkout(prefix: string) {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), prefix)))
  execFileSync('git', ['init', '-q'], { cwd: root })
  return root
}

function api() {
  const root = checkout('quest-repoint-home-')
  const store = new QuestStore(root)
  const context: any = { sessionID: 'ses_giver', requestID: 'create', directory: root, project: projectIdentity(root) }
  return { store, api: questsAPI(store, context, async () => ({ sessionID: 'unused' })) }
}

test('a Quest can be moved to a maintained source checkout', () => {
  clearProjectIdentityCache()
  const { store, api: quests } = api()
  const created = quests.create({ title: 'Stranded on a directory that is not a checkout', description: 'Dispatch failed before any worker because the recorded project had no repository to bind.', steps: [{ id: 'work', title: 'Do the work' }] })
  const source = checkout('quest-repoint-source-')

  const saved = quests.update(created.id, { projectRoot: source })

  expect(physicalDirectory(saved.project!.root)).toBe(source)
  expect(store.read(created.id)!.project!.id).toBe(projectIdentity(source).id)
})

test('moving it somewhere equally unusable is refused', () => {
  clearProjectIdentityCache()
  const { api: quests } = api()
  const created = quests.create({ title: 'Stranded on a directory that is not a checkout either', description: 'The destination has to be a repository or the same failure follows it.', steps: [{ id: 'work', title: 'Do the work' }] })
  const notARepo = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-repoint-not-a-repo-')))

  expect(() => quests.update(created.id, { projectRoot: notARepo })).toThrow(/not a Git checkout/)
})

test('the public contract exposes projectRoot, or no caller can reach the fix', async () => {
  // api.ts accepting the field is not enough: service.ts validates against the operation contract
  // first, and a Quest that needs moving is reached through that contract and nothing else.
  const { questOperations } = await import('../quest/operations.mjs')
  const projectRoot = (questOperations as any).update.input.properties.projectRoot

  expect(projectRoot).toBeDefined()
  expect(String(projectRoot.description)).toMatch(/Git checkout/)
})
