import { expect, test } from 'bun:test'
import { collectNotes, pairKey, compareVersions } from '../project-router/update-report.mjs'

// @core-prevents GitHub numeric-repository pagination hiding missing intermediate V2 notes as a finished traversal.
// @core-observed The first public update-report run on 2026-09-14 stopped after page one because Link used /repositories/<id> instead of the requested owner/name.
test('official traversal follows numeric repository pagination and retains missing intermediate notes', async () => {
  const requests: string[] = []
  const client = { async get(url: string) {
    requests.push(url)
    if (url.includes('registry.npmjs.org')) return { url, body: { versions: { '2.0.0': {}, '2.0.1': {}, '2.0.2': {} } } }
    if (url.includes('/tags/')) return { url, status: 404 }
    const release = (v: string) => ({ tag_name: `v${v}`, body: '- Changed UI', html_url: `https://github.com/anomalyco/opencode/releases/tag/v${v}` })
    return url.includes('page=2') ? { url, body: [release('2.0.0')], next: null }
      : { url, body: [release('2.0.2'), release('1.18.30')], next: 'https://api.github.com/repositories/123/releases?per_page=100&page=2' }
  } }
  const notes = await collectNotes(client, '2.0.0', '2.0.2')
  expect(requests.at(-1)).toBe('https://api.github.com/repos/anomalyco/opencode/releases?per_page=100&page=2')
  expect(notes.exhausted).toBe(true)
  expect(notes.status).toBe('partial')
  expect(notes.missing).toEqual(['2.0.1'])
  expect(notes.releases.map(r => r.version)).toEqual(['2.0.2'])
})

test('equal versions have no gap without making network or compatibility claims', async () => {
  const notes = await collectNotes({ get() { throw Error('Unexpected fetch') } }, '2.0.3', '2.0.3')
  expect(notes.sameVersion).toBe(true)
  expect(notes.explanation).toContain('not plugin compatibility certification')
})

test('pair identity retains custom build, target commit and channel distinctions', () => {
  const baseline = { version: '2.0.1+custom', sha: null }, target = { version: '2.0.3', sha: 'a'.repeat(40) }
  const key = pairKey(baseline, target, 'latest')
  expect(pairKey({ ...baseline, version: '2.0.1' }, target, 'latest')).not.toBe(key)
  expect(pairKey(baseline, { ...target, sha: 'b'.repeat(40) }, 'latest')).not.toBe(key)
  expect(pairKey(baseline, target, 'beta')).not.toBe(key)
  expect(compareVersions('2.0.0-beta.9', '2.0.0-beta.10')).toBe(-1)
  expect(compareVersions('2.0.0-beta.10', '2.0.0')).toBe(-1)
})
