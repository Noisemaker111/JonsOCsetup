/** Live observations belong to the connected session client, never a process-wide singleton. */
type State = { connected: boolean; sessions: Map<string, { active: boolean; at: string }>; permission?: any; catalog?: any; toolWaits?:Map<string,Set<AbortController>> }
const KEY = Symbol.for('opencode-config.quest.host-observations')
const registry = globalThis as typeof globalThis & { [KEY]?: WeakMap<object, State> }
const hosts = registry[KEY] ??= new WeakMap<object, State>()
export function registerHostObservation(host: object, permission?: any, catalog?: any) {
 let state = hosts.get(host)
 if (!state) { state = { connected: false, sessions: new Map() }; hosts.set(host, state) }
 if (permission) state.permission = permission
 if (catalog) state.catalog = catalog
 return state
}
/** Account discovery is machine-wide; inference must use this host's active integrations. */
export async function hostModelIdentities(host:object):Promise<string[]> {
 const catalog=hosts.get(host)?.catalog
 if(typeof catalog?.model?.list!=='function')throw Error('Connected host model catalog is unavailable; no reviewer dispatched')
 const response=await catalog.model.list(),models=response?.data??response
 if(!Array.isArray(models))throw Error('Connected host returned an invalid model catalog; no reviewer dispatched')
 return [...new Set(models.filter(m=>typeof m.providerID==='string'&&typeof m.id==='string').map(m=>m.providerID+'/'+m.id))].sort()
}
export function connectHostObservation(host: object, permission?: any) {
 const state = registerHostObservation(host, permission)
 state.connected = true
 state.sessions.clear()
}
export function disconnectHostObservation(host: object) {
 const state = hosts.get(host)
 if (state) { state.connected = false; state.sessions.clear();for(const waits of state.toolWaits?.values()??[])for(const wait of waits)wait.abort(new Error('Host connection lost while waiting for workspace access')) }
}
/** The native tool context has no AbortSignal; reuse its owning host's lifecycle events. */
export function workspaceWaitSignal(host:object,sessionID:string) {
 const state=hosts.get(host)
 if(!state?.connected)throw Error('Cannot wait for workspace access without a connected host; retry after the host reconnects')
 const controller=new AbortController(),waits=(state.toolWaits??=new Map()).get(sessionID)??new Set<AbortController>()
 state.toolWaits.set(sessionID,waits);waits.add(controller)
 return {signal:controller.signal,dispose(){waits.delete(controller);if(!waits.size)state.toolWaits?.delete(sessionID)}}
}
export function recordHostObservation(host: object, event: any) {
 const state = hosts.get(host), id = event?.data?.sessionID
 if (!state?.connected || !id) return
  if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type)||event.type==='session.status'&&event.data.status?.type==='idle')for(const wait of state.toolWaits?.get(id)??[])wait.abort(new Error('Worker execution ended while waiting for workspace access'))
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
