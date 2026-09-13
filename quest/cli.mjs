#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { questOperations } from './operations.mjs'
import { createQuestClient } from './client.mjs'

const flag = key => '--' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())
export function questHelp(method) {
  if (!method) return ['quest <operation> [arguments]', '', ...Object.entries(questOperations).map(([name, op]) => `  ${name} ${op.positional.map(key => '<' + key + '>').join(' ')}\n    ${op.description}`), '', 'Use quest <operation> --help for arguments. Results are JSON.'].join('\n')
  const op = questOperations[method]
  if (!op) throw Error('Unknown Quest operation: ' + method)
  return [`quest ${method} ${op.positional.map(key => '<' + key + '>').join(' ')}`, op.description, '', ...Object.entries(op.input.properties).filter(([key]) => !op.positional.includes(key)).map(([key, schema]) => `  ${flag(key)} <${schema.type ?? 'JSON'}>${op.input.required.includes(key) ? ' (required)' : ''}${schema.description ? '\n    ' + schema.description : ''}`)].join('\n')
}

export function parseQuestArguments(args) {
  const [method, ...rest] = args
  const op = questOperations[method]
  if (!op) throw Error('Unknown Quest operation: ' + method)
  const input = {}, flags = new Map(Object.keys(op.input.properties).map(key => [flag(key), key]))
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
  if (args[0] === 'mcp') {
    const { serveQuestStdio } = await import('./mcp-client.mjs')
    await serveQuestStdio(client)
    return
  }
  if (!args.length || ['help', '--help', '-h'].includes(args[0])) return questHelp(args[1])
  if (args.includes('--help') || args.includes('-h')) return questHelp(args[0])
  const { method, input } = parseQuestArguments(args)
  return JSON.stringify(await client[method](input))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = await runQuestCLI(process.argv.slice(2)); if (result !== undefined) console.log(result) }
  catch (error) { console.error(JSON.stringify({ code: error.code ?? 'INVALID_INPUT', message: error.message })); process.exitCode = 1 }
}
