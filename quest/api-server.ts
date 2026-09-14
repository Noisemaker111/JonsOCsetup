import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
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

async function openQuestServer(store: QuestStore, registrations: Set<Registration>) {
  const token = randomBytes(32).toString('hex'), instance = randomUUID()
  const registry = process.env.QUEST_API_REGISTRY ?? join(store.runtime, 'quest-api')
  const record = join(registry, instance + '.json')
  const giver = () => {
    const current = readUserGiver(store.runtime)
    const registration = current?.state === 'bound' && [...registrations].find(row => row.owner === current.directory)
    return registration ? { sessionID: current.sessionID, service: registration.service } : undefined
  }
  const call = (method: string, input: unknown, sessionID: string | undefined, requestID: string, service = giver()?.service, external = false) => {
    if (!sessionID || !service) throw Error('The Quest Giver service is not connected yet.')
    return service.call(method, input, { sessionID, id: requestID, external })
  }
  const http = createServer(async (request, response) => {
    const json = (status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
    const authorization = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from('Bearer ' + token)
    if (request.headers.origin || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      json(403, { code: 'FORBIDDEN', message: 'Quest API credentials are required; browser-origin requests are not accepted.' }); return
    }
    try {
      if (request.url === '/health' && request.method === 'GET') { json(200, { instance, ready: !!giver() }); return }
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
  writeFileSync(record, JSON.stringify({ version: 2, instance, url, token, pid: process.pid }), { mode: 0o600 })
  return {
    url, token,
    dispose() { http.close(); try { unlinkSync(record) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } },
  }
}
