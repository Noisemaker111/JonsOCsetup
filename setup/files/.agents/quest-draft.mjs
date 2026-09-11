/**
 * File a draft Quest from any harness, in one command.
 *
 *   bun ~/.agents/quest-draft.mjs "<title>" "<what the user actually asked for>" [step title]...
 *
 * Title names the outcome, not the activity. Steps are optional; a draft with none is still worth
 * more than a sentence in a transcript that nobody can query later.
 *
 * This is the filing half of `quest.mjs` under the name every agent instruction already uses. It
 * delegates rather than duplicating, so there is one release resolver, one identity rule and one
 * write path: `bun ~/.agents/quest.mjs file` is the same command, and `quest.mjs help` shows the
 * rest of the loop — claim a step, report progress and evidence, finish it, see who holds what.
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const [title, intent, ...steps] = process.argv.slice(2)
if (!title || !intent) {
  console.error('usage: bun ~/.agents/quest-draft.mjs "<title>" "<intent>" [step title]...')
  process.exit(2)
}
const cli = join(dirname(fileURLToPath(import.meta.url)), "quest.mjs")
process.exit(spawnSync(process.execPath, [cli, "file", title, intent, ...steps], { stdio: "inherit", windowsHide: true }).status ?? 1)
