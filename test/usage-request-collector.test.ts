import { expect, test } from "bun:test"
import { observedResponse, observePayload, installRequestTelemetry } from "../usage/request-collector"
import type { RequestRecord } from "../usage/telemetry"
const record = (): RequestRecord => ({ id: "request", sessionID: "session", kind: "chat", route: { providerID: "test", modelID: "model" }, startedAt: 100, state: "running", tokens: { input:null,output:null,reasoning:null,cacheRead:null,cacheWrite:null } })
test("stream observation preserves bytes and captures provider tokens without response text", async () => {
  const raw = 'data: {"choices":[{"delta":{"content":"private text"}}]}\n\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":40},"completion_tokens_details":{"reasoning_tokens":5}}}\n\ndata: [DONE]\n\n'
  const r = record(); let saved: RequestRecord | undefined
  const response = observedResponse(new Response(raw, { headers: { "content-type": "text/event-stream" } }), r, value => { saved = structuredClone(value) }, () => 200)
  expect(await response.text()).toBe(raw)
  expect(saved?.tokens).toEqual({ input:60, cacheRead:40, cacheWrite:0, output:15, reasoning:5 })
  expect(saved?.context?.tokens).toBe(100)
  expect(JSON.stringify(saved)).not.toContain("private text")
})
test("in-band failures remain failed even when the transport returned HTTP 200", async () => {
  const r = record()
  const response = observedResponse(new Response('data: {"type":"error","error":{"message":"failure"}}\n\n', { headers: { "content-type": "text/event-stream" } }), r, () => {})
  await response.text()
  expect(r.state).toBe("failed")
})
test("Anthropic partial usage keeps output total without guessing visible reasoning split", () => {
  const r = record()
  observePayload({ type:"message_start", message: { usage: { input_tokens:100, cache_read_input_tokens:200 } } }, r, 200)
  observePayload({ type:"message_delta", usage: { output_tokens:50 } }, r, 300)
  expect(r.tokens.input).toBe(100); expect(r.tokens.cacheRead).toBe(200)
  expect(r.outputTotal).toBe(50); expect(r.tokens.output).toBeNull(); expect(r.tokens.reasoning).toBeNull()
})
test("runtime request and response hooks retain request/session identity", async () => {
  const hooks: Record<string, Function> = {}, saved: RequestRecord[] = []
  await installRequestTelemetry({ session: { hook: (name: string, fn: Function) => { hooks[name]=fn }, get: async () => ({ id:"parent", parentID:"root" }) } }, r => saved.push(structuredClone(r)))
  const request = new Request("https://example.invalid")
  await hooks["http.request"]({ sessionID:"parent", request, model:{ providerID:"test", id:"model" }, kind:"compaction" })
  const event = { request, response: new Response('{"usage":{"prompt_tokens":100,"completion_tokens":10}}') }
  hooks["http.response"](event); await event.response.text()
  expect(saved).toHaveLength(2)
  expect(saved[0].id).toBe(saved[1].id)
  expect(saved[1]).toMatchObject({ sessionID:"parent", parentID:"root", kind:"compaction", state:"completed" })
})

test("host cancellation after the protocol terminator is a completed request", async () => {
  const r=record(), response=observedResponse(new Response('data: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}}),r,()=>{})
  const reader=response.body!.getReader(); await reader.read(); await reader.cancel()
  expect(r.state).toBe("completed")
})

test('usage survives SSE without a matching content type when the host cancels after its terminal frame',async()=>{
 const raw='data: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":40},"output_tokens_details":{"reasoning_tokens":5}}}}\n\n'
 const r=record(),upstream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(raw))}}),response=observedResponse(new Response(upstream,{headers:{'content-type':'application/octet-stream'}}),r,()=>{})
 const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toBe(raw);await reader.cancel()
 expect(r.state).toBe('completed');expect(r.tokens).toEqual({input:60,cacheRead:40,cacheWrite:0,output:15,reasoning:5})
})
test('a terminal usage payload already delivered without its trailing separator is retained on cancel',async()=>{
 const raw='data: {"type":"response.incomplete","response":{"usage":{"input_tokens":10,"output_tokens":4}}}\n'
 const r=record(),response=observedResponse(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(raw))}}),{headers:{'content-type':'text/event-stream'}}),r,()=>{})
 const reader=response.body!.getReader();await reader.read();await reader.cancel();expect(r.state).toBe('completed');expect(r.tokens.input).toBe(10);expect(r.tokens.output).toBe(4)
})
test('CR-only SSE and chunk-split CRLF preserve bytes and usage',async()=>{
 for(const chunks of [['data: {"usage":{"prompt_tokens":9,"completion_tokens":3}}\r\r','data: [DONE]\r\r'],['data: {"usage":{"prompt_tokens":9,"completion_tokens":3}}\r','\n\r','\ndata: [DONE]\r\n\r\n']]){
 const r=record(),response=observedResponse(new Response(new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(new TextEncoder().encode(chunk));c.close()}}),{headers:{'content-type':'Text/Event-Stream; charset=utf-8'}}),r,()=>{})
 expect(await response.text()).toBe(chunks.join(''));expect(r.tokens.input).toBe(9);expect(r.tokens.output).toBe(3)
 }
})
