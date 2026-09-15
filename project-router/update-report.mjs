import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { homedir } from 'node:os'
import { inspectHostExecutable } from './executable.mjs'

const schema = 2
const repository = 'https://api.github.com/repos/anomalyco/opencode'
const registry = 'https://registry.npmjs.org/@opencode%2fcli'
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value : null
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const optional = path => existsSync(path) ? read(path) : null
const version = raw => String(raw ?? '').replace(/^opencode2 v/, '').replace(/^v/, '')
const publicVersion = value => /^(2\.\d+\.\d+(?:-[\w.-]+)?|0\.0\.0-beta[.-]\d+)(?:\+[\w.-]+)?$/.test(value)

// Semver precedence is used only for published V2 versions, never to infer Git ancestry.
export function compareVersions(a, b) {
  const parse = value => /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(value)
  const x = parse(a), y = parse(b)
  if (!x || !y) return null
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) < Number(y[i]) ? -1 : 1
  if (!x[4] || !y[4]) return x[4] === y[4] ? 0 : x[4] ? -1 : 1
  const left = x[4].split('.'), right = y[4].split('.')
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === right[i]) continue
    if (left[i] === undefined || right[i] === undefined) return left[i] === undefined ? -1 : 1
    const numeric = s => /^\d+$/.test(s)
    if (numeric(left[i]) && numeric(right[i])) return Number(left[i]) < Number(right[i]) ? -1 : 1
    if (numeric(left[i]) !== numeric(right[i])) return numeric(left[i]) ? -1 : 1
    return left[i] < right[i] ? -1 : 1
  }
  return 0
}

function save(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n')
  renameSync(temp, path)
}

/** Only public official responses are cached. No environment, prompts or launch tokens. */
function evidenceClient(cacheRoot, { offline, refresh }) {
  const observations = []
  async function get(url, { moving = false, json = true } = {}) {
    const file = join(cacheRoot, 'http', digest(url) + '.json')
    let cached
    try { cached = optional(file) } catch { /* Invalid cache is a miss. */ }
    if (cached && cached.url !== url) cached = null
    const record = result => { observations.push({ ...result, body: undefined }); return result }
    if (cached && (offline || (!moving && !refresh))) return record({ ...cached, transport: offline ? 'offline-cache' : 'cache' })
    if (offline) return record({ url, status: null, error: 'Offline cache miss', transport: 'offline', at: new Date().toISOString() })
    try {
      const headers = { Accept: json ? 'application/json' : 'text/plain', 'User-Agent': 'JonsOCsetup-update-report' }
      if (cached?.etag && !refresh) headers['If-None-Match'] = cached.etag
      const response = await fetch(url, { headers })
      if (response.status === 304 && cached) return record({ ...cached, transport: 'revalidated', checkedAt: new Date().toISOString() })
      const text = await response.text()
      const result = { url, status: response.status, at: new Date().toISOString(), etag: response.headers.get('etag'), digest: digest(text) }
      if (!response.ok) throw Object.assign(Error(`HTTP ${response.status}`), { status: response.status })
      result.body = json ? JSON.parse(text) : text
      // Keep GitHub pagination metadata with the response for offline traversal.
      result.next = response.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1] ?? null
      save(file, result)
      return record({ ...result, transport: 'network' })
    } catch (error) {
      // A failed refresh cannot destroy good evidence or masquerade as fresh success.
      return record(cached ? { ...cached, transport: 'stale-cache', error: `Refresh failed (${error.status ?? 'network/parse error'})` }
        : { url, status: error.status ?? null, error: error.status ? `HTTP ${error.status}` : 'Network or response parsing failed', transport: 'network', at: new Date().toISOString() })
    }
  }
  return { get, observations }
}

