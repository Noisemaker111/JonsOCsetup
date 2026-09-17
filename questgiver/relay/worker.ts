import { signOut, startGoogle, finishGoogle, currentUser, type User } from './auth'
import { claimLink, describeLink, pollLink, startLink } from './link'
export { Machine } from './machine'

export type Env = {
  DB: D1Database
  MACHINE: DurableObjectNamespace
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}

export const json = (status: number, value: unknown, headers?: HeadersInit) => Response.json(value, { status, headers })
export const refuse = (status: number, code: string, message: string) => json(status, { code, message })

const machineStub = (env: Env, id: string) => env.MACHINE.get(env.MACHINE.idFromName(id))

/**
 * A browser request is ours only when the browser says it came from this site. Cookies are
 * SameSite=Lax, and this closes what Lax leaves open: another site's form or script.
 */
function fromThisSite(request: Request, url: URL) {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  if (request.method === 'GET' || request.method === 'HEAD') return true
  return request.headers.get('origin') === url.origin
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    try {
      // The connector's side. No cookie; a machine proves itself with its key.
      if (path === '/api/link/start' && request.method === 'POST') return startLink(request, env, url)
      if (path === '/api/link/poll' && request.method === 'POST') return pollLink(request, env)
      if (path === '/connect/challenge' || path === '/connect') {
        const id = url.searchParams.get('machine') ?? ''
        const row = await env.DB.prepare('SELECT public_key FROM machines WHERE id = ?').bind(id).first<{ public_key: string }>()
        if (!row) return refuse(401, 'UNKNOWN_MACHINE', 'This computer is not linked.')
        if (path === '/connect/challenge') return machineStub(env, id).fetch('https://machine/challenge')
        const headers = new Headers(request.headers)
        headers.set('x-machine-key', row.public_key)
        const answer = await machineStub(env, id).fetch(new Request(`https://machine/connect?machine=${encodeURIComponent(id)}`, { headers }))
        if (answer.status === 101) await env.DB.prepare('UPDATE machines SET last_seen = ? WHERE id = ?').bind(Date.now(), id).run()
        return answer
      }

      if (path === '/auth/google/start') return startGoogle(request, env, url)
      if (path === '/auth/google/callback') return finishGoogle(request, env, url)

      if (!fromThisSite(request, url)) return refuse(403, 'FORBIDDEN', 'Requests must come from this site.')
      if (path === '/auth/signout' && request.method === 'POST') return signOut(request, env)

      const session = await currentUser(request, env)
      if (path === '/api/me') {
        if (!session) return json(200, { user: null, google: !!env.GOOGLE_CLIENT_ID })
        return json(200, { user: session.user, machines: await machines(env, session.user) }, session.refresh)
      }
      if (!session) return refuse(401, 'SIGNED_OUT', 'Sign in first.')
      const user = session.user

      const link = path.match(/^\/api\/link\/([A-Za-z0-9-]+)(\/claim)?$/)
      if (link && !link[2] && request.method === 'GET') return describeLink(env, link[1])
      if (link && link[2] && request.method === 'POST') return claimLink(request, env, user, link[1])

      const machine = path.match(/^\/api\/machines\/([a-f0-9-]+)$/)
      if (machine) {
        const owned = await env.DB.prepare('SELECT id FROM machines WHERE id = ? AND user_id = ?').bind(machine[1], user.id).first()
        if (!owned) return refuse(404, 'NOT_FOUND', 'No such computer.')
        if (request.method === 'PATCH') {
          const name = String(((await request.json()) as { name?: unknown }).name ?? '').trim()
          if (!name) return refuse(400, 'INVALID_INPUT', 'A name is required.')
          await env.DB.prepare('UPDATE machines SET name = ? WHERE id = ?').bind(name, machine[1]).run()
          return json(200, { id: machine[1], name })
        }
        if (request.method === 'DELETE') {
          await env.DB.prepare('DELETE FROM machines WHERE id = ?').bind(machine[1]).run()
          await machineStub(env, machine[1]).fetch('https://machine/unlink')
          return new Response(null, { status: 204 })
        }
      }

      const forward = path.match(/^\/m\/([a-f0-9-]+)\/([a-z]+)(\/.*)$/)
      if (forward) {
        const owned = await env.DB.prepare('SELECT id FROM machines WHERE id = ? AND user_id = ?').bind(forward[1], user.id).first()
        if (!owned) return refuse(404, 'NOT_FOUND', 'No such computer.')
        return machineStub(env, forward[1]).fetch(new Request(`https://machine/forward/${forward[2]}${forward[3]}${url.search}`, request))
      }
      return refuse(404, 'NOT_FOUND', 'Unknown endpoint.')
    } catch (error) {
      console.error(error)
      return refuse(500, 'FAILED', (error as Error).message)
    }
  },
} satisfies ExportedHandler<Env>

async function machines(env: Env, user: User) {
  const rows = (await env.DB.prepare('SELECT id, name, created, last_seen FROM machines WHERE user_id = ? ORDER BY created').bind(user.id).all<{ id: string; name: string; created: number; last_seen: number | null }>()).results
  return Promise.all(rows.map(async row => {
    const presence = await machineStub(env, row.id).fetch('https://machine/presence').then(answer => answer.json<{ online: boolean }>())
    return { id: row.id, name: row.name, created: row.created, lastSeen: row.last_seen, online: presence.online }
  }))
}
