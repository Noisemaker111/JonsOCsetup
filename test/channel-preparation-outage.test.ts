/**
 * @core-prevents an exhausted provider discarding a release that loaded, so `oc` silently runs older code
 * @core-observed September 15, 22:34: `oc` built the merged commit, the server plugin loaded from that exact
 * generation at 22:35:04, the preparation prompt failed 0.7s later because the activated route resolved to an
 * OpenAI account with nothing left, and the launcher threw the release away and started the release from 12:13.
 * Four merged UI fixes were absent from the running editor with only a fallback notice to say so, and the run
 * that produced nothing still cost two minutes, because the host does not exit when its request fails.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgePreparation, watchProviderSettlement } from '../scripts/channel-prepare.mjs'

const providerFailure = { route: { providerID: 'cliproxyapi', modelID: 'gpt-5.6-luna' }, accountID: 'openai-429c9885edc3' }

test('a generation that loaded is kept when the provider had nothing left to answer with', () => {
  const judged = judgePreparation({ loaded: true, answered: false, providerFailure })

  // Runnable, and honest that nothing confirmed it end to end.
  expect(judged.accepted).toBe(true)
  expect(judged.ok).toBe(false)
  expect(judged.probe).toBe('provider-unavailable')
})

test('a generation that never loaded is still refused, provider or no provider', () => {
  expect(judgePreparation({ loaded: false, answered: false, providerFailure }).accepted).toBe(false)
  expect(judgePreparation({ loaded: false, answered: true }).accepted).toBe(false)
})

test('a provider that answered is the fully verified case', () => {
  const judged = judgePreparation({ loaded: true, answered: true })
  expect(judged).toMatchObject({ ok: true, accepted: true, probe: 'answered' })
})

test('the wait ends when the ledger records the request failing, not at the timeout', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'prepare-ledger-')), 'requests.jsonl')
  const since = Date.now()
  const controller = new AbortController()
  const watch = watchProviderSettlement({ controller, since, file, interval: 1_000_000 })
  try {
    expect(controller.signal.aborted).toBe(false)

    // The record the host actually wrote at 22:35:06, replayed field for field.
    writeFileSync(file, JSON.stringify({ version: 1, request: {
      id: '68810e44-3f9c-43d8-b215-68d9942276b2', sessionID: 'ses_f57eea69affeiyoxp6mQWCGWZD',
      accountID: 'openai-429c9885edc3fc7113fc', accountRegime: 'cc4dc650aee6c8ea',
      route: { providerID: 'cliproxyapi', modelID: 'gpt-5.6-luna', variant: 'max', reasoning: 'max', serviceTier: 'default' },
      kind: 'primary', startedAt: since + 700, state: 'failed', recordedAt: since + 725, completedAt: since + 725,
    } }) + '\n')
    watch.poll()

    expect(controller.signal.aborted).toBe(true)
    expect(watch.failure()).toMatchObject({ accountID: 'openai-429c9885edc3fc7113fc' })
  } finally { watch.stop() }
})

test('a request that was already running before this preparation is not mistaken for its own', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'prepare-ledger-older-')), 'requests.jsonl')
  const since = Date.now()
  const controller = new AbortController()
  const watch = watchProviderSettlement({ controller, since, file, interval: 1_000_000 })
  try {
    writeFileSync(file, JSON.stringify({ version: 1, request: { kind: 'primary', state: 'failed', startedAt: since - 5000 } }) + '\n')
    watch.poll()
    expect(controller.signal.aborted).toBe(false)
    expect(watch.failure()).toBeUndefined()
  } finally { watch.stop() }
})

test('a prompt that failed for no stated provider reason is not excused', () => {
  // Silence is not an outage: without a settled provider failure this is the release's own problem.
  const judged = judgePreparation({ loaded: true, answered: false })
  expect(judged.accepted).toBe(false)
  expect(judged.probe).toBe('failed')
})
