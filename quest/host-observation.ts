/** Live observations belong to the connected session client, never a process-wide singleton. */
type State = { connected: boolean; sessions: Map<string, { active: boolean; at: string }>; permission?: any; catalog?: any; integration?: any; toolWaits?:Map<string,Set<AbortController>> }
const KEY = Symbol.for('opencode-config.quest.host-observations')
const registry = globalThis as typeof globalThis & { [KEY]?: WeakMap<object, State> }
const hosts = registry[KEY] ??= new WeakMap<object, State>()
export function registerHostObservation(host: object, permission?: any, catalog?: any, integration?:any) {
 let state = hosts.get(host)
 if (!state) { state = { connected: false, sessions: new Map() }; hosts.set(host, state) }
 if (permission) state.permission = permission
 if (catalog) state.catalog = catalog
 if (integration) state.integration = integration
 return state
}
/** Account discovery is machine-wide; inference must use this host's active integrations. */
export async function hostModelIdentities(host:object):Promise<string[]> {
 const state=hosts.get(host)
 return availableModelIdentities(state?.catalog,state?.integration)
}
export async function availableModelIdentities(catalog:any,integration:any):Promise<string[]> {
 if(typeof catalog?.model?.list!=='function'||typeof catalog?.provider?.list!=='function'||typeof integration?.list!=='function')throw Error('Connected host model catalog is unavailable; no reviewer dispatched')
 const results=await Promise.allSettled([catalog.model.list(),catalog.provider.list(),integration.list()])
 const [models,providers,integrations]=results.map(result=>{if(result.status==='rejected')throw result.reason;return result.value?.data??result.value})
 if(![models,providers,integrations].every(Array.isArray))throw Error('Connected host returned an invalid model catalog; no reviewer dispatched')
 const byProvider=new Map(providers.map(p=>[p.id,p])),byIntegration=new Map(integrations.map(i=>[i.id,i]))
 return [...new Set<string>(models.filter(m=>{
  if(typeof m.providerID!=='string'||typeof m.id!=='string')return false
  const provider:any=byProvider.get(m.providerID);if(!provider)return false
  const auth:any=byIntegration.get(provider.integrationID??provider.id)
  // Explicit provider activation also exposes disconnected integrations. It is visibility,
  // not evidence that this host can authenticate. Configured keys and public providers remain valid.
  return !auth&&provider.integrationID===undefined||!!auth?.connections?.length||!!m.settings?.apiKey||!!provider.settings?.apiKey
 }).map(m=>m.providerID+'/'+m.id))].sort()
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
