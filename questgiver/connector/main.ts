import { spawn } from 'node:child_process'
import { bodyChunkBytes, connectMessage, decodeBody, encodeBody, hopHeaders, type Downstream, type Upstream } from '../protocol/frames'
import { loadIdentity, saveIdentity, signWith, type Identity } from './identity'
import { permits, resolveLocal, usage } from './targets'

const [command = 'run', ...rest] = process.argv.slice(2)
let relay = (rest.find(arg => /^https?:\/\//.test(arg)) ?? process.env.QUESTGIVER_RELAY ?? '').replace(/\/$/, '')

const post = async (path: string, body: unknown) => {
  const answer = await fetch(relay + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const value = await answer.json() as any
  if (!answer.ok) throw new Error(value.message ?? `${path} answered ${answer.status}`)
  return value
}

async function link(identity: Identity) {
  if (identity.machine) { console.log(`This computer is already linked to ${identity.relay}.`); return identity }
  const started = await post('/api/link/start', { name: identity.name, publicKey: identity.publicKey })
  console.log(`\nLink this computer at ${started.url}\n\n  code         ${started.code}\n  fingerprint  ${started.fingerprint}\n`)
  const opener = process.platform === 'win32' ? ['cmd', '/c', 'start', '""', started.url] : process.platform === 'darwin' ? ['open', started.url] : ['xdg-open', started.url]
  try { spawn(opener[0], opener.slice(1), { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref() } catch {}
  while (Date.now() < started.expiresAt) {
    await Bun.sleep(2000)
    const state = await post('/api/link/poll', { code: started.code, publicKey: identity.publicKey })
    if (state.state === 'linked') { identity.machine = state.machine; saveIdentity(identity); console.log('Linked.'); return identity }
  }
  throw new Error('Nobody confirmed the link in time. Run this again.')
}

/** Strips what described the browser's hop, and anything that would make a local service mistake us for a browser. */
function localHeaders(headers: Record<string, string>, authorization: string) {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) if (!hopHeaders.has(name) && !['origin', 'referer', 'authorization', 'cookie'].includes(name) && !name.startsWith('sec-')) out[name] = value
  out.authorization = authorization
  return out
}

function serve(identity: Identity, socket: WebSocket) {
  const streams = new Map<number, { abort: AbortController; body?: ReadableStreamDefaultController<Uint8Array> }>()
  const send = (frame: Upstream) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame)) }

  async function open(frame: Extract<Downstream, { t: 'open' }>) {
    const abort = new AbortController()
    const entry: { abort: AbortController; body?: ReadableStreamDefaultController<Uint8Array> } = { abort }
    streams.set(frame.s, entry)
    const hasBody = frame.method !== 'GET' && frame.method !== 'HEAD'
    // A request body arrives as frames after `open`; buffer it, since local requests here are small JSON.
    const body = hasBody ? await new Response(new ReadableStream<Uint8Array>({ start: controller => { entry.body = controller } })).arrayBuffer() : undefined
    try {
      if (!permits(frame.target, frame.path)) { await answer(frame.s, Response.json({ code: 'NOT_PERMITTED', message: 'This computer does not offer that to the web.' }, { status: 403 })); return }
      if (frame.target === 'usage') { await answer(frame.s, await usage(frame.path)); return }
      const call = async (fresh: boolean) => {
        const local = await resolveLocal(frame.target as 'host' | 'quest', fresh)
        // Bun gives up on response headers after five minutes; `wait` and a long prompt take longer.
        return fetch(local.url + frame.path, { method: frame.method, headers: localHeaders(frame.headers, local.authorization), body, signal: abort.signal, timeout: false } as RequestInit)
      }
      const response = await call(false).catch(error => { if (abort.signal.aborted) throw error; return call(true) })
      // 401 means the service restarted with a new credential and refused before doing anything, so asking again is safe.
      await answer(frame.s, response.status === 401 ? await call(true) : response)
    } catch (error) {
      if (!abort.signal.aborted) send({ t: 'abort', s: frame.s, message: (error as Error).message })
    } finally { streams.delete(frame.s) }
  }

  async function answer(s: number, response: Response) {
    const headers: Record<string, string> = {}
    response.headers.forEach((value, name) => { if (!hopHeaders.has(name) && name !== 'content-encoding') headers[name] = value })
    send({ t: 'head', s, status: response.status, headers })
    if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>)
      for (let at = 0; at < chunk.byteLength; at += bodyChunkBytes) socket.send(encodeBody(s, chunk.subarray(at, at + bodyChunkBytes)))
    send({ t: 'end', s })
  }

  socket.binaryType = 'arraybuffer'
  socket.addEventListener('message', event => {
    if (typeof event.data !== 'string') { const { s, chunk } = decodeBody(event.data as ArrayBuffer); streams.get(s)?.body?.enqueue(chunk.slice()); return }
    if (event.data === 'pong') return
    const frame = JSON.parse(event.data) as Downstream
    if (frame.t === 'open') void open(frame)
    else if (frame.t === 'end') { try { streams.get(frame.s)?.body?.close() } catch {} }
    else if (frame.t === 'abort') streams.get(frame.s)?.abort.abort()
  })
  const beat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('ping') }, 30_000)
  return () => { clearInterval(beat); for (const stream of streams.values()) stream.abort.abort() }
}

async function run(identity: Identity) {
  if (!identity.machine) identity = await link(identity)
  for (let failures = 0; ;) {
    try {
      const challenge = await fetch(`${relay}/connect/challenge?machine=${identity.machine}`)
      if (challenge.status === 401) throw Object.assign(new Error('This computer was unlinked on the site. Run `questgiver link` to link it again.'), { fatal: true })
      const { nonce } = await challenge.json() as { nonce: string }
      const socket = new WebSocket(`${relay.replace(/^http/, 'ws')}/connect?machine=${identity.machine}`, { headers: { 'x-machine-signature': signWith(identity, connectMessage(identity.machine!, nonce)) } } as never)
      const closed = await new Promise<string>(resolve => {
        let stop = () => {}
        socket.addEventListener('open', () => { failures = 0; console.log(`${new Date().toISOString()} linked to ${relay} as ${identity.name}`); stop = serve(identity, socket) })
        socket.addEventListener('close', event => { stop(); resolve(event.reason || `closed (${event.code})`) })
        socket.addEventListener('error', () => {})
      })
      console.log(`${new Date().toISOString()} link lost: ${closed}`)
      if (closed === 'unlinked') throw Object.assign(new Error('This computer was unlinked on the site.'), { fatal: true })
    } catch (error) {
      if ((error as { fatal?: boolean }).fatal) { identity.machine = undefined; saveIdentity(identity); throw error }
      console.log(`${new Date().toISOString()} ${(error as Error).message}`)
    }
    await Bun.sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)))
  }
}

const identity = loadIdentity(relay)
relay = identity.relay
await (command === 'link' ? link(identity) : command === 'run' ? run(identity) : Promise.reject(new Error(`Unknown command: ${command}`)))
