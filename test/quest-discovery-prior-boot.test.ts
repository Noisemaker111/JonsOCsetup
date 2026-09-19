/**
 * @core-prevents stale discovery receipts from a previous boot making a live Quest Giver undiscoverable
 * @core-observed September 15: 260 receipts in one registry, 212 written before the current boot. Windows had
 * reassigned their PIDs, so discovery probed unrelated processes and answered UNAVAILABLE with
 * "EPERM; ECONNREFUSED; discovery timed out" while the Quest Giver was serving normally.
 */
import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir, uptime } from 'node:os'
import { join } from 'node:path'
import { discoverQuestAPI } from '../quest/client.mjs'

const serve = (instance: string, onHit: () => void) => Bun.serve({
  port: 0,
  fetch(request) {
    onHit()
    return new URL(request.url).pathname === '/health'
      ? Response.json({ ready: true, instance })
      : new Response('', { status: 404 })
  },
})

test('a receipt written before this boot is not probed, even when its recorded PID is alive', async () => {
  const registry = mkdtempSync(join(tmpdir(), 'quest-api-registry-'))
  let currentHits = 0, priorHits = 0
  const current = serve('current', () => { currentHits++ }), prior = serve('prior', () => { priorHits++ })
  try {
    const receipt = (instance: string, url: string) => JSON.stringify({ version: 2, instance, url, token: 'token-' + instance, pid: process.pid })
    writeFileSync(join(registry, 'current.json'), receipt('current', 'http://127.0.0.1:' + current.port))
    const stale = join(registry, 'prior.json')
    writeFileSync(stale, receipt('prior', 'http://127.0.0.1:' + prior.port))
    // Written before the machine booted, so its service cannot still be running. Both receipts
    // name this live PID, which is exactly the reuse that made the old check admit them equally.
    const before = (Date.now() - uptime() * 1000 - 60_000) / 1000
    utimesSync(stale, before, before)

    const endpoint = await discoverQuestAPI({ registry })
    expect(endpoint.instance).toBe('current')
    expect(currentHits).toBeGreaterThan(0)
    expect(priorHits).toBe(0)
  } finally {
    await current.stop(true); await prior.stop(true)
    rmSync(registry, { recursive: true, force: true })
  }
})
