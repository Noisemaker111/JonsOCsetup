import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { questOperations } from './operations.mjs'

export class QuestAPIError extends Error {
  constructor(code, message) { super(message); this.name = 'QuestAPIError'; this.code = code }
}

/** Discover only a live service. Clients never import implementation or open the ledger. */
export async function discoverQuestAPI({ registry = process.env.QUEST_API_REGISTRY ?? join(process.env.OPENCODE_QUEST_ROOT ?? join(homedir(), '.config/opencode/.channels/state/dev/quests'), '.opencode/.quest-runtime/quest-api') } = {}) {
  let files
  try { files = readdirSync(registry).filter(name => name.endsWith('.json')) }
  catch { throw new QuestAPIError('UNAVAILABLE', 'Open the Quest Giver in oc before using the Quest API.') }
  const candidates = await Promise.all(files.map(async name => {
    try {
      const endpoint = JSON.parse(readFileSync(join(registry, name), 'utf8'))
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url) || typeof endpoint.token !== 'string') return
      const response = await fetch(endpoint.url + '/health', { headers: { authorization: 'Bearer ' + endpoint.token }, signal: AbortSignal.timeout(2000) })
      const health = response.ok && await response.json()
      if (health?.ready && health.instance === endpoint.instance) return endpoint
    } catch { /* A stopped host is not a service candidate. Preserve its receipt for inspection. */ }
  }))
  const live = candidates.filter(Boolean)
  if (live.length !== 1) throw new QuestAPIError('UNAVAILABLE', live.length ? 'Several Quest Givers are serving this registry; select the intended registry explicitly.' : 'No connected Quest Giver is serving this registry. Open oc and try again.')
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
