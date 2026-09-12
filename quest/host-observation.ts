/** Live observations belong to the connected session client, never a process-wide singleton. */
type State = { connected: boolean; sessions: Map<string, { active: boolean; at: string }>; permission?: any; generate?: any }
const KEY = Symbol.for('opencode-config.quest.host-observations')
const registry = globalThis as typeof globalThis & { [KEY]?: WeakMap<object, State> }
const hosts = registry[KEY] ??= new WeakMap<object, State>()
export function registerHostObservation(host: object, permission?: any, generate?: any) {
 let state = hosts.get(host)
 if (!state) { state = { connected: false, sessions: new Map() }; hosts.set(host, state) }
 if (permission) state.permission = permission
 if (generate) state.generate = generate
 return state
}
export function connectHostObservation(host: object, permission?: any) {
 const state = registerHostObservation(host, permission)
 state.connected = true
 state.sessions.clear()
}
export function disconnectHostObservation(host: object) {
 const state = hosts.get(host)
 if (state) { state.connected = false; state.sessions.clear() }
}
export function recordHostObservation(host: object, event: any) {
 const state = hosts.get(host), id = event?.data?.sessionID
 if (!state?.connected || !id) return
 if (event.type === 'session.status') {
  const status = event.data.status?.type
  if (status === 'running' || status === 'idle') state.sessions.set(id, { active: status === 'running', at: new Date().toISOString() })
  else state.sessions.delete(id)
 } else if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type)) state.sessions.set(id, { active: false, at: new Date().toISOString() })
}
export function hostExecution(host: object, id: string) {
 const state = hosts.get(host)
 return state?.connected ? state.sessions.get(id)?.active : undefined
}
export async function hostPermissions(host: object, id: string) {
 const state = hosts.get(host)
 return state?.permission?.list ? await state.permission.list({ sessionID: id }) : []
}

/** These domains are location-scoped; invoke them only from the worker's owning plugin. */
export function hostPermissionDomain(host:object){return hosts.get(host)?.permission}
export function hostReviewText(host:object,input:{prompt:string;model:any}){
 const generate=hosts.get(host)?.generate
 if(!generate?.text)throw Error('Native permission reviewer generation is unavailable')
 return generate.text(input)
}
