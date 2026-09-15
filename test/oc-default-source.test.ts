/**
 * @core-prevents plain `oc` silently opening a release that predates a merged fix, because the acceptance gate that half the time fails was the only way code reached the command Jon types
 * @core-observed On 2026-09-12 the /new fix was merged as 23c9026, Jon typed oc and then /new, and got the old behaviour: .channels/dev.json was pinned at b522e8d, whose quest/tui-navigation.ts contains giverHomeEntry zero times, and nothing on screen said the release was behind.
 */
import {test, expect} from 'bun:test'
import {mkdtempSync, rmSync, writeFileSync, realpathSync, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readDefaultSource, writeDefaultSource, commitsBehind} from '../scripts/channel-prepare.mjs'
import {git} from '../quest/cleanup-git.mjs'

test('the branch is what plain oc opens until it is flipped, and a flip survives being read back', () => {
  const registry = realpathSync.native(mkdtempSync(join(tmpdir(), 'oc-default-')))
  try {
    // Nothing recorded: the branch, never the gated release. A missing setting must not mean "gated",
    // because that is the state that hid a merged fix.
    expect(readDefaultSource(registry)).toBe('branch')
    writeFileSync(join(registry, 'oc-default.json'), 'not json at all')
    expect(readDefaultSource(registry)).toBe('branch')
    writeFileSync(join(registry, 'oc-default.json'), JSON.stringify({source: 'nonsense'}))
    expect(readDefaultSource(registry)).toBe('branch')

    expect(writeDefaultSource('gated', registry)).toBe('gated')
    expect(readDefaultSource(registry)).toBe('gated')
    expect(writeDefaultSource('branch', registry)).toBe('branch')
    expect(readDefaultSource(registry)).toBe('branch')
    expect(() => writeDefaultSource('agents', registry)).toThrow(/branch or gated/)
  } finally {rmSync(registry, {recursive: true, force: true})}
})

test('how far behind the branch a release is, and nothing invented when that cannot be told', () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'oc-behind-')))
  try {
    const repository = join(home, 'repo'); mkdirSync(repository)
    git(repository, ['init', '--initial-branch=agents'])
    git(repository, ['config', 'user.email', 'test@example.invalid'])
    git(repository, ['config', 'user.name', 'Test'])
    writeFileSync(join(repository, 'file'), 'one'); git(repository, ['add', 'file']); git(repository, ['commit', '-m', 'one'])
    const first = git(repository, ['rev-parse', 'HEAD'])
    git(repository, ['update-ref', 'refs/remotes/origin/agents', first])
    expect(commitsBehind(repository, first)).toBe(0)
    writeFileSync(join(repository, 'file'), 'two'); git(repository, ['commit', '-am', 'two'])
    writeFileSync(join(repository, 'file'), 'three'); git(repository, ['commit', '-am', 'three'])
    git(repository, ['update-ref', 'refs/remotes/origin/agents', git(repository, ['rev-parse', 'HEAD'])])
    expect(commitsBehind(repository, first)).toBe(2)
    // A commit the repository has never heard of, and no commit at all, are both "cannot tell".
    expect(commitsBehind(repository, 'f'.repeat(40))).toBeUndefined()
    expect(commitsBehind(repository, undefined)).toBeUndefined()
  } finally {rmSync(home, {recursive: true, force: true})}
})
