import { DurableObject } from 'cloudflare:workers'
import { bodyChunkBytes, connectMessage, decodeBody, encodeBody, hopHeaders, targets, type Downstream, type Target, type Upstream } from '../protocol/frames'
import type { Env } from './worker'

type Exchange = {
  head: (status: number, headers: Record<string, string>) => void
  fail: (message: string) => void
  body?: ReadableStreamDefaultController<Uint8Array>
}

const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

/**
 * One linked machine.
 *
 * Holds the connector's WebSocket and carries browser requests across it. The socket hibernates, so
 * an idle machine keeps its link without keeping this object in memory; exchanges live only in
 * memory because an exchange in flight is itself what keeps the object awake.
 */
export class Machine extends DurableObject<Env> {
  private exchanges = new Map<number, Exchange>()
  private next = 1

  private connector() { return this.ctx.getWebSockets('connector').find(socket => socket.readyState === WebSocket.OPEN) }

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/challenge') return this.challenge()
    if (url.pathname === '/connect') return this.accept(request, url)
    if (url.pathname === '/presence') return Response.json({ online: !!this.connector() })
    if (url.pathname === '/unlink') { for (const socket of this.ctx.getWebSockets()) socket.close(4001, 'unlinked'); await this.ctx.storage.deleteAll(); return new Response(null, { status: 204 }) }
    const match = url.pathname.match(/^\/forward\/([a-z]+)(\/.*)$/)
    if (match && (targets as readonly string[]).includes(match[1])) return this.forward(request, match[1] as Target, match[2] + url.search)
    return new Response('not found', { status: 404 })
  }

  private async challenge() {
    const nonce = crypto.randomUUID()
    await this.ctx.storage.put('nonce', { nonce, issued: Date.now() })
    return Response.json({ nonce })
  }

  /** The Worker has already found the machine's row; the signature over our nonce is checked here. */
  private async accept(request: Request, url: URL) {
    if (request.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const pending = await this.ctx.storage.get<{ nonce: string; issued: number }>('nonce')
    await this.ctx.storage.delete('nonce')
    const machine = url.searchParams.get('machine') ?? '', key = request.headers.get('x-machine-key') ?? '', signature = request.headers.get('x-machine-signature') ?? ''
    if (!pending || Date.now() - pending.issued > 60_000) return new Response('challenge expired', { status: 401 })
    const publicKey = await crypto.subtle.importKey('raw', fromBase64url(key), { name: 'Ed25519' }, false, ['verify'])
    if (!await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, fromBase64url(signature), connectMessage(machine, pending.nonce))) return new Response('bad signature', { status: 401 })
    for (const socket of this.ctx.getWebSockets('connector')) socket.close(4000, 'replaced by a newer connection')
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1], ['connector'])
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private async forward(request: Request, target: Target, path: string) {
    const socket = this.connector()
    if (!socket) return Response.json({ code: 'MACHINE_OFFLINE', message: 'This computer is offline.' }, { status: 503 })
    const s = this.next++
    const headers: Record<string, string> = {}
    for (const [name, value] of request.headers) if (!hopHeaders.has(name) && name !== 'cookie' && !name.startsWith('cf-') && !name.startsWith('x-forwarded')) headers[name] = value
    const send = (frame: Downstream) => socket.send(JSON.stringify(frame))
    const answer = new Promise<Response>((resolve) => {
      const exchange: Exchange = {
        head: (status, responseHeaders) => {
          const body = new ReadableStream<Uint8Array>({
            start: controller => { exchange.body = controller },
            // The browser went away; tell the machine to stop producing.
            cancel: () => { this.exchanges.delete(s); try { send({ t: 'abort', s }) } catch {} },
          })
          const clean = new Headers()
          for (const [name, value] of Object.entries(responseHeaders)) if (!hopHeaders.has(name) && name !== 'set-cookie' && name !== 'www-authenticate') clean.set(name, value)
          resolve(new Response(status === 204 || status === 304 ? null : body, { status, headers: clean }))
        },
        fail: message => resolve(Response.json({ code: 'LINK_FAILED', message }, { status: 502 })),
      }
      this.exchanges.set(s, exchange)
    })
    send({ t: 'open', s, target, method: request.method, path, headers })
    if (request.body) {
      const reader = request.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (let at = 0; at < value.byteLength; at += bodyChunkBytes) socket.send(encodeBody(s, value.subarray(at, at + bodyChunkBytes)))
      }
    }
    send({ t: 'end', s })
    return answer
  }

  webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') {
      const { s, chunk } = decodeBody(message)
      this.exchanges.get(s)?.body?.enqueue(chunk.slice())
      return
    }
    const frame = JSON.parse(message) as Upstream
    const exchange = this.exchanges.get(frame.s)
    if (!exchange) return
    if (frame.t === 'head') exchange.head(frame.status, frame.headers)
    else if (frame.t === 'end') { this.exchanges.delete(frame.s); try { exchange.body?.close() } catch {} }
    else if (frame.t === 'abort') { this.exchanges.delete(frame.s); if (exchange.body) { try { exchange.body.error(new Error(frame.message)) } catch {} } else exchange.fail(frame.message) }
  }

  webSocketClose() { this.dropAll('The computer disconnected.') }
  webSocketError() { this.dropAll('The link to the computer failed.') }

  private dropAll(message: string) {
    if (this.connector()) return
    for (const [s, exchange] of this.exchanges) { this.exchanges.delete(s); if (exchange.body) { try { exchange.body.error(new Error(message)) } catch {} } else exchange.fail(message) }
  }
}
