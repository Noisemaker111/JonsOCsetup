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
import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, realpathSync, statSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {spawnSync, spawn} from 'node:child_process'
import {homedir} from 'node:os'
import JSON5 from 'json5'
export const HOST_MODELS_SOURCE = 'https://models.opencode.ai'

export const runtimeHome = join(homedir(), '.config', 'opencode')
export const registryRoot = join(runtimeHome, '.channels')

export function git(cwd, argv) {
  const p = spawnSync('git', ['-C', cwd, ...argv], {encoding: 'utf8', windowsHide: true, timeout: 120000})
  if (p.status !== 0) throw Error(p.stderr || String(p.error))
  return p.stdout.trim()
}

/** Parse the exact provider/model identity the host receives, ignoring its reasoning variant. */
export function modelRoute(route) {
  const text = String(route ?? '').trim()
  const base = text.split('#', 1)[0]
  const slash = base.indexOf('/')
  if (slash <= 0 || slash === base.length - 1) throw Error(`Preparation requires an exact provider/model route, received ${text || '<empty>'}`)
  return {route: text, providerID: base.slice(0, slash), modelID: base.slice(slash + 1)}
}

export function hostModelsSource(environment = process.env) {
  return (environment.OPENCODE_MODELS_URL || HOST_MODELS_SOURCE).replace(/\/$/, '')
}

/** The legacy native host cache that decides whether a catalog-backed route exists. */
export function hostModelsCacheFile(environment = process.env) {
  const cacheRoot = environment.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(cacheRoot, 'opencode', 'models.json')
}

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined }

export function readHostModelCatalog(file = hostModelsCacheFile()) {
  try {
    const raw = readFileSync(file, 'utf8')
    const catalog = record(JSON.parse(raw))
    if (!catalog) return undefined
    let mtime
    try { mtime = statSync(file).mtime.toISOString() } catch {}
    return {catalog, raw, mtime}
  } catch { return undefined }
}

export function catalogContainsModel(catalog, route) {
  const {providerID, modelID} = typeof route === 'string' ? modelRoute(route) : route
  const provider = record(catalog?.[providerID])
  return Boolean(record(provider?.models)?.[modelID])
}

/** Models explicitly declared by the selected source config are already in the host's merged catalog. */
export function configuredModelResolution(repository, commit, route) {
  if (!repository || !commit) return undefined
  const identity = typeof route === 'string' ? modelRoute(route) : route
  try {
    const config = JSON5.parse(git(repository, ['show', `${commit}:opencode.jsonc`]))
    const provider = record(config?.providers?.[identity.providerID])
    if (!provider) return {providerConfigured: false, modelConfigured: false}
    return {
      providerConfigured: true,
      modelConfigured: Boolean(record(provider.models)?.[identity.modelID]),
    }
  } catch { return undefined }
}

