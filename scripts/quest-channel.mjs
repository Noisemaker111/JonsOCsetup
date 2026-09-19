import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function runQuestChannel({
  registry = join(homedir(), '.config', 'opencode', '.channels'),
  args = process.argv.slice(2),
} = {}) {
  const activation = JSON.parse(readFileSync(join(registry, 'dev.json'), 'utf8'))
  if (!activation.root) throw Error('The active development release has no root')
  process.env.OPENCODE_CONFIG_DIR = activation.root
  process.env.OPENCODE_RELEASE_CHANNEL = 'dev'
  const { runQuestCLI } = await import(pathToFileURL(join(activation.root, 'quest', 'cli.mjs')).href)
  return runQuestCLI(args)
}

if (import.meta.main) {
  try {
    const result = await runQuestChannel()
    if (result !== undefined) console.log(result)
  } catch (error) {
    console.error(JSON.stringify({ code: error.code ?? 'INVALID_INPUT', message: error.message }))
    process.exitCode = 1
  }
}
