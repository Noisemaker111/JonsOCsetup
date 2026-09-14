/**
 * @core-prevents channel preparation from sending a real prompt after the native host silently substituted a configured model missing from its stale models.json cache
 * @core-observed On 2026-09-11 preparation used opencode-go/deepseek-v4.1-flash against a cache from before that model shipped; the host bound an OpenRouter twin, the access guard refused it, and no prompt or request receipt appeared.
 */
import {test, expect} from 'bun:test'
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ensureHostModelCatalog} from '../scripts/channel-prepare.mjs'

const catalog = (models: Record<string, unknown>) => ({'opencode-go': {id: 'opencode-go', models}})

test('refreshes the host cache when the configured route is absent and reports the change', async () => {
  const root = mkdtempSync(join(tmpdir(), 'channel-catalog-refresh-'))
  try {
    const file = join(root, 'opencode', 'models.json')
    mkdirSync(join(root, 'opencode'), {recursive: true})
    writeFileSync(file, JSON.stringify(catalog({'gpt-5.6-luna': {id: 'gpt-5.6-luna'}})))
    let calls = 0
    const result = await ensureHostModelCatalog({
      model: 'opencode-go/deepseek-v4.1-flash#high',
      cacheFile: file,
      source: 'https://catalog.example.invalid',
      fetchImpl: async () => { calls++; return {ok: true, status: 200, text: async () => JSON.stringify(catalog({'deepseek-v4.1-flash': {id: 'deepseek-v4.1-flash'}}))} },
    })
    expect(calls).toBe(1)
    expect(result.resolvedBy).toBe('host-cache')
    expect(result.refreshed).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.changedAt).toMatch(/T/)
    expect(JSON.parse(readFileSync(file, 'utf8'))['opencode-go'].models['deepseek-v4.1-flash'].id).toBe('deepseek-v4.1-flash')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('refuses an unresolved route after the refresh and never treats a fallback as success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'channel-catalog-refuse-'))
  try {
    const file = join(root, 'opencode', 'models.json')
    mkdirSync(join(root, 'opencode'), {recursive: true})
    const before = JSON.stringify(catalog({'gpt-5.6-luna': {id: 'gpt-5.6-luna'}}))
    writeFileSync(file, before)
    let calls = 0
    await expect(ensureHostModelCatalog({
      model: 'opencode-go/not-a-real-model#high',
      cacheFile: file,
      source: 'https://catalog.example.invalid',
      fetchImpl: async () => { calls++; return {ok: true, status: 200, text: async () => before} },
    })).rejects.toThrow(/no prompt was sent/)
    expect(calls).toBe(1)
  } finally { rmSync(root, {recursive: true, force: true}) }
})