/** Refresh the native host's legacy models.json without exposing a partial file to a running host. */
export async function refreshHostModelCatalog({cacheFile = hostModelsCacheFile(), source = hostModelsSource(), fetchImpl = globalThis.fetch} = {}) {
  if (typeof fetchImpl !== 'function') throw Error('Host model catalog refresh is unavailable: fetch is not configured')
  let response
  try {
    response = await fetchImpl(`${source}/api.json`, {
      headers: {'user-agent': 'JonsOCsetup channel preparation'},
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    throw Error(`Host model catalog refresh failed from ${source}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response?.ok) throw Error(`Host model catalog refresh failed from ${source}: HTTP ${response?.status ?? 'unknown'}`)
  const raw = await response.text()
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw Error(`Host model catalog refresh failed from ${source}: response was not JSON`) }
  if (!record(parsed)) throw Error(`Host model catalog refresh failed from ${source}: response was not a provider catalog`)

  const previous = readHostModelCatalog(cacheFile)
  const changed = previous?.raw !== raw
  if (changed) {
    mkdirSync(dirname(cacheFile), {recursive: true})
    const temporary = `${cacheFile}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temporary, raw)
    renameSync(temporary, cacheFile)
  }
  const current = readHostModelCatalog(cacheFile)
  return {
    cacheFile,
    source,
    changed,
    changedAt: changed ? new Date().toISOString() : undefined,
    mtime: current?.mtime,
  }
}

/**
 * Ensure the exact preparation route is resolvable before a worktree, install or prompt is started.
 * Config-declared models (for example CLIProxyAPI) are resolved by the selected source config;
 * all other routes must be present in the native host catalog, refreshing it once when absent.
 */
export async function ensureHostModelCatalog({model, repository, commit, cacheFile = hostModelsCacheFile(), source = hostModelsSource(), fetchImpl = globalThis.fetch} = {}) {
  const identity = modelRoute(model)
  const initial = readHostModelCatalog(cacheFile)
  if (catalogContainsModel(initial?.catalog, identity)) {
    return {route: identity.route, cacheFile, source, resolvedBy: 'host-cache', refreshed: false, changed: false, mtime: initial.mtime}
  }

  const configured = configuredModelResolution(repository, commit, identity)
  if (configured?.modelConfigured) {
    return {route: identity.route, cacheFile, source, resolvedBy: 'source-config', refreshed: false, changed: false}
  }

  let refreshed
  try {
    refreshed = await refreshHostModelCatalog({cacheFile, source, fetchImpl})
  } catch (error) {
    throw Error(`Cannot prepare channel on ${identity.route}: the host model catalog does not contain it and refresh failed. ${error instanceof Error ? error.message : String(error)}; no prompt was sent.`)
  }
  const current = readHostModelCatalog(cacheFile)
  if (catalogContainsModel(current?.catalog, identity)) {
    return {route: identity.route, ...refreshed, resolvedBy: 'host-cache', refreshed: true}
  }
  throw Error(`Cannot prepare channel on ${identity.route}: the host model catalog at ${cacheFile} still cannot resolve it after refresh from ${source}; no prompt was sent.`)
}
/** The hub's installed source mapping owns repository selection; runtimeHome only stores runtime data. */
export function sourceRepository(source = join(homedir(), 'Projects', 'opencode-hub', 'source')) {
  const directory = realpathSync.native(source)
  return repositoryOwner(directory)
}
function repositoryOwner(directory) {
  return realpathSync.native(dirname(git(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])))
}
const sameRepository = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
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
  // Git revision syntax belongs to this checkout. Fetching first would even overwrite FETCH_HEAD.
  const localRevision = /^(HEAD|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD|REBASE_HEAD|REVERT_HEAD|CHERRY_PICK_HEAD|BISECT_HEAD|AUTO_MERGE|@)$/.test(ref) || /[~^:]|@\{/.test(ref)
  if (fetch && !localRevision) spawnSync('git', ['-C', repository, 'fetch', 'origin', '--prune'], {encoding: 'utf8', windowsHide: true, timeout: 120000})
  const explicit = localRevision || ref.startsWith('origin/') || ref.startsWith('refs/') || /^[0-9a-f]{7,40}$/i.test(ref)
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
export function findPrepared(commit, registry = registryRoot, repository) {
  const owner = repository && repositoryOwner(repository)
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
      // A pre-lease release cannot participate in a new launch while retirement is deciding its
      // historical process evidence. Current pointers still protect one already in use.
      if (release.channel !== 'dev' || release.commit !== commit || release.cleanupProtocol !== 1) continue
      const pointer = read(join(root, 'plugin-activation.json'))
      if (pointer.evidence?.ok !== true || pointer.evidence.sourceCommit !== commit) continue
      if (!existsSync(join(root, 'generations', pointer.activeGeneration, 'plugin-set.json'))) continue
      if (git(root, ['rev-parse', 'HEAD']) !== commit) continue
      if (owner && !sameRepository(repositoryOwner(root), owner)) continue
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
  // This is deliberately before worktree creation, dependency installation and the real prompt.
  // A stale host catalog otherwise lets the native composer silently bind a different model.
  const modelCatalog = await ensureHostModelCatalog({model, repository, commit})
  const root = join(registry, 'releases', 'dev-' + commit.slice(0, 12) + '-' + Date.now())
  mkdirSync(dirname(root), {recursive: true})
  git(repository, ['worktree', 'add', '--detach', root, commit])
  // Frozen lockfile restores the environment once, before dispatching any work.
  await run('bun', ['install', '--frozen-lockfile'], root, process.env)
  await run('bun', [join(root, 'scripts/prepare-channel.ts'), '--model', model], root, {
    ...envFor(root, 'dev', registry),
    OPENCODE_MODEL_CATALOG_PREFLIGHT: JSON.stringify(modelCatalog),
  })
  const release = {schema: 1, cleanupProtocol: existsSync(join(root, 'scripts/release-retirement.mjs')) ? 1 : undefined, channel: 'dev', commit, root, repository: repositoryOwner(repository), model, modelCatalog, ref, resolved, subject, integrationRef: integration, preparedAt: new Date().toISOString()}
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
