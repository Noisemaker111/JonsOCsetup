#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import { questOperations } from './operations.mjs'
import { createQuestClient } from './client.mjs'

const flag = key => '--' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())
const kind = schema => schema.enum ? schema.enum.map(value => JSON.stringify(value)).join(' | ') : schema.anyOf ? schema.anyOf.map(kind).join(' | ') : schema.type ?? 'JSON'
function shape(schema, prefix = '') {
  if (schema.items) return shape(schema.items, prefix + '[]')
  return Object.entries(schema.properties ?? {}).flatMap(([key, field]) => {
    const path = prefix ? prefix + '.' + key : key
    return ['    ' + path + ': ' + kind(field) + (schema.required?.includes(key) ? ' (required)' : '') + (field.description ? ' — ' + field.description : ''), ...shape(field, path)]
  })
}
export function questHelp(method) {
  if (!method) return ['quest <operation> [arguments]', '', ...Object.entries(questOperations).map(([name, op]) => `  ${name} ${op.positional.map(key => '<' + key + '>').join(' ')}\n    ${op.description}`), '', '  mcp\n    Serve the same operations over MCP stdio.', '', 'Use quest <operation> --help for arguments. Results are JSON.'].join('\n')
  const op = questOperations[method]
  if (!op) throw Error('Unknown Quest operation: ' + method)
  return [`quest ${method} ${op.positional.map(key => '<' + key + '>').join(' ')}`, op.description, '', ...Object.entries(op.input.properties).flatMap(([key, schema]) => [`  ${op.positional.includes(key) ? key : flag(key)} <${kind(schema)}>${op.input.required.includes(key) ? ' (required)' : ''}${schema.description ? '\n    ' + schema.description : ''}`, ...shape(schema, key)]), '', '  --input-json  Read argument JSON from stdin; flags may add other fields.', '  --help --json  Print the complete shared operation contract.'].join('\n')
}

export function parseQuestArguments(args, initial = {}) {
  const [method, ...rest] = args
  const op = questOperations[method]
  if (!op) throw Error('Unknown Quest operation: ' + method)
  if (!initial || typeof initial !== 'object' || Array.isArray(initial)) throw Error('Input must be a JSON object')
  for (const key of Object.keys(initial)) if (!Object.hasOwn(op.input.properties, key)) throw Error('Unknown input field: ' + key)
  const input = { ...initial }, flags = new Map(Object.keys(op.input.properties).map(key => [flag(key), key]))
  let position = 0
  for (let i = 0; i < rest.length; i++) {
    const item = rest[i]
    const key = item.startsWith('--') ? flags.get(item) : op.positional[position++]
    if (!key || Object.hasOwn(input, key)) throw Error('Unknown or repeated argument: ' + item)
    const schema = op.input.properties[key]
    const value = item.startsWith('--') ? schema.type === 'boolean' && (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) ? 'true' : rest[++i] : item
    if (value === undefined) throw Error('Missing value for ' + item)
    input[key] = schema.type === 'string' || schema.enum?.every(value => typeof value === 'string') ? value : JSON.parse(value)
  }
  for (const key of op.input.required) if (!Object.hasOwn(input, key)) throw Error('Required argument: ' + (op.positional.includes(key) ? key : flag(key)))
  return { method, input }
}

export async function runQuestCLI(args, client = createQuestClient()) {
  if (args[0] === 'mcp' && (args.includes('--help') || args.includes('-h'))) return 'quest mcp\nServe the generated Quest operations over MCP stdio.'
  if (args[0] === 'mcp') {
    const { serveQuestStdio } = await import('./mcp-client.mjs')
    await serveQuestStdio(client)
    return
  }
  if (!args.length || ['help', '--help', '-h'].includes(args[0])) return questHelp(args[1])
  if (args.includes('--help') || args.includes('-h')) return args.includes('--json') ? JSON.stringify(questOperations[args[0]]) : questHelp(args[0])
  let initial = {}
  if (args.includes('--input-json')) {
    if (process.stdin.isTTY) throw Error('Pipe a JSON object to --input-json')
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    initial = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    args = args.filter(arg => arg !== '--input-json')
  }
  const { method, input } = parseQuestArguments(args, initial)
  return JSON.stringify(await client[method](input))
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { const result = await runQuestCLI(process.argv.slice(2)); if (result !== undefined) console.log(result) }
  catch (error) { console.error(JSON.stringify({ code: error.code ?? 'INVALID_INPUT', message: error.message })); process.exitCode = 1 }
}
