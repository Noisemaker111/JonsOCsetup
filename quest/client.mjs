import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { questOperations } from './operations.mjs'
import { readRegistry } from './api-registry.mjs'

export class QuestAPIError extends Error {
  constructor(code, message) { super(message); this.name = 'QuestAPIError'; this.code = code }
}

export const defaultQuestRegistry = () => process.env.QUEST_API_REGISTRY ?? join(process.env.OPENCODE_QUEST_ROOT ?? join(homedir(), '.config/opencode/.channels/state/dev/quests'), '.opencode/.quest-runtime/quest-api')

/**
 * Discover only a live service. Clients never import implementation or open the ledger.
 *
 * Every candidate used to share one 15-second AbortSignal, so the receipts ahead of the real server
 * in directory order spent the whole budget on hung sockets belonging to unrelated processes and the
 * one server that would have answered was never asked. Each candidate now gets its own deadline, they
 * are probed together, and the newest ready one wins -- a restarted host is the one a caller means.
 * When none answers the error says how many receipts were tried and what each of them said, because
 * "No ready Quest Giver responded ... Discovery: EPERM; ECONNREFUSED; discovery timed out" named
 * neither how many were involved nor which of them was the Quest Giver.
 */
export async function discoverQuestAPI({ registry = defaultQuestRegistry(), signal, candidateMilliseconds = 3000 } = {}) {
  const { endpoints, removed } = readRegistry(registry)
  const swept = removed ? ' Removed ' + removed + ' receipt' + (removed === 1 ? '' : 's') + ' whose host is gone.' : ''
  if (!endpoints.length) throw new QuestAPIError('UNAVAILABLE', 'No Quest API receipt names a running host. Open the Quest Giver in oc before using the Quest API.' + swept)
  const answers = endpoints.map(async endpoint => {
    const deadline = AbortSignal.timeout(candidateMilliseconds)
    const bound = signal ? AbortSignal.any([signal, deadline]) : deadline
    const started = Date.now()
    try {
      const response = await fetch(endpoint.url + '/health', { headers: { authorization: 'Bearer ' + endpoint.token }, signal: bound })
      if (!response.ok) return { endpoint, answer: 'HTTP ' + response.status }
      const health = await response.json()
      if (health?.instance !== endpoint.instance) return { endpoint, answer: 'a different service now holds that port' }
      if (!health.ready) return { endpoint, answer: 'serving, but no Quest Giver is bound to it yet' }
      return { endpoint: { ...endpoint, health, healthMilliseconds: Date.now() - started }, answer: 'ready', ready: true }
    } catch (error) {
      return { endpoint, answer: error.name === 'TimeoutError' || error.cause?.name === 'TimeoutError' ? 'no answer within ' + candidateMilliseconds + ' ms' : error.cause?.code ?? error.code ?? error.message }
    }
  })
  // Newest first, because that is the order readRegistry returns and the newest receipt is the host a
  // caller means. Every probe is already in flight, so this waits for the newest, not for all of them.
  for (const pending of answers) { const result = await pending; if (result.ready) return result.endpoint }
  const said = (await Promise.all(answers)).map(r => 'pid ' + r.endpoint.pid + ' on ' + r.endpoint.url + ' — ' + r.answer).join('; ')
  throw new QuestAPIError('UNAVAILABLE', 'No ready Quest Giver answered. Tried ' + endpoints.length + ' receipt' + (endpoints.length === 1 ? '' : 's') + ': ' + said + '.' + swept + ' Open oc and try again.')
}

/**
 * The global fetch gives up on response headers after 300 seconds and throws
 * `TypeError: fetch failed` with cause UND_ERR_HEADERS_TIMEOUT, measured at 307,112 ms against a
 * deliberately slow local server. A real dispatch takes longer than that: three runs on 2026-09-16
 * bound their sessions 584, 613 and 665 seconds after being planned, and every one of them reported
 * failure to a caller whose work was in fact already running. node:http imposes no such deadline,
 * and options.signal still cancels.
 */
function postToService(service, method, body, headers, signal) {
  return new Promise((resolve, reject) => {
    const target = new URL(service.url + '/api/' + method)
    const call = httpRequest({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers }, answer => {
      const chunks = []
      answer.on('data', chunk => chunks.push(chunk))
      answer.on('error', reject)
      answer.on('end', () => resolve({ ok: answer.statusCode >= 200 && answer.statusCode < 300, status: answer.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    call.on('error', reject)
    if (signal) {
      const cancelled = () => signal.reason ?? new Error('The Quest request was cancelled')
      if (signal.aborted) { call.destroy(cancelled()); reject(cancelled()); return }
      signal.addEventListener('abort', () => call.destroy(cancelled()), { once: true })
    }
    call.end(body)
  })
}

export function createQuestClient({ endpoint, discover = discoverQuestAPI } = {}) {
  return Object.fromEntries(Object.keys(questOperations).map(method => [method, async (input = {}, options = {}) => {
    const service = endpoint ?? await discover()
    const body = JSON.stringify(input)
    let response
    try {
      response = await postToService(service, method, body, {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
        authorization: 'Bearer ' + service.token, 'idempotency-key': options.requestID ?? randomUUID(),
      }, options.signal)
    } catch (error) {
      // The request had already left this process, so a transport failure says nothing about
      // whether the service applied it. Calling that invalid input tells the caller their request
      // was wrong and invites a second dispatch for work that is already running.
      const cause = error.cause?.code ?? error.code ?? error.message
      if (questOperations[method].annotations?.readOnlyHint) throw new QuestAPIError('UNAVAILABLE', 'The Quest Giver did not answer ' + method + ' (' + cause + '). Nothing was read and nothing changed.')
      throw new QuestAPIError('OUTCOME_UNKNOWN', 'The Quest Giver did not answer ' + method + ' (' + cause + '). The request may already have been applied; read the Quest before sending it again.')
    }
    const result = JSON.parse(response.body)
    if (!response.ok) throw new QuestAPIError(result.code ?? 'REQUEST_FAILED', result.message ?? 'Quest request failed')
    return result
  }]))
}
