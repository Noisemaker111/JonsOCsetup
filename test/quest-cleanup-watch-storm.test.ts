/**
 * @core-prevents the cleanup installer respawning git for the same workspace root on every trigger
 * @core-observed September 15: 7 workspace records pointed at C:\Users\Jk101\.config\opencode, which is
 * not a repository. Each trigger reprobed all 7, so the host logged 779 `spawning process git` lines in a
 * 1.2 MB slice of one session and its own quests MCP server answered ECONNRESET.
 */
import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestStore } from '../quest/store'
import { installQuestCleanup } from '../quest/cleanup'

test('a workspace root outside a repository is probed once, however many records name it', async () => {
 const project = mkdtempSync(join(tmpdir(), 'cleanup-storm-')), outside = mkdtempSync(join(tmpdir(), 'not-a-repo-'))
 const store = new QuestStore(project), workspaces = join(store.runtime, 'workspaces')
 mkdirSync(workspaces, { recursive: true })
 for (const id of ['first', 'second', 'third']) {
  writeFileSync(join(workspaces, id + '.json'), JSON.stringify({ runID: id, questID: 'q', root: outside, path: outside, mode: 'worktree', cleanupProtocol: 1 }))
 }
 const errors: string[] = [], real = console.error
 console.error = (...parts: unknown[]) => { errors.push(parts.map(String).join(' ')) }
 try {
  const dispose = installQuestCleanup(store, {})
  await new Promise(done => setTimeout(done, 400))
  dispose()
 } finally { console.error = real; rmSync(project, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
 // One probe for the root, not one per record naming it. Before this, three records meant three
 // `git rev-parse` processes, repeated for the life of the host every time cleanup was woken.
 expect(errors.filter(line => line.includes('[quests] cleanup watch')).length).toBe(1)
})
