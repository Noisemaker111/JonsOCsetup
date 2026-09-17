import { sha256, type User } from './auth'
import { json, refuse, type Env } from './worker'

// No 0/O, 1/I/L or U: the code is read off one screen and typed on another.
const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
const lifetime = 10 * 60 * 1000

const normalize = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '')
const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

/** What both screens show, so a code typed for the wrong computer is visible before the click. */
export async function fingerprint(publicKey: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64url(publicKey)))
  return [...digest.subarray(0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join(':')
}

export async function startLink(request: Request, env: Env, url: URL) {
  const input = (await request.json()) as { name?: unknown; publicKey?: unknown }
  const name = String(input.name ?? '').trim(), publicKey = String(input.publicKey ?? '')
  if (!name || fromBase64url(publicKey).byteLength !== 32) return refuse(400, 'INVALID_INPUT', 'A name and an Ed25519 public key are required.')
  if (await env.DB.prepare('SELECT id FROM machines WHERE public_key = ?').bind(publicKey).first()) return refuse(409, 'ALREADY_LINKED', 'This computer is already linked.')
  const now = Date.now()
  await env.DB.prepare('DELETE FROM links WHERE created < ? OR public_key = ?').bind(now - lifetime, publicKey).run()
  const raw = [...crypto.getRandomValues(new Uint8Array(8))].map(byte => alphabet[byte % alphabet.length]).join('')
  await env.DB.prepare('INSERT INTO links (code_hash, public_key, name, created) VALUES (?, ?, ?, ?)').bind(await sha256(raw), publicKey, name, now).run()
  const code = raw.slice(0, 4) + '-' + raw.slice(4)
  return json(200, { code, url: `${url.origin}/link?code=${code}`, fingerprint: await fingerprint(publicKey), expiresAt: now + lifetime })
}

const pending = (env: Env, code: string) => sha256(normalize(code)).then(hash =>
  env.DB.prepare('SELECT code_hash, public_key, name, created, machine_id FROM links WHERE code_hash = ?').bind(hash).first<{ code_hash: string; public_key: string; name: string; created: number; machine_id: string | null }>())

export async function pollLink(request: Request, env: Env) {
  const input = (await request.json()) as { code?: unknown; publicKey?: unknown }
  const row = await pending(env, String(input.code ?? ''))
  if (!row || row.public_key !== input.publicKey) return refuse(404, 'NO_LINK', 'This link request does not exist or has expired.')
  if (row.machine_id) { await env.DB.prepare('DELETE FROM links WHERE code_hash = ?').bind(row.code_hash).run(); return json(200, { state: 'linked', machine: row.machine_id }) }
  if (Date.now() - row.created > lifetime) return refuse(404, 'NO_LINK', 'This link request has expired.')
  return json(200, { state: 'pending' })
}

export async function describeLink(env: Env, code: string) {
  const row = await pending(env, code)
  if (!row || row.machine_id || Date.now() - row.created > lifetime) return refuse(404, 'NO_LINK', 'That code is not waiting to be linked. Run `questgiver link` on the computer again.')
  return json(200, { name: row.name, fingerprint: await fingerprint(row.public_key) })
}

export async function claimLink(request: Request, env: Env, user: User, code: string) {
  const row = await pending(env, code)
  if (!row || row.machine_id || Date.now() - row.created > lifetime) return refuse(404, 'NO_LINK', 'That code is not waiting to be linked.')
  const input = (await request.json().catch(() => ({}))) as { name?: unknown }
  const id = crypto.randomUUID(), name = String(input.name ?? '').trim() || row.name
  await env.DB.batch([
    env.DB.prepare('INSERT INTO machines (id, user_id, name, public_key, created) VALUES (?, ?, ?, ?, ?)').bind(id, user.id, name, row.public_key, Date.now()),
    env.DB.prepare('UPDATE links SET machine_id = ? WHERE code_hash = ?').bind(id, row.code_hash),
  ])
  return json(200, { id, name })
}
