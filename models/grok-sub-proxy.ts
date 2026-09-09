// Grok Build sub-proxy — serves your SuperGrok $30 subscription over an
// OpenAI-compatible local endpoint so OpenCode stops paying api.x.ai per token.
//
//   listen : http://127.0.0.1:3011  (/v1/models, /v1/chat/completions, ...)
//   target : https://cli-chat-proxy.grok.com/v1/...
//   auth   : ~/.grok/auth.json session token (auto-refreshed on expiry,
//            written back so the Grok CLI picks it up too)
//
// Start: bun C:\Users\Jk101\.config\opencode\grok-sub-proxy.ts

import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { isUsageReached, usageReachedMessage } from "../usage/usage-reached"

const PORT = Number(process.env.GROK_SUB_PROXY_PORT ?? 3011)
const UPSTREAM = "https://cli-chat-proxy.grok.com"
const AUTH_PATH = join(homedir(), ".grok", "auth.json")
const CLIENT_VERSION = "1.0.5"
/** Upstream statuses that mean the SuperGrok plan is spent, not that the request was bad. */
const EXHAUSTED_STATUS = new Set([402, 403, 429])
const GROK_SUB = { providerID: "grok-sub", modelID: "grok-4.6" }

type GrokCred = {
  key: string
  refresh_token?: string
  expires_at?: string
  oidc_client_id?: string
  [k: string]: unknown
}

let inflightRefresh: Promise<string> | undefined

function parseAuth(json: string): { cred: GrokCred; keyName: string; root: any } {
  const root = JSON.parse(json)
  const keyName = Object.keys(root).find((k) => k.startsWith("https://auth.x.ai::"))
  if (!keyName) throw new Error("no auth.x.ai credential found in ~/.grok/auth.json")
  return { cred: root[keyName] as GrokCred, keyName, root }
}

async function readToken(): Promise<{ cred: GrokCred; root: any; keyName: string }> {
  return parseAuth(await readFile(AUTH_PATH, "utf8"))
}

async function refreshToken(): Promise<string> {
  if (inflightRefresh) return inflightRefresh
  inflightRefresh = (async () => {
    const { cred, root, keyName } = await readToken()
    if (!cred.refresh_token || !cred.oidc_client_id) throw new Error("missing refresh_token/client_id")
    console.log(`[grok-sub-proxy] token expired (${cred.expires_at}); refreshing`)
    const resp = (await fetch("https://auth.x.ai/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cred.refresh_token,
        client_id: cred.oidc_client_id,
      }),
    }).then((r) => r.json())) as Record<string, string>
    if (!resp.access_token) throw new Error(`refresh failed: ${JSON.stringify(resp).slice(0, 200)}`)
    cred.key = resp.access_token
    if (resp.refresh_token) cred.refresh_token = resp.refresh_token
    cred.expires_at = new Date(Date.now() + Number(resp.expires_in ?? 21600) * 1000).toISOString()
    // Re-read the file so we don't clobber concurrent CLI writes.
    let latest = root
    try {
      latest = JSON.parse(await readFile(AUTH_PATH, "utf8"))
      if (!Object.keys(latest).includes(keyName)) latest = root
    } catch {}
    latest[keyName] = cred
    await writeFile(AUTH_PATH, JSON.stringify(latest, null, 2))
    console.log(`[grok-sub-proxy] refreshed; new expiry ${cred.expires_at}`)
    return cred.key
  })().finally(() => {
    setTimeout(() => (inflightRefresh = undefined), 1000)
  })
  return inflightRefresh
}

async function bearer(): Promise<string> {
  const { cred } = await readToken()
  const expired =
    !cred.expires_at || new Date(cred.expires_at.replace(/(\.\d{6})\d*Z$/, "$1Z")).getTime() <= Date.now() + 60_000
  if (expired) return refreshToken()
  return cred.key
}

function baseHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "x-grok-client-version": CLIENT_VERSION,
    "x-grok-client-identifier": "xai-grok-cli",
    "User-Agent": `grok/${CLIENT_VERSION}`,
  }
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255, // seconds; long completions stay alive
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/ping") return new Response("ok\n")

    try {
      let token = await bearer()
      const send = async (tk: string) => {
        const headers = new Headers(baseHeaders(tk))
        const ct = req.headers.get("content-type")
        if (ct) headers.set("Content-Type", ct)
        headers.set("Accept", req.headers.get("accept") ?? "*/*")
        return fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
        })
      }

      let up = await send(token)
      if (up.status === 401) {
        console.log("[grok-sub-proxy] upstream 401 -> forcing refresh + retry")
        token = await refreshToken()
        up = await send(token)
      }
      if (!up.ok && up.status !== 426)
        console.log(`[grok-sub-proxy] ${req.method} ${url.pathname} -> ${up.status}`)

      // SuperGrok signals an exhausted plan with 402/403/429 and a body that
      // varies by endpoint. Rewrite it into the one line the rest of the stack
      // understands, so nothing downstream has to parse Grok's dialect.
      if (EXHAUSTED_STATUS.has(up.status)) {
        const body = await up.text().catch(() => "")
        console.log(`[grok-sub-proxy] plan exhausted (${up.status}); reporting usage reached`)
        return Response.json(
          { error: { type: "usage_reached", message: usageReachedMessage(GROK_SUB), detail: body.slice(0, 400) } },
          { status: up.status },
        )
      }

      const out = new Headers(up.headers)
      out.delete("transfer-encoding")
      out.set("connection", "keep-alive")
      return new Response(up.body, { status: up.status, headers: out })
    } catch (err) {
      console.error("[grok-sub-proxy] error:", err)
      const message = String(err)
      return Response.json(
        isUsageReached(message)
          ? { error: { type: "usage_reached", message: usageReachedMessage(GROK_SUB) } }
          : { error: { message } },
        { status: 502 },
      )
    }
  },
})

console.log(`[grok-sub-proxy] listening on http://127.0.0.1:${server.port} -> ${UPSTREAM}`)
