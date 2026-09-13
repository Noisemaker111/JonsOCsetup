import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { questOperations } from './operations.mjs'

/** Standard MCP transport for other harnesses; all work remains in the connected Quest service. */
export async function serveQuestStdio(client) {
  const server = new Server({ name: 'quests', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(questOperations).map(([name, op]) => ({ name, description: op.description, inputSchema: op.input, outputSchema: op.output })) }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      if (!Object.hasOwn(questOperations, request.params.name)) throw Error('Unknown Quest operation')
      const result = await client[request.params.name](request.params.arguments ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error.code ?? 'REQUEST_FAILED', message: error.message }) }] }
    }
  })
  await server.connect(new StdioServerTransport())
  return server
}
