/**
 * @core-prevents a transport failure on a dispatch being reported as invalid input, inviting a duplicate run
 * @core-observed September 16: `quest run` returned {"code":"INVALID_INPUT","message":"fetch failed"} twice while
 * driving the board — on 2a9d8475 and on bd30ef67. Both times the run had already been created and bound, and
 * both went on to execute (c7826b3cd025, c1088467f686). The CLI labels any error without a code INVALID_INPUT,
 * so a connection that dropped after the request left the process read as "your input was wrong", which is an
 * invitation to dispatch the same step a second time. This drives a refused connection rather than a mid-request
 * drop, because that is deterministic; both are the same transport class, and neither says whether the service
 * applied the request.
 */
import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { createQuestClient } from "../quest/client.mjs"

/** A port that accepts nothing: the request leaves, and no answer comes back. */
async function deadEndpoint() {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return { url: "http://127.0.0.1:" + port, token: "unused", instance: "unused" }
}

test("a dispatch whose answer never arrives reports an unknown outcome, not invalid input", async () => {
  const client = createQuestClient({ endpoint: await deadEndpoint() })

  const error = await client.run("q", { stepIDs: ["work"] }).catch((e: any) => e)

  expect(error.code).toBe("OUTCOME_UNKNOWN")
  expect(error.code).not.toBe("INVALID_INPUT")
  // The caller has to be told the work may already be running before they send it again.
  expect(error.message).toContain("may already have been applied")
})

test("a read that never reached the service says plainly that nothing changed", async () => {
  const client = createQuestClient({ endpoint: await deadEndpoint() })

  const error = await client.list({}).catch((e: any) => e)

  expect(error.code).toBe("UNAVAILABLE")
  expect(error.message).toContain("nothing changed")
})

test("the service's own refusal still comes back as the service's code", async () => {
  const server = createServer((_req, res) => { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "INVALID_INPUT", message: "Unknown input field: nope" })) })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  try {
    const client = createQuestClient({ endpoint: { url: "http://127.0.0.1:" + port, token: "unused", instance: "unused" } })
    const error = await client.run("q", {}).catch((e: any) => e)
    expect(error.code).toBe("INVALID_INPUT")
    expect(error.message).toContain("Unknown input field")
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
