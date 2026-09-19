/**
 * @core-prevents a permission request being unapprovable because its action was long rather than secret
 * @core-observed September 16: the Quest to rewrite the shared MEMORY.md could not start. The reviewer read the
 * request on opencode-go/deepseek-v4.1-flash#high and decided "once", the decision was discarded because
 * canApprove compared the details against redact(details,6000) — which strips secrets and also slices at 6000
 * characters — and it escalated with "Exact action details are incomplete or redacted" when nothing had been
 * redacted. The file the worker had to read is 11,409 characters, so the request could never be approved.
 */
import { expect, test } from 'bun:test'
import { WorkerPermissions } from '../quest/worker-permissions'

const SESSION = 'ses_worker_permission_length'

function inspecting(input: unknown) {
  const request = { id: 'req-1', sessionID: SESSION, action: 'edit', resources: [], save: false, source: { messageID: 'msg-1', id: 'tool-1' } }
  const permissions = new WorkerPermissions(
    { read: () => ({ id: 'q', state: 'Working', title: 'Rewrite the shared memory', description: 'd', stages: [], sessions: [{ callID: 'run-1', runID: 'run-1', state: 'executing', deliverables: [], sessionID: SESSION, scope: {} }] }) } as any,
    { get: async () => ({ id: SESSION }), context: async () => [{ id: 'msg-1', content: [{ type: 'tool', id: 'tool-1', name: 'edit', state: { input } }] }] } as any,
    { list: async () => [request] } as any,
  )
  // owned() guards the caller; exercise the inspection itself, which is where approvability is decided.
  ;(permissions as any).owned = async () => ({ quest: (permissions.store as any).read(), run: { callID: 'run-1', runID: 'run-1', state: 'executing', deliverables: [], sessionID: SESSION, scope: {} } })
  return permissions.inspect('ses_giver', 'q', 'run-1')
}

test('a long action stays approvable, and the reviewer is shown all of it', async () => {
  const content = 'a'.repeat(11_409)
  const view = await inspecting({ path: 'MEMORY.md', content })

  expect(view.requests[0].canApprove).toBe(true)
  // Truncating what the reviewer sees is what made a long action look redacted.
  expect(view.requests[0].source).toContain(content)
  expect(view.requests[0].sourceCharacters).toBeGreaterThan(11_409)
})

test('an action carrying a secret is not approvable however short it is', async () => {
  const view = await inspecting({ command: 'deploy --token=sk-ThisLooksLikeARealKey123' })

  expect(view.requests[0].canApprove).toBe(false)
  expect(view.requests[0].source).toContain('[REDACTED]')
})
