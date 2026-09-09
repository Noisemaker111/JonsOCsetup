import { expect, test } from "bun:test"
import { probeModel, summarizeCompletion } from "../scripts/provider-audit"
test("HTTP success with an empty answer remains empty, not a successful model reply", () => {
  expect(summarizeCompletion({ model: "named", choices: [{ finish_reason: "length", message: { content: "" } }] })).toMatchObject({ text: "", finish: "length" })
  expect(summarizeCompletion({ error: { message: "unknown provider" } })).toMatchObject({ text: "", error: "unknown provider" })
})

test("probe verifies a tool result unknown to the initial prompt and rejects model substitution", async () => {
  let substitute = false, requests = 0
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests++
    const body = await request.json() as any
    const toolResult = body.messages.find((m: any) => m.role === "tool")
    return Response.json({ model: substitute ? "different-model" : "named", choices: [{ finish_reason: toolResult ? "stop" : "tool_calls", message: toolResult
      ? { content: `Result: **${toolResult.content}**` }
      : { content: null, tool_calls: [{ id: "call_probe", type: "function", function: { name: "route_probe", arguments: JSON.stringify({ value: "ROUTE_OK" }) } }] } }] })
  } })
  try {
    const base = `http://127.0.0.1:${server.port}`
    expect(await probeModel(base, "test-only", "named", true)).toMatchObject({ ok: true, toolCall: true, resultModel: "named" })
    expect(requests).toBe(2)
    substitute = true
    expect(await probeModel(base, "test-only", "named", true)).toMatchObject({ ok: false, returned: "different-model" })
    expect(requests).toBe(3)
  } finally { server.stop(true) }
})
