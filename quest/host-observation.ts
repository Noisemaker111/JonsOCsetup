/** Live observations belong to one connected host, never the saved Quest ledger. */
type State={connected:boolean;sessions:Map<string,{active:boolean;at:string}>;permission?:any}
const hosts = new WeakMap<object,State>()
const shared:State={connected:false,sessions:new Map()}
export function registerHostObservation(host:object,permission?:any){hosts.set(host,shared);if(permission)shared.permission=permission}
export function connectHostObservation(host:object,permission?:any) { registerHostObservation(host,permission);shared.connected=true;shared.sessions.clear() }
export function disconnectHostObservation(host:object) { const state=hosts.get(host);if(state){state.connected=false;state.sessions.clear()} }
export function recordHostObservation(host:object,event:any) {
 const state=hosts.get(host),id=event?.data?.sessionID;if(!state?.connected||!id)return
 if(event.type==='session.status')state.sessions.set(id,{active:event.data.status?.type==='running',at:new Date().toISOString()})
 else if(/^session.execution.(succeeded|failed|interrupted)$/.test(event.type))state.sessions.set(id,{active:false,at:new Date().toISOString()})
}
export function hostExecution(host:object,id:string) {const state=hosts.get(host);return state?.connected?state.sessions.get(id)?.active:undefined}
export async function hostPermissions(host:object,id:string) {const state=hosts.get(host);return state?.permission?.list?await state.permission.list({sessionID:id}):[]}
