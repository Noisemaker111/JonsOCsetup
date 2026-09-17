/**
 * The link between a machine's connector and its relay Durable Object.
 *
 * One WebSocket carries many HTTP exchanges. Control travels as JSON text frames; bodies travel as
 * binary frames whose first four bytes are the stream number, so a streamed answer (the host's
 * `/api/event`) costs no encoding and never waits for its end.
 */

/** Where on the machine a request goes. The connector owns the credential for each. */
export const targets = ['host', 'quest', 'usage'] as const
export type Target = (typeof targets)[number]

export type Headers = Record<string, string>

/** Relay to connector. */
export type Downstream =
  | { t: 'open'; s: number; target: Target; method: string; path: string; headers: Headers }
  | { t: 'end'; s: number }
  | { t: 'abort'; s: number }

/** Connector to relay. */
export type Upstream =
  | { t: 'head'; s: number; status: number; headers: Headers }
  | { t: 'end'; s: number }
  | { t: 'abort'; s: number; message: string }

export function encodeBody(stream: number, chunk: Uint8Array) {
  const frame = new Uint8Array(4 + chunk.byteLength)
  new DataView(frame.buffer).setUint32(0, stream)
  frame.set(chunk, 4)
  return frame
}

export function decodeBody(frame: ArrayBuffer | Uint8Array) {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame)
  return { s: new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0), chunk: bytes.subarray(4) }
}

/** Bodies are cut to this before framing; Cloudflare refuses a WebSocket message over 1 MiB. */
export const bodyChunkBytes = 256 * 1024

/** What a connector signs to open its link. The relay issues `nonce`; nothing reusable is stored. */
export const connectMessage = (machine: string, nonce: string) => new TextEncoder().encode(`questgiver-connect:${machine}:${nonce}`)

/** Headers that describe one hop and must not cross the link. */
export const hopHeaders = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'proxy-authorization', 'te', 'trailer'])
