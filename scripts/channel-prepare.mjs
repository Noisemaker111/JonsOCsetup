/**
 * Preparing a dev candidate, shared by the strict release path and by trying a branch.
 *
 * Preparation is not acceptance. It resolves a ref, adds a detached worktree, restores the
 * lockfile once, and runs that worktree's own scripts/prepare-channel.ts to stage a generation and
 * prove one real prompt reaches the configured model. Nothing here gates: the two-run acceptance
 * report and the origin/agents tree check belong to activation and stay there.
 *
 * A bare branch name resolves against the local ref, which can be months old -- that silently
 * built the wrong commit on 2026-09-11. So the remote-tracking ref wins whenever one exists, and
 * what was resolved is recorded on the release and shown at launch.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {spawnSync, spawn} from 'node:child_process'
import {homedir} from 'node:os'

export const runtimeHome = join(homedir(), '.config', 'opencode')
export const registryRoot = join(runtimeHome, '.channels')

export function git(cwd, argv) {
  const p = spawnSync('git', ['-C', cwd, ...argv], {encoding: 'utf8', windowsHide: true, timeout: 120000})
  if (p.status !== 0) throw Error(p.stderr || String(p.error))
  return p.stdout.trim()
}
const read = path => JSON.parse(readFileSync(path, 'utf8'))
export function atomic(path, value) {
  mkdirSync(dirname(path), {recursive: true})
  const tmp = path + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  renameSync(tmp, path)
}
export async function run(exe, argv, cwd, env) {
  const child = spawn(exe, argv, {cwd, env, stdio: 'inherit', windowsHide: true})
  const code = await new Promise((done, reject) => {child.once('error', reject); child.once('exit', done)})
  if (code !== 0) throw Error(`${exe} exited ${code}`)
}

/** The quarantined environment a dev release is prepared and launched under. */
export function envFor(root, name, registry = registryRoot) {
  const state = join(registry, 'state', name)
  mkdirSync(state, {recursive: true})
  const env = {...process.env, OPENCODE_CONFIG_DIR: root, OPENCODE_CONFIG_PROJECT_DISABLE: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_RELEASE_CHANNEL: name}
  // Broker authentication remains with its existing local service. Session DB, Quests,
  // ownership and telemetry are separate from everyday stable work.
  if (name === 'dev') Object.assign(env, {XDG_STATE_HOME: join(state, 'xdg'), OPENCODE_DB: join(state, 'host.db'), OPENCODE_QUEST_ROOT: join(state, 'quests'), OPENCODE_ORCHESTRATION_LEDGER: join(state, 'orchestration.jsonl'), OPENCODE_TELEMETRY_FILE: join(state, 'requests.jsonl')})
  for (const key of ['OPENCODE_PLUGIN_GENERATION', 'OPENCODE_RUNTIME_RECEIPT', 'OPENCODE_RUNTIME_CONTROL', 'OPENCODE_RUNTIME_TOKEN']) delete env[key]
  return env
}

/**
 * The commit a ref names, preferring the remote-tracking ref so a stale local branch cannot win.
 * `integration` is the ref a candidate built from this one is integrated into, which is what
 * decides whether the release can ever be retired.
 */
export function resolveRef(repository, ref, {fetch = true} = {}) {
  if (!ref) throw Error('Name a ref to prepare')
  if (fetch) spawnSync('git', ['-C', repository, 'fetch', 'origin', '--prune'], {encoding: 'utf8', windowsHide: true, timeout: 120000})
  const explicit = ref.startsWith('origin/') || ref.startsWith('refs/') || /^[0-9a-f]{7,40}$/i.test(ref)
  const attempts = explicit ? [ref] : ['origin/' + ref, ref]
  const tried = []
  for (const attempt of attempts) {
    const p = spawnSync('git', ['-C', repository, 'rev-parse', '--verify', '--quiet', attempt + '^{commit}'], {encoding: 'utf8', windowsHide: true, timeout: 30000})
    if (p.status !== 0 || !p.stdout.trim()) {tried.push(attempt); continue}
    const commit = p.stdout.trim()
    const full = spawnSync('git', ['-C', repository, 'rev-parse', '--symbolic-full-name', attempt], {encoding: 'utf8', windowsHide: true, timeout: 30000}).stdout?.trim()
    return {ref, resolved: attempt, commit, integration: full || undefined, subject: git(repository, ['log', '-1', '--format=%s', commit])}
  }
  throw Error(`No such ref: tried ${tried.join(' and ')} in ${repository}`)
}

