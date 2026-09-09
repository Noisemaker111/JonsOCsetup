import { questSessionContext } from "../quest/session-context"
import { createHash, randomUUID } from "node:crypto"
import { normalizeTokens, type RequestRecord, type Tokens } from "./telemetry"
import { accountRegime } from "./calibration-store"
import { recordRequest } from "./telemetry-store"
import { accountsForRoute, readAccountUsage } from "./account-api"
const empty = (): Tokens => ({ input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null })
/** Parses provider usage only; prompt and response text are never persisted. */
export function observePayload(payload: any, record: RequestRecord, now: number) {
  if (payload?.error || payload?.type === "error" || payload?.type === "response.failed") record.state = "failed"
  const usage = payload?.usage ?? payload?.response?.usage ?? payload?.message?.usage
  if (usage && typeof usage === "object") {
    if (typeof usage.prompt_tokens === "number" || typeof usage.input_tokens === "number" && (payload?.response || payload?.object === "response")) {
      record.tokens = normalizeTokens({ input: usage.prompt_tokens ?? usage.input_tokens, output: usage.completion_tokens ?? usage.output_tokens,
        cacheRead: usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0,
        cacheWrite: usage.prompt_tokens_details?.cache_write_tokens ?? usage.input_tokens_details?.cache_write_tokens ?? 0,
        reasoning: usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? 0 }, { inputIncludesCache: true, outputIncludesReasoning: true })
    } else if (typeof usage.input_tokens === "number" || typeof usage.output_tokens === "number") {
      // Anthropic reports base input separately from cache categories; thinking is included in output.
      record.tokens = { ...record.tokens, ...(typeof usage.input_tokens === "number" ? { input: usage.input_tokens, cacheRead: usage.cache_read_input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0 } : {}), ...(typeof usage.output_tokens === "number" ? { output: null, reasoning: null } : {}) }
      // Without a thinking-token breakdown, retain the total separately instead of inventing visible throughput.
      if (typeof usage.output_tokens === "number") record.outputTotal = usage.output_tokens
    }
  }
  const t = record.tokens
  if (t.input !== null && t.cacheRead !== null && t.cacheWrite !== null) record.context = { tokens: t.input + t.cacheRead + t.cacheWrite, source: "provider", at: record.startedAt }
  const visible = payload?.choices?.some((c: any) => typeof c.delta?.content === "string" && c.delta.content.length > 0)
    || payload?.type === "response.output_text.delta" && typeof payload.delta === "string" && payload.delta.length > 0
    || payload?.type === "content_block_delta" && payload.delta?.type === "text_delta" && typeof payload.delta.text === "string" && payload.delta.text.length > 0
  if (visible) { record.firstVisibleAt ??= now; record.lastOutputAt = now }
}
/** Observe the existing stream with backpressure; forward every byte unchanged. */
export function observedResponse(response: Response, record: RequestRecord, save: (r: RequestRecord) => void, clock = Date.now): Response {
  record.firstResponseAt = clock()
  const media=(response.headers.get("content-type")??"").split(";")[0].trim().toLowerCase()
  const capture=record.capture={mediaType:/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(media)&&media.length<=80?media:"unknown",framing:media==="text/event-stream"?"sse" as const:"json-or-unknown" as "sse"|"json-or-unknown",parsedPayloads:0,usagePayloads:0,parseFailures:0,truncatedBuffers:0}
  if (!response.body) { record.completedAt = clock(); record.state = response.ok ? "completed" : "failed"; save(record); return response }
  let streaming = media==="text/event-stream"
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = "", finished = false, terminalSeen = false, dataLines: string[] = []
  const parse = (text: string) => { try { const payload = JSON.parse(text);capture.parsedPayloads++;if(payload?.usage||payload?.response?.usage||payload?.message?.usage)capture.usagePayloads++;if (["message_stop", "response.completed","response.incomplete"].includes(payload?.type)) terminalSeen = true; observePayload(payload, record, clock()); if (payload?.type === "message_start" || payload?.type === "message_delta") save(record) } catch { capture.parseFailures++ } }
  const flushEvent = () => { if (!dataLines.length) return; const data=dataLines.join("\n"); dataLines=[]; if(data.trim()==="[DONE]")terminalSeen=true;else parse(data) }
  const line = (value:string) => {const text=value.replace(/\r$/,"");if(!text)flushEvent();else if(text.startsWith("data:"))dataLines.push(text.slice(5).replace(/^ /,""))}
  const lines=(final=false)=>{let newline:number;while((newline=buffer.search(/[\r\n]/))>=0){if(!final&&buffer[newline]==="\r"&&newline===buffer.length-1)break;const width=buffer[newline]==="\r"&&buffer[newline+1]==="\n"?2:1,next=buffer.slice(0,newline);buffer=buffer.slice(newline+width);line(next)}}
  const flush=()=>{buffer+=decoder.decode();if(streaming){lines(true);if(buffer)line(buffer);buffer="";flushEvent()}else if(buffer){parse(buffer);buffer=""}}
  const finish = (state: RequestRecord["state"]) => { if (finished) return; finished = true; record.completedAt = clock(); record.state = record.state === "failed" ? "failed" : state; save(record) }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {flush();finish(response.ok ? "completed" : "failed");controller.close();return}
        buffer += decoder.decode(chunk.value, { stream: true })
        // The host frames model streams as SSE independently of their response media type.
        if(!streaming&&/^\s*(?:data:|event:|:)/.test(buffer)){streaming=true;capture.framing="sse"}
        if(streaming)lines()
        if(buffer.length+dataLines.reduce((n,v)=>n+v.length,0)>8*1024*1024){buffer="";dataLines=[];capture.truncatedBuffers++}
        controller.enqueue(chunk.value)
      } catch (error) { finish("failed"); controller.error(error) }
    },
    async cancel(reason) {flush();finish(terminalSeen && response.ok ? "completed" : "interrupted");await reader.cancel(reason)},
  })
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
}
export async function installRequestTelemetry(ctx: any, save = recordRequest) {
  if (typeof ctx.session?.hook !== "function") return false
  const requests = new WeakMap<Request, RequestRecord>()
  const safeSave = (r: RequestRecord) => { try { r.recordedAt=Date.now();save(r) } catch (error) { console.error("[usage] telemetry persistence failed:", error instanceof Error ? error.message : "unknown error") } }
  await ctx.session.hook("http.request", async (event: any) => {
    const providerID = event.model?.providerID, modelID = event.model?.id ?? event.model?.modelID
    if (!event.request || !event.sessionID || !providerID || !modelID) return
    const accounts = accountsForRoute(readAccountUsage(), providerID, modelID)
    const record: RequestRecord = { id: randomUUID(), sessionID: event.sessionID, accountID: accounts.length === 1 ? accounts[0].id : undefined, accountRegime: accounts.length === 1 ? accountRegime(accounts[0]) : undefined,
      route: { providerID, modelID, variant: event.model?.variant }, kind: event.kind ?? "unknown", startedAt: Date.now(), state: "running", tokens: empty() }
    try {
      const body=await event.request.clone().json()
      const effort=body?.reasoning?.effort??body?.reasoning_effort
      if(typeof effort==="string")record.route.reasoning=effort
      if(typeof body?.service_tier==="string")record.route.serviceTier=body.service_tier
    } catch { /* Missing request route options remain unknown. No request body is retained. */ }
    try { const result = await ctx.session.get({ sessionID: event.sessionID }); const session = result?.data ?? result; record.parentID = session?.parentID; record.questID = session?.metadata?.questID } catch { /* Missing relationship stays unknown. */ }
    try { const worker = questSessionContext(event.sessionID); if (worker) {record.questID ??= worker.questID; record.parentID ??= worker.parentID; record.route.reasoning ??= worker.reasoning; record.route.harness ??= worker.harness} } catch { /* Missing canonical link remains unknown. */ }
    try {
      const result = await ctx.catalog?.model?.list()
      const models = result?.data ?? result
      const model = Array.isArray(models) ? models.find((m: any) => m.providerID === providerID && (m.id ?? m.modelID) === modelID) : undefined
      const prices = Array.isArray(model?.cost) ? model.cost : []
      const base = prices.find((p: any) => !p.tier)
      const rates = (p: any) => ({ input:p?.input, output:p?.output, reasoning:p?.output, cacheRead:p?.cache?.read, cacheWrite:p?.cache?.write })
      if (base) record.price = { version:createHash("sha256").update(JSON.stringify(prices)).digest("hex"), provider:providerID, model:modelID, date:new Date(record.startedAt).toISOString(), currency:"USD", perMillion:rates(base), tiers:prices.filter((p: any) => p.tier?.type === "context" && Number.isFinite(p.tier.size)).map((p: any) => ({ above:p.tier.size, perMillion:rates(p) })) }
    } catch { /* Missing catalog pricing remains unavailable. */ }
    requests.set(event.request, record); safeSave(record)
  })
  await ctx.session.hook("http.response", (event: any) => {
    const record = requests.get(event.request)
    if (record && event.response instanceof Response) event.response = observedResponse(event.response, record, safeSave)
  })
  return true
}
