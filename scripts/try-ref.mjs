/**
 * Trying a branch: prepare a dev candidate from a ref and say what is about to run.
 *
 * Activation is the strict path -- two real acceptance runs and a tree identical to origin/agents --
 * and it stays that way. But none of that is needed to look at a change. This resolves a ref,
 * reuses an already prepared release for that commit when one exists, prepares one when it does
 * not, and hands the launcher an explicit candidate. It never writes .channels/dev.json, so the
 * activated channel is untouched and `ocd` keeps running what it ran before.
 *
 * Reuse is the point: the second `ocb` on the same commit costs nothing. Superseded candidates for
 * the same branch are retired on the way through, so trying branches does not accumulate releases.
 */
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {registryRoot, runtimeHome, resolveRef, findPrepared, prepareDevRelease} from './channel-prepare.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const argv = process.argv.slice(2)
const option = name => {const at = argv.indexOf(name); return at < 0 ? undefined : argv[at + 1]}
const flag = name => argv.includes(name)
const named = new Set([option('--model'), option('--plan')].filter(Boolean))
const ref = argv.find(arg => !arg.startsWith('-') && !named.has(arg))
if (!ref) throw Error('Name the branch, tag or commit to try: ocb <ref> [--model <exact-route>] [--fresh]')

const repository = runtimeHome, registry = registryRoot
const selectedPath = join(registry, 'dev.json'), selected = existsSync(selectedPath) ? read(selectedPath) : undefined
const model = option('--model') ?? selected?.model
if (!model) throw Error('No dev channel is activated, so there is no model to inherit: pass --model <exact-route>')

const target = resolveRef(repository, ref)
const existing = flag('--fresh') ? undefined : findPrepared(target.commit, registry)
const {root, release} = existing
  ? {root: existing.root, release: existing.release}
  : await prepareDevRelease({repository, registry, model, ...target})

// Retirement is judged by the candidate's own reviewed code, and it protects a release that is
// still the tip of the ref it was built from -- which is the one we are about to launch.
let cleanup
const retirement = join(root, 'scripts/release-retirement.mjs')
if (existsSync(retirement)) {
  try {
    const {retireReleases} = await import(pathToFileURL(retirement).href)
    const results = retireReleases(repository)
    // Seventy-odd retained releases with their reasons is not something to read at every launch.
    const removed = results.filter(r => r.removed)
    cleanup = {removed: removed.map(r => r.root), retained: results.length - removed.length, reclaimedBytes: removed.reduce((n, r) => n + (r.logicalBytes ?? 0), 0)}
  } catch (error) {cleanup = {failed: String(error)}}
}

const plan = {
  candidate: root,
  commit: release.commit,
  ref: release.ref ?? target.ref,
  resolved: release.resolved ?? target.resolved,
  subject: target.subject,
  model: release.model,
  reused: !!existing,
  preparedAt: release.preparedAt,
  activatedCommit: selected?.commit,
  cleanup,
}
// Preparation streams bun install and the real model check to this console, so the plan goes to a
// file the launcher reads rather than being mixed into that output.
const planPath = option('--plan')
if (planPath) {
  writeFileSync(planPath, JSON.stringify(plan, null, 2))
  console.log(`${existing ? 'Reusing' : 'Prepared'} ${plan.resolved} ${plan.commit.slice(0, 8)} at ${root}`)
} else console.log(JSON.stringify(plan, null, 2))