export function reportIdentity(env = process.env, receiptPath) {
  const selected = inspectHostExecutable()
  const launchPath = receiptPath ?? (env.OPENCODE_RUNTIME_RECEIPT ? join(dirname(env.OPENCODE_RUNTIME_RECEIPT), 'launch.json') : null)
  const launch = launchPath && existsSync(launchPath) ? read(launchPath) : null
  const running = launch?.host && /^opencode2 v/.test(launch.host.version) ? {
    version: version(launch.host.version), executable: launch.host.executable,
    origin: 'launch receipt (not a new liveness or binary-hash check)', receipt: launchPath,
  } : null
  return {
    running, selected: { ...selected, version: version(selected.version), origin: 'shared resolver and fresh --version' },
    baseline: running ? { ...running } : { version: null, origin: 'unknown: no running-host launch receipt' },
    discrepancy: !!running && (running.version !== version(selected.version) || resolve(running.executable).toLowerCase() !== resolve(selected.executable).toLowerCase()),
    generation: launch?.generation ?? env.OPENCODE_PLUGIN_GENERATION ?? null,
    pluginSourceCommit: launch?.sourceCommit ?? null,
    // dev is a plugin channel, not the compiled host updater channel.
    pluginChannel: env.OPENCODE_RELEASE_CHANNEL ?? null,
    compiledHostChannel: null,
  }
}

function inventory(configRoot, generation, receipt) {
  if (!configRoot) return { status: 'unknown', reason: 'No installed configuration root', fingerprint: digest(null), owners: [], packages: {}, imports: [], contracts: [] }
  const selectedRoot = generation ? join(configRoot, 'generations', generation) : configRoot
  if (!existsSync(join(selectedRoot, 'plugin-set.json'))) return { status: 'unknown', reason: 'Selected plugin generation has no inventory', fingerprint: digest(selectedRoot), owners: [], packages: {}, imports: [], contracts: [] }
  const root = realpathSync(selectedRoot)
  const set = read(join(root, 'plugin-set.json'))
  const entries = [...set.serverEntrypoints, ...set.tuiEntrypoints]
  const owners = [...new Set(entries.map(path => set.entrypointOwners[path]))].sort()
  const files = [], imports = [], contracts = []
  const patterns = ['systemPart', 'Plugin.define', 'tool.transform', 'http.request', 'keymap.layer', 'ui.slot', 'ui.dialog', 'ui.router', 'session.execution.', 'session.prompt', 'storage']
  // Scan only active owners. Fingerprint contents, retain just API names and locations.
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(?:[cm]?js|tsx?|json)$/.test(entry.name)) {
        const text = readFileSync(path, 'utf8'), name = relative(root, path).replaceAll('\\', '/')
        files.push([name, digest(text)])
        text.split('\n').forEach((line, i) => {
          for (const match of line.matchAll(/(?:from\s*|import\s*\()?['"](@(?:opencode(?:-ai)?|opentui)\/[^'"]+)['"]/g)) imports.push({ module: match[1], file: name, line: i + 1 })
          for (const symbol of patterns) if (line.includes(symbol)) contracts.push({ symbol, file: name, line: i + 1 })
        })
      }
    }
  }
  for (const directory of [...new Set(entries.map(path => path.split('/')[0]))].sort()) walk(join(root, directory))
  const configPackage = optional(join(configRoot, 'package.json')) ?? {}
  const packages = {}
  for (const name of Object.keys(configPackage.dependencies ?? {}).filter(name => /^@(opencode|opentui)|^solid-js$/.test(name))) {
    const installed = optional(join(configRoot, 'node_modules', name, 'package.json'))
    packages[name] = { declared: configPackage.dependencies[name], installed: installed?.version ?? null, exports: installed?.exports ?? null }
  }
  const loads = receipt && existsSync(receipt) ? readFileSync(receipt, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { const row = JSON.parse(line); return row.generation === generation && realpathSync(row.root).toLowerCase() === root.toLowerCase() ? [{ component: row.component, generation: row.generation, sourceCommit: row.sourceCommit }] : [] } catch { return [] }
  }) : []
  const loaded = [...new Map(loads.map(row => [row.component, row])).values()].sort((a, b) => a.component.localeCompare(b.component))
  return { status: 'verified inventory; load receipts are historical, not liveness', root, generation, owners, entries, packages, imports, contracts, loaded,
    fingerprint: digest({ set, files, packages, loaded, generation }) }
}

export function pairKey(baseline, target, channel) {
  return digest({ schema, package: '@opencode/cli', baseline, target, channel })
}

