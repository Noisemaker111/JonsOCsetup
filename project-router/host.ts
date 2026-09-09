import { spawn } from 'node:child_process'
import { resolveHostExecutable } from './executable.mjs'

export class RouterError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
export function redact(text: string, limit = 1000) {
  return text.replace(/(?:https?|ssh):\/\/[^\s/@]+(?::[^\s/@]*)?@/gi, '[redacted-url]@')
    .replace(/(?:Bearer\s+|(?:token|password|api[_-]?key)[=:]\s*)[^\s"'&]+/gi, '[redacted]')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, limit)
}
/** No shell interpolation, credentials, private leases, or database access. */
export function runArgv(executable: string, args: string[], options: { timeout?: number; maxBytes?: number; signal?: AbortSignal; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', bytes = 0, settled = false
    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
      if (error) { child.kill(); reject(error) } else resolve({ code, stdout, stderr })
    }
    const abort = () => finish(new RouterError('CANCELLED', 'Operation cancelled; partial work is preserved'))
    const timer = setTimeout(() => finish(new RouterError('TIMEOUT', 'Operation timed out; inspect before retry')), options.timeout ?? 30000)
    for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]] as const) stream.on('data', data => {
      bytes += data.length
      if (bytes > (options.maxBytes ?? 1024 * 1024)) return finish(new RouterError('OUTPUT_LIMIT', 'Host output exceeded the bounded discovery budget'))
      if (isError) stderr += data.toString(); else stdout += data.toString()
    })
    child.once('error', () => finish(new RouterError('HOST_CAPABILITY_MISSING', 'Configured executable could not be started')))
    child.once('close', code => finish(undefined, code))
    options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort()
  })
}
export function hostExecutable() { return resolveHostExecutable() }
export class DiscoveryHost {
  constructor(readonly executable = hostExecutable(), readonly run = runArgv) {}
  async get(path: string) {
    if (!/^\/api\/(?:project|session(?:\/ses_[A-Za-z0-9]+\/message)?)(?:\?[A-Za-z0-9%_.~+=&-]+)?$/.test(path)) throw new RouterError('INVALID_DISCOVERY_PATH', 'Only bounded project/session GET discovery is allowed')
    const result = await this.run(this.executable, ['api', '--standalone', 'GET', path], { timeout: 30000, maxBytes: 1024 * 1024 })
    if (result.code !== 0) throw new RouterError('DISCOVERY_UNAVAILABLE', 'Host discovery failed; check the installed CLI and retry explicitly')
    try { return JSON.parse(result.stdout) } catch { throw new RouterError('INVALID_HOST_RESPONSE', 'Host returned non-JSON discovery output') }
  }
  async projects() {
    const result = await this.get('/api/project')
    if (!Array.isArray(result) || result.some(x => typeof x?.id !== 'string' || typeof x?.canonical !== 'string' || !Array.isArray(x?.sandboxes))) throw new RouterError('INVALID_HOST_RESPONSE', 'Expected the host project root array')
    return result.slice(0, 1000).map(x => ({ hostID: x.id, directory: x.canonical, sandboxes: x.sandboxes.filter((s: unknown) => typeof s === 'string').slice(0, 30) as string[] }))
  }
  async sessions(input: { search?: string; cursor?: string; limit?: number } = {}) {
    const query = new URLSearchParams({ limit: String(Math.min(30, Math.max(1, input.limit ?? 10))) })
    if (input.search) query.set('search', input.search.slice(0, 100))
    if (input.cursor) query.set('cursor', input.cursor.slice(0, 2000))
    const result = await this.get('/api/session?' + query)
    if (!Array.isArray(result?.data) || !result.cursor || result.data.some((s: any) => typeof s.id !== 'string' || typeof s.location?.directory !== 'string')) throw new RouterError('INVALID_HOST_RESPONSE', 'Expected a paginated session envelope')
    if (result.data.some((s: any) => s.parentID != null && typeof s.parentID !== 'string') || (result.cursor.next != null && typeof result.cursor.next !== 'string')) throw new RouterError('INVALID_HOST_RESPONSE', 'Expected optional string parent IDs and cursor')
    return { items: result.data.slice(0, 30).map((s: any) => ({ id: s.id, title: redact(s.title ?? '', 160), directory: s.location.directory, ...(typeof s.parentID === 'string' ? { parentID: s.parentID } : {}) })), next: result.cursor.next ?? null }
  }
  async messages(sessionID: string, cursor?: string) {
    if (!/^ses_[A-Za-z0-9]+$/.test(sessionID)) throw new RouterError('INVALID_INPUT', 'Use an exact discovered session identity')
    const query = new URLSearchParams({ limit: '3', ...(cursor ? { cursor: cursor.slice(0, 2000) } : { order: 'desc' }) })
    const result = await this.get(`/api/session/${encodeURIComponent(sessionID)}/message?${query}`)
    if (!Array.isArray(result?.data) || !result.cursor || result.data.some((m: any) => typeof m.id !== 'string' || typeof m.type !== 'string' || !(Array.isArray(m.content)||typeof m.text==='string'))) throw new RouterError('INVALID_HOST_RESPONSE', 'Expected paginated id/type records with content parts or user text')
    return { items: result.data.slice(0, 3).map((m: any) => ({ id: m.id, role: m.type, excerpt: redact(typeof m.text==='string'?m.text:m.content.filter((p: any) => p.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('\n'), 1200), ...(Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='tool')?{tools:m.content.filter((p:any)=>p.type==='tool').slice(-4).map((p:any)=>({name:p.name,status:p.state?.status,calls:p.state?.metadata?.toolCalls?.map((c:any)=>({name:c.tool,status:c.status})),result:redact(Array.isArray(p.state?.content)?p.state.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n'):String(p.state?.error??'No result recorded'),1000)}))}:{}) })), next: result.cursor.next ?? null }
  }
}
