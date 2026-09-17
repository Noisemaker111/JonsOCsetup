import { refuse, type Env } from './worker'

export type User = { id: string; email: string; name: string; picture: string | null }

const SESSION = 'qg_session', PENDING = 'qg_signin'
// Browsers cap a cookie's life at about 400 days; re-issuing on use is what makes sign-in permanent.
const cookieSeconds = 400 * 24 * 60 * 60
const refreshAfter = 24 * 60 * 60 * 1000

const base64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)))
export const sha256 = async (text: string) => base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

function cookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
}
const setCookie = (name: string, value: string, seconds: number, secure: boolean) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`

export async function currentUser(request: Request, env: Env) {
  const id = cookie(request, SESSION)
  if (!id) return
  const hash = await sha256(id)
  const row = await env.DB.prepare('SELECT u.id, u.email, u.name, u.picture, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?').bind(hash).first<User & { last_seen: number }>()
  if (!row) return
  let refresh: HeadersInit | undefined
  if (Date.now() - row.last_seen > refreshAfter) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?').bind(Date.now(), hash).run()
    refresh = { 'set-cookie': setCookie(SESSION, id, cookieSeconds, new URL(request.url).protocol === 'https:') }
  }
  return { user: { id: row.id, email: row.email, name: row.name, picture: row.picture } satisfies User, refresh }
}

/** OpenID Connect authorization-code flow with PKCE. */
export async function startGoogle(_request: Request, env: Env, url: URL) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return refuse(503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in has no client configured on this deployment.')
  const state = random(), nonce = random(), verifier = random(48)
  const returnTo = url.searchParams.get('return') ?? '/'
  const target = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/auth/google/callback', response_type: 'code', scope: 'openid email profile',
    state, nonce, code_challenge: await sha256(verifier), code_challenge_method: 'S256', prompt: 'select_account',
  }).toString()
  const pending = base64url(new TextEncoder().encode(JSON.stringify({ state, nonce, verifier, returnTo: returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/' })))
  return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': setCookie(PENDING, pending, 600, url.protocol === 'https:') } })
}

export async function finishGoogle(request: Request, env: Env, url: URL) {
  const raw = cookie(request, PENDING)
  if (!raw || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return refuse(400, 'SIGNIN_EXPIRED', 'Start signing in again.')
  const pending = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))) as { state: string; nonce: string; verifier: string; returnTo: string }
  const code = url.searchParams.get('code')
  if (!code || url.searchParams.get('state') !== pending.state) return refuse(400, 'SIGNIN_MISMATCH', 'Start signing in again.')
  const exchange = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + '/auth/google/callback', grant_type: 'authorization_code', code_verifier: pending.verifier }),
  })
  if (!exchange.ok) return refuse(502, 'GOOGLE_REFUSED', 'Google did not accept the sign-in.')
  // The token came straight from Google over TLS, which is what OpenID Connect accepts in place of a signature check here.
  const token = ((await exchange.json()) as { id_token: string }).id_token.split('.')[1]
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))) as { iss: string; aud: string; sub: string; nonce: string; exp: number; email: string; email_verified: boolean; name?: string; picture?: string }
  if (!/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID || claims.nonce !== pending.nonce || claims.exp * 1000 < Date.now() || !claims.email_verified)
    return refuse(400, 'SIGNIN_INVALID', 'Google returned a sign-in this site cannot accept.')

  const now = Date.now()
  await env.DB.prepare('INSERT INTO users (id, google_sub, email, name, picture, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture')
    .bind(crypto.randomUUID(), claims.sub, claims.email, claims.name ?? claims.email, claims.picture ?? null, now).run()
  const user = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(claims.sub).first<{ id: string }>()
  const session = random()
  await env.DB.prepare('INSERT INTO sessions (id_hash, user_id, created, last_seen, user_agent) VALUES (?, ?, ?, ?, ?)').bind(await sha256(session), user!.id, now, now, request.headers.get('user-agent')).run()
  const secure = url.protocol === 'https:'
  const headers = new Headers({ location: pending.returnTo })
  headers.append('set-cookie', setCookie(SESSION, session, cookieSeconds, secure))
  headers.append('set-cookie', setCookie(PENDING, '', 0, secure))
  return new Response(null, { status: 302, headers })
}

export async function signOut(request: Request, env: Env) {
  const id = cookie(request, SESSION)
  if (id) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(id)).run()
  return new Response(null, { status: 204, headers: { 'set-cookie': setCookie(SESSION, '', 0, new URL(request.url).protocol === 'https:') } })
}
