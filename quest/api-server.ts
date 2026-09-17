import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, watch, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readRegistry, receiptName } from './api-registry.mjs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { questOperations } from './operations.mjs'
import { readUserGiver } from './giver-registry.mjs'
import { physicalDirectory } from './project'
import type { QuestStore } from './store'
import type { createQuestService } from './service'

type Registration = { id: string; owner: string; service: ReturnType<typeof createQuestService> }
const servers = new Map<string, { registrations: Set<Registration>; endpoint: ReturnType<typeof openQuestServer> }>()

/** One listener per host and ledger; each location retains its own trusted session adapter. */
export async function serveQuestAPI(store: QuestStore, service: ReturnType<typeof createQuestService>, directory: string) {
  const registration = { id: randomUUID(), owner: physicalDirectory(directory), service }
  let shared = servers.get(store.runtime)
  if (!shared) {
    const registrations = new Set<Registration>()
    shared = { registrations, endpoint: openQuestServer(store, registrations) }
    servers.set(store.runtime, shared)
  }
  shared.registrations.add(registration)
  const current = shared
  let disposed = false
  const remove = () => {
    if (disposed) return
    disposed = true
    current.registrations.delete(registration)
    if (!current.registrations.size && servers.get(store.runtime) === current) servers.delete(store.runtime)
  }
  try {
    const endpoint = await current.endpoint
    return { url: endpoint.url, token: endpoint.token, mcpURL: endpoint.url + '/mcp/session/' + registration.id,
      dispose() { remove(); if (!current.registrations.size) endpoint.dispose() },
    }
  } catch (error) { remove(); throw error }
}

/**
 * Which plugin build is answering.
 *
 * The running host was nine commits behind `origin/agents` while Jon read a report form that had
 * already been replaced, and nothing on any screen said so. `/health` carries it now, so a client can
 * name the generation and commit that served its answer.
 */
const identity = (() => {
  const generation = process.env.OPENCODE_PLUGIN_GENERATION ?? null
  let commit: string | null = null
  try { commit = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.deployment-source.json'), 'utf8')).commit ?? null } catch {}
  return { generation, commit }
})()

async function openQuestServer(store: QuestStore, registrations: Set<Registration>) {
  const token = randomBytes(32).toString('hex'), instance = randomUUID(), startedAt = new Date().toISOString()
  const registry = process.env.QUEST_API_REGISTRY ?? join(store.runtime, 'quest-api')
  const record = join(registry, receiptName(process.pid, store.runtime))
  const giver = () => {
    const current = readUserGiver(store.runtime)
    const registration = current?.state === 'bound' && [...registrations].find(row => row.owner === current.directory)
    return registration ? { sessionID: current.sessionID, service: registration.service } : undefined
  }
  /**
   * Readiness held in memory, so a probe costs nothing.
   *
   * `/health` used to call `giver()`, which reads the binding file and matches it against the
   * locations connected here -- work on the same JS thread that the Quest sweep was saturating, which
   * is why a probe of an endpoint that reads one small file answered in 13 to 40 seconds and
   * discovery reported UNAVAILABLE for a Quest Giver that was serving. The binding changes rarely and
   * says so on disk, so it is watched rather than read. If the watch cannot be installed the request
   * falls back to reading it, because a wrong `ready` is worse than a slow one.
   */
  let bound: string | undefined
  const refreshBinding = () => { try { const row = readUserGiver(store.runtime); bound = row?.state === 'bound' ? row.directory : undefined } catch { bound = undefined } }
  refreshBinding()
  let watched = false
  try {
    mkdirSync(store.runtime, { recursive: true })
    const watcher = watch(store.runtime, { recursive: false }, (_event, file) => { if (String(file ?? '') === 'user-giver.json') refreshBinding() })
    watcher.unref(); watcher.on('error', () => { watched = false }); watched = true
  } catch {}
  const ready = () => { if (!watched) refreshBinding(); return !!bound && [...registrations].some(row => row.owner === bound) }
  const call = (method: string, input: unknown, sessionID: string | undefined, requestID: string, service = giver()?.service, external = false) => {
    if (!sessionID || !service) throw Error('The Quest Giver service is not connected yet.')
    return service.call(method, input, { sessionID, id: requestID, external, native: !external })
  }
  const http = createServer(async (request, response) => {
    const json = (status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
    const authorization = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from('Bearer ' + token)
    if (request.headers.origin || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      json(403, { code: 'FORBIDDEN', message: 'Quest API credentials are required; browser-origin requests are not accepted.' }); return
    }
    try {
      if (request.url === '/health' && request.method === 'GET') { json(200, { instance, ready: ready(), pid: process.pid, startedAt, ...identity }); return }
      if (request.url === '/contract' && request.method === 'GET') { json(200, questOperations); return }
      const sessionRoute = request.url?.match(/^\/mcp\/session\/([a-f0-9-]+)$/)?.[1]
      if (request.url === '/mcp' || sessionRoute) {
        const registration = sessionRoute && [...registrations].find(row => row.id === sessionRoute)
        if (sessionRoute && !registration) { json(410, { code: 'LOCATION_CLOSED', message: 'The owning OpenCode location disconnected.' }); return }
        const mcp = new Server({ name: 'quests', version: '1.0.0' }, { capabilities: { tools: {} } })
        mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(questOperations).map(([name, op]) => ({ name, description: op.description, inputSchema: op.input, outputSchema: op.output, annotations: op.annotations })) }))
        mcp.setRequestHandler(CallToolRequestSchema, async (message, extra) => {
          try {
            // OpenCode supplies correlation metadata outside model-controlled arguments.
            const metadata = message.params._meta?.sessionID
            const sessionID = typeof metadata === 'string' ? metadata : request.url === '/mcp' ? giver()?.sessionID : undefined
            if (!sessionID) throw Error('The OpenCode MCP connection must supply its session identity.')
            const result = await call(message.params.name, message.params.arguments ?? {}, sessionID, instance + ':' + randomUUID() + ':' + extra.requestId, registration ? registration.service : giver()?.service, !registration)
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result }
          } catch (error) {
            return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ code: (error as any).code ?? 'REQUEST_FAILED', message: (error as Error).message }) }] }
          }
        })
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        response.on('close', () => { void transport.close(); void mcp.close() })
        await mcp.connect(transport)
        await transport.handleRequest(request, response)
        return
      }
      const method = request.url?.match(/^\/api\/([a-z]+)$/)?.[1]
      if (!method || request.method !== 'POST') { json(404, { code: 'NOT_FOUND', message: 'Unknown Quest API endpoint' }); return }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const requestID = request.headers['idempotency-key']
      if (typeof requestID !== 'string' || !requestID.trim()) { json(400, { code: 'INVALID_INPUT', message: 'An idempotency-key header is required.' }); return }
      json(200, await call(method, input, giver()?.sessionID, requestID, giver()?.service, true))
    } catch (error) {
      if (!response.headersSent) json(400, { code: (error as any).code ?? 'REQUEST_FAILED', message: (error as Error).message })
    }
  })
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve) })
  http.unref()
  const url = 'http://127.0.0.1:' + (http.address() as { port: number }).port
  mkdirSync(registry, { recursive: true })
  // Writing is also a read of this directory, so the receipts of hosts that are gone go with it.
  readRegistry(registry)
  writeFileSync(record, JSON.stringify({ version: 2, instance, url, token, pid: process.pid, startedAt: Date.parse(startedAt), generation: identity.generation, commit: identity.commit }), { mode: 0o600 })
  return {
    url, token,
    dispose() { http.close(); try { unlinkSync(record) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } },
  }
}