export async function collectNotes(client, baseline, target) {
  if (baseline && baseline === target) return { status: 'complete', sameVersion: true, releases: [], missing: [], evidence: [], explanation: 'No version gap; this is not plugin compatibility certification.' }
  const packageIndex = await client.get(registry, { moving: true })
  const versions = Object.keys(packageIndex.body?.versions ?? {}).filter(publicVersion)
  const mapped = versions.includes(baseline) && versions.includes(target) && compareVersions(baseline, target) === -1
  const expected = mapped ? versions.filter(v => compareVersions(v, baseline) > 0 && compareVersions(v, target) <= 0).sort(compareVersions) : []
  const found = new Map(), evidence = [packageIndex.url]
  // Exact endpoint probes put the target's official notes first, even if the feed is unavailable.
  for (const v of [...new Set([target, baseline].filter(Boolean))]) {
    const response = await client.get(`${repository}/releases/tags/v${encodeURIComponent(v)}`)
    evidence.push(response.url)
    if (response.body?.tag_name && !response.body.draft) found.set(version(response.body.tag_name), response.body)
  }
  let url = `${repository}/releases?per_page=100`, exhausted = false, crossedBaseline = false, traversalFailure = null
  const visited = new Set()
  while (url && !visited.has(url)) {
    visited.add(url)
    const response = await client.get(url, { moving: true })
    evidence.push(response.url)
    if (!Array.isArray(response.body)) { traversalFailure = response.error ?? 'Invalid releases response'; break }
    for (const release of response.body) {
      const v = version(release.tag_name)
      if (!release.draft && publicVersion(v)) found.set(v, release)
      if (v === baseline) crossedBaseline = true
    }
    // Date order is not version order: only stop at the end or when every known gap version is present.
    if (mapped && expected.every(v => found.has(v)) && crossedBaseline) break
    // GitHub redirects Link headers to /repositories/<id>. Rebuild the next URL
    // on our fixed official repository rather than following an arbitrary URL.
    const nextPage = response.next ? new URL(response.next).searchParams.get('page') : null
    if (response.next && !/^[1-9]\d*$/.test(nextPage ?? '')) { traversalFailure = 'Invalid next-page metadata'; break }
    url = nextPage ? `${repository}/releases?per_page=100&page=${nextPage}` : null
    if (!url) exhausted = true
  }
  const included = mapped ? expected : [target]
  const releases = included.filter(v => found.has(v)).map(v => {
    const row = found.get(v)
    return { version: v, title: row.name || row.tag_name, url: row.html_url, publishedAt: row.published_at, prerelease: row.prerelease, body: row.body ?? '' }
  })
  const missing = mapped ? expected.filter(v => !found.get(v)?.body?.trim()) : []
  const complete = mapped && !missing.length && !packageIndex.error && !traversalFailure && (exhausted || crossedBaseline)
  return { status: complete ? 'complete' : 'partial', mapped, expectedVersions: expected, releases, missing, exhausted, crossedBaseline, traversalFailure, evidence,
    explanation: mapped ? `${releases.length}/${expected.length} published V2 versions have GitHub entries; ${missing.length} lack notes. Coverage is relative to the official npm index, including prereleases.`
      : 'Exact published baseline/forward gap is unresolved (custom, unmapped, newer, or unavailable index). Target notes alone do not cover the gap.' }
}

const sourcePaths = {
  architecture: ['packages/core/package.json'],
  prompts: ['packages/core/src/plugin/system-prompt.ts', 'packages/core/src/session/system-prompt.ts', 'packages/core/src/session/runner/prompt/system.txt', 'packages/core/src/config/plugin/instruction.ts', 'packages/core/src/instruction-discovery.ts', 'packages/core/src/tool/plugin/read.ts'],
  plugins: ['packages/plugin/package.json', 'packages/plugin/src/host.ts', 'packages/plugin/src/promise/index.ts', 'packages/plugin/src/tui/index.ts'],
}

