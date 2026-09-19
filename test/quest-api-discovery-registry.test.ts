/**
 * @core-prevents a Quest API registry of abandoned receipts spending one shared discovery budget so the serving host is never asked
 * @core-observed September 17, 03:10 UTC: `quest list` from the installed CLI answered UNAVAILABLE with
 * "Discovery: EPERM; ECONNREFUSED; discovery timed out" while the Quest Giver was serving normally. The
 * registry held 306 receipts — 212 written before the boot, 92 naming processes that no longer existed, one
 * naming a live process whose port refused — every one of them probed on a single shared 15 s AbortSignal,
 * and Windows EPERM from process.kill(pid, 0) on a reused PID was rethrown as a discovery error. Receipts
 * were removed only by dispose(), which never runs when a host exits abruptly.
 */
import { afterAll, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestStore } from '../quest/store'
import { serveQuestAPI } from '../quest/api-server'
import { saveUserGiver } from '../quest/giver-registry.mjs'
import { physicalDirectory } from '../quest/project'
import { discoverQuestAPI, QuestAPIError } from '../quest/client.mjs'
import { bootedAt, processLiveness } from '../quest/api-registry.mjs'

const disposers: Array<() => void> = []
afterAll(() => { for (const dispose of disposers) try { dispose() } catch {} })

/** A PID that certainly no longer exists: a real process, started and awaited to exit. */
async function departedPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true })
  await new Promise(resolve => child.once('exit', resolve))
  return child.pid!
}

/** A candidate that accepts the connection and never answers, which is what a saturated host looked like. */
async function slowCandidate() {
  const held: any[] = []
  const server = createServer((_request, response) => { held.push(response) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  disposers.push(() => { for (const response of held) response.destroy(); server.close() })
  return 'http://127.0.0.1:' + port
}

async function servingHost() {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-discovery-')))
  const store = new QuestStore(root)
  saveUserGiver(store.runtime, { state: 'bound', sessionID: 'ses_theGiver', directory: root })
  const endpoint = await serveQuestAPI(store, { call: async () => ({ ok: true }) } as any, root)
  disposers.push(() => endpoint.dispose())
  return { store, registry: join(store.runtime, 'quest-api'), endpoint }
}

test('a registry full of abandoned receipts still finds the host that is serving, and loses them', async () => {
  const { store, registry, endpoint } = await servingHost()
  const gone = await departedPid()

  writeFileSync(join(registry, 'departed.json'), JSON.stringify({ version: 2, instance: 'departed', url: 'http://127.0.0.1:1', token: 'x', pid: gone }))
  const preBoot = join(registry, 'pre-boot.json')
  writeFileSync(preBoot, JSON.stringify({ version: 2, instance: 'pre-boot', url: 'http://127.0.0.1:2', token: 'x', pid: process.pid }))
  const old = (bootedAt() - 60_000) / 1000
  utimesSync(preBoot, old, old)
  writeFileSync(join(registry, 'older-format.json'), JSON.stringify({ version: 1, instance: 'old', url: 'http://127.0.0.1:3', token: 'x', pid: process.pid }))
  // Newest of all, alive, and it never answers: without a per-candidate deadline this one consumed the
  // whole budget and the serving host below was never asked.
  writeFileSync(join(registry, 'slow.json'), JSON.stringify({ version: 2, instance: 'slow', url: await slowCandidate(), token: 'x', pid: process.pid, startedAt: Date.now() + 60_000 }))

  expect(processLiveness(gone)).toBe('gone')

  const found = await discoverQuestAPI({ registry, candidateMilliseconds: 400 })
  expect(found.url).toBe(endpoint.url)
  expect(found.health.ready).toBe(true)
  expect(found.health.pid).toBe(process.pid)
  expect(typeof found.health.startedAt).toBe('string')
  expect(Object.hasOwn(found.health, 'generation')).toBe(true)
  expect(Object.hasOwn(found.health, 'commit')).toBe(true)

  // Reading the registry is what cleans it: nothing waits for a dispose that a killed host never runs.
  const left = readdirSync(registry)
  expect(left).not.toContain('departed.json')
  expect(left).not.toContain('pre-boot.json')
  expect(left).not.toContain('older-format.json')

  // One host, one receipt, whatever else it registers on the same listener.
  const second = await serveQuestAPI(store, { call: async () => ({ ok: true }) } as any, store.projectRoot)
  disposers.push(() => second.dispose())
  expect(readdirSync(registry).filter(name => JSON.parse(readFileSync(join(registry, name), 'utf8')).pid === process.pid && name !== 'slow.json')).toHaveLength(1)
})

test('when nothing is ready the error says how many receipts were tried and what each answered', async () => {
  const registry = mkdtempSync(join(tmpdir(), 'quest-registry-'))
  mkdirSync(registry, { recursive: true })
  writeFileSync(join(registry, 'refused.json'), JSON.stringify({ version: 2, instance: 'refused', url: 'http://127.0.0.1:1', token: 'x', pid: process.pid }))
  writeFileSync(join(registry, 'silent.json'), JSON.stringify({ version: 2, instance: 'silent', url: await slowCandidate(), token: 'x', pid: process.pid }))

  const failure = await discoverQuestAPI({ registry, candidateMilliseconds: 300 }).then(() => undefined, error => error as QuestAPIError)
  expect(failure?.code).toBe('UNAVAILABLE')
  expect(failure?.message).toContain('Tried 2 receipts')
  expect(failure?.message).toContain('no answer within 300 ms')
  expect(failure?.message).toMatch(/refus/i)
})
