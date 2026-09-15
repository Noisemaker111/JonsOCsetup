/** Re-capture the tracked setup and say exactly what moved, so config stops living only on the machine. */
import {execFileSync} from 'node:child_process'
import {readFileSync, existsSync} from 'node:fs'
import {join, dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = argv => execFileSync('git', ['-C', root, ...argv], {encoding: 'utf8', windowsHide: true}).trim()
const manifest = () => existsSync(join(root, 'setup/manifest.json'))
  ? JSON.parse(readFileSync(join(root, 'setup/manifest.json'), 'utf8'))
  : {entries: [], dependencies: []}

const before = manifest()
execFileSync('node', [join(root, 'scripts/capture-setup.mjs')], {cwd: root, encoding: 'utf8', windowsHide: true})
const after = manifest()

const targets = m => new Map(m.entries.map(e => [e.target.replaceAll('\\', '/'), e.sha256]))
const [was, now] = [targets(before), targets(after)]
const added = [...now.keys()].filter(t => !was.has(t)).sort()
const removed = [...was.keys()].filter(t => !now.has(t)).sort()
const changed = [...now.keys()].filter(t => was.has(t) && was.get(t) !== now.get(t)).sort()

// Reported, never committed. This tree is public, and capture pulls from a live home directory: a
// new file is something a person should look at before it is published, not something a script
// pushes on their behalf. The point of this command is that looking takes one step instead of ten.
const dirty = git(['status', '--porcelain', '--', 'setup', 'skills', 'docs']).split('\n').filter(Boolean)

// Link health belongs in the same breath as drift, because a broken link is how drift comes back: a
// tool that replaces a file instead of editing it leaves a copy with identical bytes, so nothing
// looks wrong until the two have diverged. `unlinked` above zero means re-run `setup:link`.
const links = JSON.parse(execFileSync('node', [join(root, 'scripts/link-setup.mjs')], {
  cwd: root, encoding: 'utf8', windowsHide: true,
}))

console.log(JSON.stringify({
  tracked: after.entries.length,
  dependencies: after.dependencies.length,
  added,
  removed,
  changed,
  linked: links.alreadyLinked,
  unlinked: links.wouldLink,
  // Reported, never enforced: a ceiling on characters refuses a line that earns its place.
  sharedMemoryCharacters: readFileSync(join(root, 'setup/files/Projects/opencode-hub/MEMORY.md'), 'utf8').length,
  workingTree: dirty.length,
  next: dirty.length
    ? 'Review the diff, then commit setup/manifest.json with the source bytes in the same change.'
    : 'Nothing moved; the tree already matches this machine.',
}, null, 2))
process.exit(0)