async function collectSources(client, baselineSHA, targetSHA) {
  const sources = []
  for (const [section, paths] of Object.entries(sourcePaths)) for (const path of paths) {
    const endpoints = {}
    for (const [name, commit] of [['baseline', baselineSHA], ['target', targetSHA]]) {
      if (!commit) continue
      const result = await client.get(`https://raw.githubusercontent.com/anomalyco/opencode/${commit}/${path}`, { json: false })
      endpoints[name] = { status: result.status, digest: result.digest, url: `https://github.com/anomalyco/opencode/blob/${commit}/${path}#L1`, error: result.error }
      if (result.body && !path.endsWith('package.json')) {
        // Public source locations, not private local prompt contents. Keep the full
        // public response in HTTP evidence, and link the relevant contract lines.
        const anchors = /tools\.includes|agent\.system|discovery\.(global|project|reload|transform)|exports? |export |define\(|session\.|tool\.|context\.|setup|keymap|slot|dialog|PluginSource|SystemPrompt/
        endpoints[name].anchors = result.body.split('\n').flatMap((text, i) => anchors.test(text) ? [{ line: i + 1, text: text.trim(), url: `https://github.com/anomalyco/opencode/blob/${commit}/${path}#L${i + 1}` }] : [])
      }
      if (result.body && path.endsWith('package.json')) {
        try { const data = JSON.parse(result.body); endpoints[name].package = { name: data.name, version: data.version, exports: data.exports, dependencies: data.dependencies, peerDependencies: data.peerDependencies } } catch { endpoints[name].error = 'Invalid package metadata' }
      }
    }
    sources.push({ section, path, ...endpoints, comparison: endpoints.baseline?.status === 200 && endpoints.target?.status === 200
      ? endpoints.baseline.digest === endpoints.target.digest ? 'identical' : 'changed (semantic impact needs review)' : 'unknown: endpoint unavailable or baseline SHA unresolved' })
  }
  return sources
}

function findings(comparison, plugins) {
  const result = { userFacing: [], architecture: [], prompts: [], plugins: [] }
  const add = (section, confidence, text, evidence = []) => result[section].push({ confidence, text, evidence })
  for (const release of comparison.notes.releases) {
    for (const line of release.body.split('\n').map(s => s.trim()).filter(s => /^[-*]\s/.test(s))) {
      const section = /prompt|instruction|AGENTS|system message/i.test(line) ? 'prompts' : /plugin|sdk|hook|slot|keymap/i.test(line) ? 'plugins' : /architecture|protocol|schema|server|client|refactor/i.test(line) ? 'architecture' : 'userFacing'
      add(section, 'verified', `${release.version} official notes: ${line.replace(/^[-*]\s*/, '')} (publisher claim, not exercised behavior)`, [release.url])
    }
  }
  if (!result.userFacing.length) add('userFacing', 'unknown', 'No user-facing changes can be established from the collected official notes.', comparison.notes.evidence)
  for (const source of comparison.sources) {
    const section = source.section === 'plugins' ? 'plugins' : source.section
    add(section, source.comparison === 'identical' || source.comparison.startsWith('changed') ? 'verified' : 'unknown', `${source.path}: ${source.comparison}.`, [source.baseline?.url, source.target?.url].filter(Boolean))
    result[section].at(-1).kind = 'source-comparison'
    if (section === 'architecture' && source.target?.package) add(section, 'verified', `Target core package ${source.target.package.name} depends on ${Object.keys(source.target.package.dependencies ?? {}).filter(v => v.startsWith('@opencode')).join(', ')}. Target architecture only; not proof of a change.`, [source.target.url])
  }
  for (const source of comparison.sources.filter(item => item.section === 'prompts')) {
    const guidance = (source.target?.anchors ?? []).filter(item => /tools\.includes|discovery\.(global|project|reload|transform)/.test(item.text))
    if (guidance.length) add('prompts', 'verified', `Target source contains ${[...new Set(guidance.map(item => item.text.match(/tools\.includes\([^)]+\)|discovery\.(?:global|project|reload|transform)/)?.[0]).filter(Boolean))].join(', ')} instruction controls. This describes target source, not a proven baseline change.`, guidance.map(item => item.url))
  }
  const sdk = comparison.sources.find(s => s.path === 'packages/plugin/package.json')?.target
  if (sdk?.package) {
    const name = sdk.package.name
    const oldImports = plugins.imports.filter(item => item.module.startsWith('@opencode-ai/plugin'))
    if (name === '@opencode/plugin' && oldImports.length) add('plugins', 'suspected', `Installed owners import @opencode-ai/plugin while the target SDK is ${name}@${sdk.package.version}, with exports ${Object.keys(sdk.package.exports ?? {}).join(', ')}. Package resolution/bundling and loader use must be exercised before claiming breakage.`, [sdk.url, ...oldImports.map(item => `${item.file}:${item.line}`)])
    for (const [name, required] of Object.entries(sdk.package.peerDependencies ?? {})) {
      const current = plugins.packages[name]?.installed
      if (current && /^>=\d+\.\d+\.\d+$/.test(required) && compareVersions(current, required.slice(2)) === -1) add('plugins', 'suspected', `${name}@${current} is below target SDK peer requirement ${required}; affected installed UI plugins require a real target-host load check.`, [sdk.url, 'installed node_modules package metadata'])
    }
  }
  add('plugins', 'unknown', `Runtime compatibility is untested for ${plugins.owners.join(', ') || 'unknown installed owners'}. Inventory includes imports, session/tool/context/http contracts, events, storage and TUI APIs; a source difference is not verified incompatibility.`, plugins.contracts.map(item => `${item.file}:${item.line} (${item.symbol})`))
  add('prompts', 'unknown', 'Local personal/project AGENTS, agent roles, skills, dispatch envelopes, configuration and model choices are separate overlays. Their private content was not collected; an upstream update does not establish changes to these overlays.', ['docs/instruction-scope.md'])
  return result
}

export async function buildUpdateReport(options = {}) {
  const cacheRoot = resolve(options.cacheDir ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'opencode', 'update-reports'))
  const client = evidenceClient(cacheRoot, options)
  const identity = reportIdentity(process.env, options.receipt)
  const plugins = inventory(options.configRoot ?? process.env.OPENCODE_CONFIG_DIR, identity.generation, options.receipt ? join(dirname(options.receipt), 'loads.jsonl') : process.env.OPENCODE_RUNTIME_RECEIPT)
  const channel = options.channel ?? 'latest'
  if (!['latest', 'beta'].includes(channel)) throw Error('Choose the latest or beta host channel')
  const discoveries = await Promise.all(['latest', 'beta'].map(async name => {
    const response = await client.get(`https://update.opencode.ai/api/${name}/cli/npm`, { moving: true })
    const data = response.body
    const valid = data?.metadata?.package === '@opencode/cli' && publicVersion(data.version) && data.channel === name
    return { channel: name, version: valid ? data.version : null, sha: valid ? sha(data.metadata.github?.sha) : null, url: response.url, at: response.at, transport: response.transport, error: response.error ?? (valid ? null : 'No valid V2 discovery metadata') }
  }))
  const target = discoveries.find(item => item.channel === channel)
  const baseline = { version: identity.baseline.version, sha: null }
  let baselinePackage
  if (baseline.version && publicVersion(baseline.version)) {
    baselinePackage = await client.get(`${registry}/${encodeURIComponent(baseline.version)}`)
    if (baselinePackage.body?.name === '@opencode/cli' && baselinePackage.body?.version === baseline.version) baseline.sha = sha(baselinePackage.body.gitHead)
    baseline.provenance = { url: baselinePackage.url, published: baselinePackage.body?.version === baseline.version, shaOrigin: baseline.sha ? 'official npm gitHead' : 'unresolved' }
  }
  const pair = pairKey(baseline, { version: target.version, sha: target.sha }, channel)
  const pairPath = join(cacheRoot, 'pairs', pair + '.json')
  let comparison
  try { comparison = optional(pairPath) } catch { /* Cache miss. */ }
  const hit = !!comparison && !options.refresh
  if (!hit) {
    const notes = target.version ? await collectNotes(client, baseline.version, target.version) : { status: 'partial', releases: [], missing: [], evidence: [target.url], explanation: 'Target discovery unavailable.' }
    // Official notes are collected before any source inspection.
    const sources = await collectSources(client, baseline.sha, target.sha)
    const candidate = { schema, pair, baseline, target: { version: target.version, sha: target.sha }, channel, notes, sources, asOf: new Date().toISOString(), evidence: [...client.observations] }
    // Keep previous complete evidence when a refresh has a partial failure.
    if (comparison?.notes.status === 'complete' && candidate.notes.status !== 'complete') comparison = { ...comparison, refreshFailure: candidate.notes.explanation }
    else { comparison = candidate; save(pairPath, comparison) }
  }
  const assessmentKey = digest({ pair, inventory: plugins.fingerprint })
  const assessmentPath = join(cacheRoot, 'assessments', assessmentKey + '.json')
  // Recompute from collected evidence; this also refreshes assessments after a pair refresh.
  const assessment = findings(comparison, plugins)
  save(assessmentPath, { pair, inventoryFingerprint: plugins.fingerprint, asOf: comparison.asOf, findings: assessment })
  const report = {
    schema, generatedAt: new Date().toISOString(), identity, baseline, target, discoveries,
    selection: options.channel ? 'Explicit host channel' : 'Latest V2 candidate; compiled host channel is unknown. Beta is shown separately.',
    plugins, comparison, findings: assessment,
    cache: { hit, offline: !!options.offline, refreshed: !!options.refresh, asOf: comparison.asOf, pair, pairPath, assessmentPath, observations: client.observations },
  }
  const reportPath = join(cacheRoot, 'reports', assessmentKey + '.json')
  report.cache.reportPath = reportPath
  save(reportPath, report)
  return report
}

