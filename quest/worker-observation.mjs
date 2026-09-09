/** A saved session or unfinished message is never evidence of a live execution. */
export function observeWorker(session, { active, messages = [], permissions = [], now = Date.now() } = {}) {
  const time = value => typeof value === 'number' ? value : Date.parse(value ?? '')
  const updated = Math.max(time(session?.time?.updated) || 0, ...messages.map(m => time(m.time?.completed ?? m.time?.streamed ?? m.time?.created) || 0))
  const base = { checkedAt: new Date(now).toISOString(), lastActivityAt: updated ? new Date(updated).toISOString() : undefined, provider: session?.model?.providerID, model: session?.model?.id, reasoning: session?.model?.variant ?? 'unknown' }
  if (permissions.length) return { ...base, state: 'blocked', reason: 'Waiting for a host permission response' }
  if (active === true) return { ...base, state: 'running', reason: 'Owning host confirms an active execution' }
  if (session?.outcome && time(session.time?.idle) >= time(session.time?.updated)) return { ...base, state: { succeeded: 'completed', failed: 'failed', interrupted: 'interrupted' }[session.outcome] ?? 'unknown', outcome: session.outcome, completedAt: new Date(time(session.time.idle)).toISOString(), reason: 'Persisted host execution outcome; step completion is separate' }
  return { ...base, state: 'unknown', reason: active === false ? 'Host has no active execution or terminal outcome; inspect the session before retrying' : 'Session exists; live execution is not confirmed' }
}
export function observationFailure(error, now = Date.now()) {
  const status = error?.status ?? error?.response?.status
  return { state: status === 404 ? 'missing' : 'unreachable', checkedAt: new Date(now).toISOString(), reason: status === 404 ? 'Session is missing from this host; it may belong to another host or have been pruned. Ownership retained.' : 'Owning host inspection failed. Check its connection, then refresh; do not redispatch an uncertain worker.' }
}

/** Bound inspection without cancelling or restarting the worker itself. */
export async function boundedInspection(operation, milliseconds = 5000) {
 let timer;const controller=new AbortController()
 try {return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Host inspection timed out'))},milliseconds)})])}
 finally {clearTimeout(timer)}
}
