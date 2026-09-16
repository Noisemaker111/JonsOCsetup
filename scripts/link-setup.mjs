/** Point each harness at the tracked file instead of a copy of it, so editing an instruction is publishing it. */
import {existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, mkdirSync, copyFileSync} from 'node:fs'
import {dirname, join, resolve, relative} from 'node:path'
import {homedir} from 'node:os'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = homedir()
const apply = process.argv.includes('--apply')

/**
 * Only files a person or an agent edits as prose. Deliberately excluded: anything a harness rewrites
 * itself. Codex rewrites `.codex/config.toml` and appends to `.codex/rules/default.rules` when a
 * command is approved, Claude Code rewrites `.claude/settings.json` from its own settings UI, and a
 * write that replaces a file instead of editing it in place destroys the link and silently restores
 * the copy this whole arrangement exists to remove. Those stay captured copies; `setup:sync` carries
 * them, and a stale hash is visible in the manifest test.
 */
const LINKED = [
  /^\.codex\/AGENTS\.md$/,
  /^\.claude\/CLAUDE\.md$/,
  /^\.agents\/(user-verification|matt-pocock)\.md$/,
  /^\.agents\/(skills|docs)\//,
  /^\.claude\/skills\//,
]
const EXCLUDED = [/^\.agents\/skills-disabled\//]

const manifest = JSON.parse(readFileSync(join(root, 'setup/manifest.json'), 'utf8'))
const wanted = manifest.entries.filter(e => {
  const target = e.target.replaceAll('\\', '/')
  return LINKED.some(rx => rx.test(target)) && !EXCLUDED.some(rx => rx.test(target))
})

const linked = [], already = [], skipped = [], conflicts = []
for (const entry of wanted) {
  const target = join(home, entry.target.replaceAll('\\', '/'))
  const source = join(root, entry.source ?? 'setup/files/' + entry.target)
  if (!existsSync(source)) { skipped.push({target: entry.target, reason: 'source missing'}); continue }

  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    const points = realpathSync(target)
    if (points === realpathSync(source)) { already.push(entry.target); continue }
    conflicts.push({target: entry.target, reason: `links elsewhere: ${readlinkSync(target)}`})
    continue
  }

  // Content must already agree. Linking is a change of mechanism, never of content: if the installed
  // file says something the tree does not, that edit is the thing being rescued and it has to be
  // captured first, not overwritten by a link to an older copy.
  if (existsSync(target) && readFileSync(target).compare(readFileSync(source)) !== 0) {
    conflicts.push({target: entry.target, reason: 'installed copy differs from source; run setup:sync and commit first'})
    continue
  }

  if (!apply) { linked.push(entry.target); continue }
  mkdirSync(dirname(target), {recursive: true})
  if (existsSync(target)) {
    copyFileSync(target, target + '.pre-link')
    rmSync(target, {force: true})
  }
  symlinkSync(source, target, 'file')
  linked.push(entry.target)
}

console.log(JSON.stringify({
  applied: apply,
  wouldLink: apply ? undefined : linked.length,
  linked: apply ? linked.length : undefined,
  alreadyLinked: already.length,
  conflicts,
  skipped,
  sourceRoot: root,
  note: apply
    ? 'Each replaced file was kept alongside as <name>.pre-link. Delete those once the links are proven.'
    : 'Preview only. Re-run with --apply to replace the copies with links.',
}, null, 2))
process.exit(conflicts.length ? 1 : 0)
