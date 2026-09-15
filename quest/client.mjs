import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, uptime } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { questOperations } from './operations.mjs'

export class QuestAPIError extends Error {
  constructor(code, message) { super(message); this.name = 'QuestAPIError'; this.code = code }
}

/** Discover only a live service. Clients never import implementation or open the ledger. */
export async function discoverQuestAPI({ registry = process.env.QUEST_API_REGISTRY ?? join(process.env.OPENCODE_QUEST_ROOT ?? join(homedir(), '.config/opencode/.channels/state/dev/quests'), '.opencode/.quest-runtime/quest-api'), signal = AbortSignal.timeout(15000) } = {}) {
  let files
  try { files = readdirSync(registry).filter(name => name.endsWith('.json')) }
  catch { throw new QuestAPIError('UNAVAILABLE', 'Open the Quest Giver in oc before using the Quest API.') }
  const unavailable = []
  let outdated = 0
  // A receipt is written when a backend starts, so one written before this boot describes a
  // service that no longer exists -- whatever its recorded PID now belongs to. Windows reassigns
  // those PIDs freely: of 260 receipts on the machine this was found on, 212 predated the boot,
  // and probing them spent the whole discovery budget on EPERM and hung sockets belonging to
  // unrelated processes, so a Quest Giver that was serving normally reported UNAVAILABLE.
  const bootedAt = Date.now() - uptime() * 1000
  const candidates = await Promise.all(files.map(async name => {
    try {
      const path = join(registry, name)
      if (statSync(path).mtimeMs < bootedAt) return
      const endpoint = JSON.parse(readFileSync(path, 'utf8'))
      if (endpoint.version !== 2) { outdated++; return }
      if (!Number.isSafeInteger(endpoint.pid) || endpoint.pid <= 0) return
      try { process.kill(endpoint.pid, 0) } catch (error) { if (error.code === 'ESRCH') return; throw error }
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url) || typeof endpoint.token !== 'string') return
      const response = await fetch(endpoint.url + '/health', { headers: { authorization: 'Bearer ' + endpoint.token }, signal })
      const health = response.ok && await response.json()
      if (health?.ready && health.instance === endpoint.instance) return endpoint
    } catch (error) {
      // Keep failures visible without disclosing credentials or changing a saved admission.
      unavailable.push(error.name === 'TimeoutError' ? 'discovery timed out' : error.cause?.code ?? error.code ?? error.message)
    }
  }))
  const live = candidates.filter(Boolean)
  if (live.length !== 1) throw new QuestAPIError('UNAVAILABLE', live.length ? 'Several Quest Givers are serving this registry; select the intended registry explicitly.' : 'No ready Quest Giver responded. Open oc and try again.' + (outdated ? ' Older discovery records exist; reopen oc with the current agents code.' : '') + (unavailable.length ? ' Discovery: ' + [...new Set(unavailable)].join('; ') : ''))
  return live[0]
}

export function createQuestClient({ endpoint, discover = discoverQuestAPI } = {}) {
  return Object.fromEntries(Object.keys(questOperations).map(method => [method, async (input = {}, options = {}) => {
    const service = endpoint ?? await discover()
    const response = await fetch(service.url + '/api/' + method, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + service.token, 'idempotency-key': options.requestID ?? randomUUID() },
      body: JSON.stringify(input), signal: options.signal,
    })
    const result = await response.json()
    if (!response.ok) throw new QuestAPIError(result.code ?? 'REQUEST_FAILED', result.message ?? 'Quest request failed')
    return result
  }]))
}
