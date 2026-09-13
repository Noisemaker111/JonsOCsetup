/**
 * @core-prevents preparing a candidate from a stale local branch when a remote-tracking ref exists, and a candidate built from an unmerged branch being judged against origin/agents so it can never be reclaimed or is reclaimed while it is still the ref the next launch reuses
 * @core-observed `prepare dev --ref agents` resolved the local branch and silently built the wrong commit (2026-09-11), and 3.2 GB of release directories sat unretirable because retirement only ever compared a release against origin/agents.
 */
import {test, expect} from 'bun:test'
import {mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, existsSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveRef, findPrepared, sourceRepository} from '../scripts/channel-prepare.mjs'
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

    // Explicit revisions use the owned checkout, even with a different remote default HEAD.
    git(repository, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feature'])
    const owned = join(home, 'owned')
    git(repository, ['worktree', 'add', '-b', 'owned', owned, stale])
    for (const ref of ['HEAD', '@', 'HEAD~0', 'HEAD@{0}']) {
      const explicit = resolveRef(owned, ref, {fetch: false})
      expect(explicit.commit).toBe(stale)
      expect(explicit.resolved).toBe(ref)
    }
    expect(resolveRef(owned, 'HEAD^', {fetch: false}).commit).toBe(git(repository, ['rev-parse', 'HEAD']))
    expect(resolveRef(owned, 'origin/HEAD', {fetch: false}).commit).toBe(tip)
    git(owned, ['fetch', 'origin', 'feature'])
    expect(resolveRef(owned, 'FETCH_HEAD').commit).toBe(tip)
    git(repository, ['worktree', 'remove', owned])

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

/** @core-observed September 13 plain oc prepared the merged commit from the historical config repository; hub workers consequently landed under .config/opencode despite hub/source selecting JonsOCsetup. */
test('normal oc follows the hub source and refuses an identical candidate owned by another repository', () => {
  const home=realpathSync.native(mkdtempSync(join(tmpdir(),'oc-source-owner-')))
  try {
    const source=join(home,'source-repo'),historical=join(home,'historical'),hub=join(home,'hub'),registry=join(home,'registry')
    mkdirSync(source);mkdirSync(hub)
    git(source,['init','--initial-branch=agents'])
    writeFileSync(join(source,'work.txt'),'reviewed source')
    git(source,['add','.']);git(source,['-c','user.name=Check','-c','user.email=check@example.invalid','commit','-m','source'])
    git(home,['clone','--no-hardlinks',source,historical])
    symlinkSync(source,join(hub,'source'),process.platform==='win32'?'junction':'dir')
    expect(sourceRepository(join(hub,'source'))).toBe(source)
    const commit=git(source,['rev-parse','HEAD'])
    const prepared=(repository:string,suffix:string)=>{
      const root=join(registry,'releases','dev-'+commit.slice(0,12)+'-'+suffix)
      mkdirSync(join(registry,'releases'),{recursive:true});git(repository,['worktree','add','--detach',root,commit])
      mkdirSync(join(root,'generations','gen-a'),{recursive:true})
      writeFileSync(join(root,'generations','gen-a','plugin-set.json'),'{}')
      writeFileSync(join(root,'channel-release.json'),JSON.stringify({channel:'dev',commit,root}))
      writeFileSync(join(root,'plugin-activation.json'),JSON.stringify({activeGeneration:'gen-a',evidence:{ok:true,sourceCommit:commit}}))
      return root
    }
    const correct=prepared(source,'1'),wrong=prepared(historical,'2')
    expect(findPrepared(commit,registry,historical)?.root).toBe(wrong)
    expect(findPrepared(commit,registry,source)?.root).toBe(correct)
    expect(sourceRepository(correct)).toBe(source)
  } finally {rmSync(home,{recursive:true,force:true})}
})
