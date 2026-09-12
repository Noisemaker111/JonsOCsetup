/**
 * @core-prevents preparing a candidate from a stale local branch when a remote-tracking ref exists, and a candidate built from an unmerged branch being judged against origin/agents so it can never be reclaimed or is reclaimed while it is still the ref the next launch reuses
 * @core-observed `prepare dev --ref agents` resolved the local branch and silently built the wrong commit (2026-09-11), and 3.2 GB of release directories sat unretirable because retirement only ever compared a release against origin/agents.
 */
import {test, expect} from 'bun:test'
import {mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveRef, findPrepared} from '../scripts/channel-prepare.mjs'
import {git, removeIntegratedWorktree} from '../quest/cleanup-git.mjs'

test('a ref resolves to its remote-tracking commit, and a candidate is judged against the ref it was built from', () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'try-ref-')))
  try {
    const origin = join(home, 'origin'), repository = join(home, 'repo')
    for (const root of [origin, repository]) {
      mkdirSync(root)
      git(root, ['init', '--initial-branch=agents'])
      git(root, ['config', 'user.email', 'test@example.invalid'])
      git(root, ['config', 'user.name', 'Test'])
    }
    writeFileSync(join(origin, 'file'), 'shared')
    git(origin, ['add', 'file']); git(origin, ['commit', '-m', 'shared'])
    git(repository, ['remote', 'add', 'origin', origin])
    git(repository, ['fetch', 'origin'])
    git(repository, ['reset', '--hard', 'origin/agents'])

    // The branch moves on the remote while the local ref stays where it was. Resolving the bare
    // name must follow the remote, because building the local one is the wrong commit.
    git(origin, ['switch', '-c', 'feature'])
    writeFileSync(join(origin, 'file'), 'first'); git(origin, ['commit', '-am', 'first'])
    const stale = git(origin, ['rev-parse', 'HEAD'])
    git(repository, ['fetch', 'origin', 'feature:refs/heads/feature'])
    expect(resolveRef(repository, 'feature', {fetch: false}).commit).toBe(stale)
    writeFileSync(join(origin, 'file'), 'second'); git(origin, ['commit', '-am', 'second'])
    const tip = git(origin, ['rev-parse', 'HEAD'])
    git(repository, ['fetch', 'origin'])
    const target = resolveRef(repository, 'feature', {fetch: false})
    expect(target.commit).toBe(tip)
    expect(target.resolved).toBe('origin/feature')
    expect(target.integration).toBe('refs/remotes/origin/feature')
    expect(target.subject).toBe('second')
    // The local branch is still reachable when it is asked for by name.
    expect(resolveRef(repository, 'refs/heads/feature', {fetch: false}).commit).toBe(stale)

    // A candidate for an unmerged branch is not integrated into agents and never would be, so
    // retirement has to judge it against its own ref or the release can never be reclaimed.
    const root = join(home, 'candidate')
    git(repository, ['worktree', 'add', '--detach', root, stale])
    const options = {root: repository, path: root, head: stale}
    expect(removeIntegratedWorktree({...options, ref: 'refs/remotes/origin/agents'}).reason).toContain('not integrated')
    expect(removeIntegratedWorktree({...options, ref: target.integration!}).removed).toBe(true)
    expect(existsSync(root)).toBe(false)
  } finally {rmSync(home, {recursive: true, force: true})}
})

test('a prepared release is only reused when its own receipts prove it is that commit, verified', () => {
  const registry = realpathSync.native(mkdtempSync(join(tmpdir(), 'try-reuse-')))
  try {
    const commit = 'a'.repeat(40)
    const root = join(registry, 'releases', 'dev-' + commit.slice(0, 12) + '-1')
    mkdirSync(root, {recursive: true})
    // No receipts at all: nothing to reuse, and no throw either.
    expect(findPrepared(commit, registry)).toBeUndefined()
    writeFileSync(join(root, 'channel-release.json'), JSON.stringify({channel: 'dev', commit, root}))
    writeFileSync(join(root, 'plugin-activation.json'), JSON.stringify({activeGeneration: 'gen-a', evidence: {ok: false, sourceCommit: commit}}))
    // A preparation whose own model check failed is not a candidate to launch.
    expect(findPrepared(commit, registry)).toBeUndefined()
    writeFileSync(join(root, 'plugin-activation.json'), JSON.stringify({activeGeneration: 'gen-a', evidence: {ok: true, sourceCommit: commit}}))
    // Verified, but the generation it names was never staged.
    expect(findPrepared(commit, registry)).toBeUndefined()
    mkdirSync(join(root, 'generations', 'gen-a'), {recursive: true})
    writeFileSync(join(root, 'generations', 'gen-a', 'plugin-set.json'), '{}')
    // Still refused: the directory is not a checkout of that commit, so `git rev-parse HEAD` fails.
    expect(findPrepared(commit, registry)).toBeUndefined()
  } finally {rmSync(registry, {recursive: true, force: true})}
})
