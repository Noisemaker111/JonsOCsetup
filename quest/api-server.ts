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

/** The host owns this listener and its lifetime; clients never start a second coordinator. */
export async function serveQuestAPI(store: QuestStore, service: ReturnType<typeof createQuestService>, directory: string) {
  const token = randomBytes(32).toString('hex'), instance = randomUUID()
  const owner = physicalDirectory(directory)
  const registry = process.env.QUEST_API_REGISTRY ?? join(store.runtime, 'quest-api')
  const record = join(registry, instance + '.json')
  const giver = () => {
    const current = readUserGiver(store.runtime)
    return current?.state === 'bound' && current.directory === owner ? current.sessionID : undefined
  }
  const call = (method: string, input: unknown, sessionID: string | undefined, requestID: string) => {
    if (!sessionID) throw Error('No connected Quest Giver. Open oc before calling the API.')
    return service.call(method, input, { sessionID, id: requestID })
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
      if (request.url === '/mcp' || request.url === '/mcp/session') {
        const mcp = new Server({ name: 'quests', version: '1.0.0' }, { capabilities: { tools: {} } })
        mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(questOperations).map(([name, op]) => ({ name, description: op.description, inputSchema: op.input, outputSchema: op.output })) }))
        mcp.setRequestHandler(CallToolRequestSchema, async (message, extra) => {
          try {
            // OpenCode supplies correlation metadata outside model-controlled arguments.
            const metadata = message.params._meta?.sessionID
            const sessionID = typeof metadata === 'string' ? metadata : request.url === '/mcp' ? giver() : undefined
            if (!sessionID) throw Error('The OpenCode MCP connection must supply its session identity.')
            const result = await call(message.params.name, message.params.arguments ?? {}, sessionID, instance + ':' + randomUUID() + ':' + extra.requestId)
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
      json(200, await call(method, input, giver(), requestID))
    } catch (error) {
      if (!response.headersSent) json(400, { code: (error as any).code ?? 'REQUEST_FAILED', message: (error as Error).message })
    }
  })
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve) })
  http.unref()
  const url = 'http://127.0.0.1:' + (http.address() as { port: number }).port
  mkdirSync(registry, { recursive: true })
  writeFileSync(record, JSON.stringify({ instance, url, token }), { mode: 0o600 })
  return {
    url, token,
    dispose() { http.close(); try { unlinkSync(record) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } },
  }
}
