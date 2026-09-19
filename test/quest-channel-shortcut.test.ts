/**
 * @core-prevents activation leaving `quest` on an older npm-installed CLI, so the running release serves Quest Web while the user's command rejects `quest web` as unknown.
 * @core-observed On 2026-09-19 the activated verified release served Quest Web, but `Get-Command quest` resolved to AppData/Roaming/npm and `quest health --json` returned `Unknown Quest operation: health` because activation installed only `oc`.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runQuestChannel } from '../scripts/quest-channel.mjs'

test('the installed Quest command follows the active development release', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'quest-channel-'))
  const registry = join(fixture, 'channels'), root = join(fixture, 'release')
  mkdirSync(join(root, 'quest'), { recursive: true })
  mkdirSync(registry, { recursive: true })
  writeFileSync(join(registry, 'dev.json'), JSON.stringify({ root }))
  writeFileSync(join(root, 'quest', 'cli.mjs'), 'export const runQuestCLI = args => JSON.stringify({args,root:process.env.OPENCODE_CONFIG_DIR,channel:process.env.OPENCODE_RELEASE_CHANNEL})\n')
  expect(JSON.parse(await runQuestChannel({ registry, args: ['web'] }))).toEqual({ args: ['web'], root, channel: 'dev' })

  const installer = readFileSync(join(import.meta.dir, '..', 'scripts', 'install-channel-shortcuts.mjs'), 'utf8')
  expect(installer).toContain("'quest-channel.mjs'")
  expect(installer).toContain("join(bin,'quest.cmd')")
})