/** A prepared release for this commit that a launch can use as it stands, newest first. */
export function findPrepared(commit, registry = registryRoot) {
  const dir = join(registry, 'releases')
  if (!existsSync(dir)) return undefined
  const prefix = 'dev-' + commit.slice(0, 12) + '-'
  const matches = readdirSync(dir, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(entry => join(dir, entry.name))
    .sort()
    .reverse()
  for (const root of matches) {
    try {
      const release = read(join(root, 'channel-release.json'))
      if (release.channel !== 'dev' || release.commit !== commit) continue
      const pointer = read(join(root, 'plugin-activation.json'))
      if (pointer.evidence?.ok !== true || pointer.evidence.sourceCommit !== commit) continue
      if (!existsSync(join(root, 'generations', pointer.activeGeneration, 'plugin-set.json'))) continue
      if (git(root, ['rev-parse', 'HEAD']) !== commit) continue
      return {root, release, generation: pointer.activeGeneration}
    } catch {continue}
  }
  return undefined
}

/**
 * Add, install and verify a dev release for an already-resolved commit.
 * `integration` is written onto the release so retirement can judge a candidate built from a
 * branch that is not origin/agents; without it such a release could never be reclaimed.
 */
export async function prepareDevRelease({repository, registry = registryRoot, commit, model, ref, resolved, integration, subject}) {
  if (!commit || !model) throw Error('Preparation requires a committed ref and exact real model route')
  const root = join(registry, 'releases', 'dev-' + commit.slice(0, 12) + '-' + Date.now())
  mkdirSync(dirname(root), {recursive: true})
  git(repository, ['worktree', 'add', '--detach', root, commit])
  // Frozen lockfile restores the environment once, before dispatching any work.
  await run('bun', ['install', '--frozen-lockfile'], root, process.env)
  await run('bun', [join(root, 'scripts/prepare-channel.ts'), '--model', model], root, envFor(root, 'dev', registry))
  const release = {schema: 1, cleanupProtocol: existsSync(join(root, 'scripts/release-retirement.mjs')) ? 1 : undefined, channel: 'dev', commit, root, model, ref, resolved, subject, integrationRef: integration, preparedAt: new Date().toISOString()}
  atomic(join(root, 'channel-release.json'), release)
  return {root, release}
}

/**
 * Which code plain `oc` runs.
 *
 * It used to be the release that passed the acceptance gate, and that made the gate the delivery
 * path: a fix could be merged, reviewed and verified and still not be in the command Jon types,
 * because roughly half of gate runs fail. `/new` was fixed, merged, and he typed `oc`, typed `/new`,
 * and got the old behaviour. So the default is the branch, and the gated release is the thing you
 * ask for. The gate keeps its job -- proving a release before it is promoted -- and loses the job it
 * was never meant to have.
 */
export const DEFAULT_BRANCH = 'agents'
const sourceFile = registry => join(registry, 'oc-default.json')
export function readDefaultSource(registry = registryRoot) {
  try {return JSON.parse(readFileSync(sourceFile(registry), 'utf8')).source === 'gated' ? 'gated' : 'branch'} catch {return 'branch'}
}
export function writeDefaultSource(source, registry = registryRoot) {
  if (!['branch', 'gated'].includes(source)) throw Error(`Choose branch or gated, not ${source}`)
  atomic(sourceFile(registry), {source, updatedAt: new Date().toISOString()})
  return source
}

/** How many commits the code being run is behind the branch, or undefined when that cannot be told. */
export function commitsBehind(repository, commit, ref = 'refs/remotes/origin/' + DEFAULT_BRANCH) {
  if (!commit) return undefined
  try {
    const count = git(repository, ['rev-list', '--count', commit + '..' + ref])
    return Number.isInteger(Number(count)) ? Number(count) : undefined
  } catch {return undefined}
}