export function renderUpdateReport(report) {
  const lines = ['# OpenCode2 update report', '',
    `- Running baseline: **${report.baseline.version ?? 'unknown'}**; ${report.identity.baseline.origin}.`,
    `- Selected executable: **${report.identity.selected.version}** (${report.identity.selected.executable}); ${report.identity.discrepancy ? '**differs from launch receipt**' : 'reported separately from the running host'}.`,
    `- Target: **${report.target.version ?? 'unknown'}** (${report.target.channel}); ${report.selection}`,
    `- Source provenance: baseline SHA ${report.baseline.sha ?? 'unresolved'}; target SHA ${report.target.sha ?? 'unresolved'}.`,
    `- Candidates: ${report.discoveries.map(d => `${d.channel} ${d.version ?? 'unavailable'}${d.error ? ` (${d.error})` : ''}`).join('; ')}.`,
    `- Plugin generation: ${report.identity.generation ?? 'unknown'}; SDK: ${Object.entries(report.plugins.packages).filter(([name]) => name.includes('plugin')).map(([name, p]) => `${name}@${p.installed ?? 'unknown'}`).join(', ') || 'unknown'}.`,
    `- Official-note coverage: **${report.comparison.notes.status}**. ${report.comparison.notes.explanation}`,
    `- Cache: ${report.cache.hit ? 'version-pair hit' : 'version-pair collected'}${report.cache.offline ? ', offline' : ''}; evidence as of ${report.cache.asOf}.`,
    `- Compatibility: **not runtime-certified**; ${report.findings.plugins.filter(f => f.confidence === 'suspected').length} suspected risks.`,
    '', '## Official notes and full version gap', '',
    ...report.comparison.notes.releases.map(r => `- [${r.version}: ${r.title}](${r.url})${r.body.trim() ? '' : ' — notes empty'}`),
    ...(report.comparison.notes.missing?.length ? [`- Missing notes: ${report.comparison.notes.missing.join(', ')}.`] : []),
  ]
  for (const [section, title] of [['userFacing', 'User-facing changes'], ['architecture', 'Architecture'], ['prompts', 'Prompts and instructions'], ['plugins', 'Installed-plugin impact']]) {
    lines.push('', `## ${title}`, '')
    const unknownSources = report.findings[section].filter(item => item.kind === 'source-comparison' && item.confidence === 'unknown')
    if (unknownSources.length) lines.push(`- **unknown** — Exact source changes remain unresolved for ${unknownSources.length} selected files (baseline SHA or endpoint unavailable); [per-file evidence](${report.cache.pairPath}).`)
    for (const finding of report.findings[section].filter(item => !unknownSources.includes(item))) {
      lines.push(`- **${finding.confidence}** — ${finding.text}`)
      // The short report links out; full location inventories live in JSON.
      const urls = [...new Map(finding.evidence.filter(url => url.startsWith('https://')).map(url => {
        const parsed = new URL(url)
        if (url.startsWith(`${repository}/releases?`)) return ['release-feed', 'https://github.com/anomalyco/opencode/releases']
        return [parsed.origin + parsed.pathname, url]
      })).values()]
      if (urls.length) lines.push(`  ${urls.map((url, i) => `[Evidence ${i + 1}](${url})`).join(' · ')}`)
    }
  }
  lines.push('', '## Saved evidence', '', `- [Structured report](${report.cache.reportPath})`, `- [Version-pair evidence](${report.cache.pairPath})`, `- [Installed-plugin assessment](${report.cache.assessmentPath})`)
  if (report.comparison.refreshFailure) lines.push(`- Refresh incomplete; previous evidence retained: ${report.comparison.refreshFailure}`)
  const failures = [...new Map([...report.comparison.evidence, ...report.cache.observations].filter(item => item.error).map(item => [item.url, item])).values()]
  for (const item of failures) lines.push(`- ${item.transport}: ${item.error} — ${item.url}`)
  return lines.join('\n') + '\n'
}
