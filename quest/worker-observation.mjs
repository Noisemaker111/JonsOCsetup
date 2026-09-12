/** A saved session or unfinished message is never evidence of a live execution. */
export function observeWorker(session, { active, messages = [], permissions = [], forms = [], expected, now = Date.now() } = {}) {
  const time = value => typeof value === 'number' ? value : Date.parse(value ?? '')
  const updated = Math.max(time(session?.time?.updated) || 0, ...messages.map(m => time(m.time?.completed ?? m.time?.streamed ?? m.time?.created) || 0))
  const base = { checkedAt: new Date(now).toISOString(), lastActivityAt: updated ? new Date(updated).toISOString() : undefined, provider: session?.model?.providerID, model: session?.model?.id, reasoning: session?.model?.variant ?? 'unknown' }
  if (permissions.length) {
    const clean = value => String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]/g, '').slice(0,180)
    const requests = permissions.slice(0,3).map(request => {
      const action = clean(request.action ?? 'permission')
      // Shell resources can contain credentials; show their action, never their arguments.
      const resources = ['read','external_directory'].includes(action) && Array.isArray(request.resources) ? request.resources.filter(value=>typeof value==='string').slice(0,2).map(clean) : []
      return { action, resources }
    })
    const detail = requests.map(request=>request.action+(request.resources.length?' ('+request.resources.join(', ')+')':'')).join('; ')
    return { ...base, state: 'blocked', permissions: requests, reason: 'Waiting for host permission: '+detail+(permissions.length>3?'; '+(permissions.length-3)+' more':'')+'. Open the worker session to review. Existing launch retained.' }
  }
  if (forms.length) return { ...base, state: 'blocked', reason: 'Waiting for a worker question. Open the worker session to review. Existing launch retained.' }
  if (active !== true && session?.outcome && time(session.time?.idle) >= updated) return { ...base, state: { succeeded: 'completed', failed: 'failed', interrupted: 'interrupted' }[session.outcome] ?? 'unknown', outcome: session.outcome, completedAt: new Date(time(session.time.idle)).toISOString(), reason: 'Persisted host execution outcome; step completion is separate' }
  if (active !== false && expected?.providerID && expected?.modelID && expected?.reasoningEffort && (session?.agent !== expected.agentRole || session?.model?.providerID !== expected.providerID || session?.model?.id !== expected.modelID || session?.model?.variant !== expected.reasoningEffort)) return { ...base, state: 'blocked', reason: 'Host agent/model/reasoning differs from the recorded dispatch. Return to your Quest Giver to inspect and restore the existing assignment; do not redispatch.' }
  if (active === true) return { ...base, state: 'running', reason: 'Owning host confirms an active execution' }
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
