/**
 * @core-prevents the maintained source refusing every editing worker for want of a declared installer
 * @core-observed September 16: a Quest re-pointed to JonsOCsetup could not dispatch at all — "Configure this
 * project's bootstrap command before creating an editing worker: no supported declared package manager with a
 * committed lockfile". bun.lock was present and committed; package.json simply never declared packageManager,
 * and workspaceBootstrap requires both. Quests rooted at opencode-hub had never hit it, because that directory
 * has no package.json and so needs no bootstrap at all.
 */
import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { workspaceBootstrap } from '../quest/workspace-bootstrap'

const repository = join(import.meta.dir, '..')

test('an editing worker can be bootstrapped in this repository', () => {
  // Throwing here means no Quest delivering into the maintained source can ever create a worker.
  expect(workspaceBootstrap(repository)).toEqual(['bun', 'install', '--frozen-lockfile'])
})

test('an explicit recipe still wins over the declared installer', () => {
  expect(workspaceBootstrap(repository, ['make', 'setup'])).toEqual(['make', 'setup'])
})
