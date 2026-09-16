/**
 * @core-prevents the Quest client abandoning a dispatch that is still being carried out
 * @core-observed September 16: every one of three dispatches returned {"code":"INVALID_INPUT","message":"fetch
 * failed"} while the run it asked for went on to execute. The journals give the reason: those runs bound their
 * sessions 584, 613 and 665 seconds after being planned, and the global fetch abandons a response whose headers
 * have not arrived in 300 seconds — measured here at 307,112 ms against a deliberately slow local server,
 * throwing TypeError: fetch failed with cause UND_ERR_HEADERS_TIMEOUT, which is the exact text the CLI printed.
 * node:http has no such deadline, so the client now waits for the answer it asked for.
 */
import { expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { createQuestClient } from "../quest/client.mjs"

async function service(handler: (path: string, body: string) => { status: number; payload: unknown }) {
  const seen: { authorization?: string; idempotency?: string; path?: string } = {}
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    seen.authorization = request.headers.authorization
    seen.idempotency = request.headers["idempotency-key"] as string
    seen.path = request.url
    const { status, payload } = handler(request.url ?? "", Buffer.concat(chunks).toString("utf8"))
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify(payload))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  return { seen, server, endpoint: { url: "http://127.0.0.1:" + port, token: "secret", instance: "one" } }
}

test("a request completes without the global fetch, which gives up after 300 seconds", async () => {
  const { server, endpoint, seen } = await service(() => ({ status: 200, payload: { runID: "run-1", state: "executing" } }))
  const fetched = globalThis.fetch
  // Nothing here may reach the deadline that abandoned three live dispatches.
  globalThis.fetch = (() => { throw new Error("the Quest client must not use the global fetch") }) as typeof fetch
  try {
    const result = await createQuestClient({ endpoint }).run({ id: "q", stepIDs: ["work"] })
    expect(result).toEqual({ runID: "run-1", state: "executing" })
    expect(seen.path).toBe("/api/run")
    expect(seen.authorization).toBe("Bearer secret")
    expect(seen.idempotency).toBeTruthy()
  } finally { globalThis.fetch = fetched; await new Promise<void>(resolve => server.close(() => resolve())) }
})

test("the service's own refusal still carries its code and message", async () => {
  const { server, endpoint } = await service(() => ({ status: 400, payload: { code: "STEP_NOT_ELIGIBLE", message: "The selected step is not ready" } }))
  try {
    const error = await createQuestClient({ endpoint }).run({ id: "q" }).catch((e: any) => e)
    expect(error.code).toBe("STEP_NOT_ELIGIBLE")
    expect(error.message).toBe("The selected step is not ready")
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test("the caller can still cancel a request it no longer wants", async () => {
  const { server, endpoint } = await service(() => ({ status: 200, payload: {} }))
  try {
    const error = await createQuestClient({ endpoint }).run({ id: "q" }, { signal: AbortSignal.abort() }).catch((e: any) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe("OUTCOME_UNKNOWN")
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
