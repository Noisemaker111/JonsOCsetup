/** Read-only CLIProxyAPI inventory and explicit, harmless model/tool probes. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir } from "node:os"
import { randomUUID } from "node:crypto"
import { parse } from "json5"
import { verifyOAuthProxy } from "../models/subscription-policy"

export function summarizeCompletion(body: any) {
  const choice = body?.choices?.[0]
  return {
    model: body?.model,
    finish: choice?.finish_reason,
    text: typeof choice?.message?.content === "string" ? choice.message.content : "",
    calls: Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [],
    error: body?.error?.message,
  }
}

export async function probeModel(baseURL: string, apiKey: string, model: string, toolRoundtrip: boolean) {
  const request = async (body: object) => {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, max_tokens: 2048, ...body }), signal: AbortSignal.timeout(45000),
    })
    return { status: response.status, ...summarizeCompletion(await response.json()) }
  }
  const marker = "ROUTE_OK"
  const messages: any[] = [{ role: "user", content: toolRoundtrip
    ? "Call route_probe with value ROUTE_OK exactly once, then repeat its result exactly."
    : "Reply exactly ROUTE_OK. Do not call tools." }]
  const tools = [{ type: "function", function: { name: "route_probe", description: "A harmless echo used to verify tool transport.", parameters: { type: "object", properties: { value: { type: "string", enum: [marker] } }, required: ["value"], additionalProperties: false } } }]
  const first = await request({ messages, ...(toolRoundtrip ? { tools, tool_choice: { type: "function", function: { name: "route_probe" } } } : {}) })
  const result: any = { requested: model, status: first.status, returned: first.model, finish: first.finish, ok: false }
  if (first.error) { result.error = first.error; return result }
  if (first.status !== 200 || first.model !== model) { result.error = "HTTP failure or returned model differs from requested model"; return result }
  if (!toolRoundtrip) { result.text = first.text; result.ok = first.text.trim() === marker; return result }
  const call = first.calls[0]
  if (first.calls.length !== 1 || call?.function?.name !== "route_probe" || JSON.parse(call.function.arguments)?.value !== marker) {
    result.error = "The forced tool call did not match the harmless probe"; return result
  }
  const toolResult = `TOOL_RESULT_${randomUUID()}`
  messages.push({ role: "assistant", content: null, tool_calls: first.calls }, { role: "tool", tool_call_id: call.id, content: toolResult })
  const second = await request({ messages, tools, tool_choice: "none" })
  return { ...result, toolCall: true, resultStatus: second.status, resultModel: second.model, finish: second.finish, text: second.text,
    ok: second.status === 200 && second.model === model && second.text.includes(toolResult), ...(second.error ? { error: second.error } : {}) }
}

async function main() {
  const root = resolve(import.meta.dir, "..")
  const config = parse(readFileSync(join(root, "opencode.jsonc"), "utf8"))
  const settings = config.providers.cliproxyapi.settings
  const verified = verifyOAuthProxy()
  if (new URL(settings.baseURL).origin !== verified.origin) throw new Error("Configured proxy does not match the verified OAuth broker")
  const args = process.argv.slice(2), selected: string[] = []
  let toolRoundtrip = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tools") toolRoundtrip = true
    else if (args[i] === "--probe" && args[i + 1] && !args[i + 1]!.startsWith("--")) selected.push(args[++i]!)
    else throw new Error("Usage: bun run runtime:providers [--probe exact-model-id ...] [--tools]")
  }
  if (toolRoundtrip && !selected.length) throw new Error("--tools requires an explicit --probe model")
  const report: any = { at: new Date().toISOString(), probes: [], caveat: "Catalog presence is not proof of access. Probes verify transport and returned model identity, not provider internals or billing." }
  const response = await fetch(`${settings.baseURL}/models`, { headers: { Authorization: `Bearer ${settings.apiKey}` }, signal: AbortSignal.timeout(10000) })
  report.catalogStatus = response.status
  if (!response.ok) throw new Error(`CLIProxyAPI model inventory returned HTTP ${response.status}`)
  const body = await response.json() as any
  if (!Array.isArray(body.data)) throw new Error("CLIProxyAPI returned an invalid model inventory")
  report.models = body.data.map((m: any) => ({ id: m.id, owner: m.owned_by })).sort((a: any, b: any) => a.id.localeCompare(b.id))
  report.configured = Object.keys(config.providers.cliproxyapi.models)
  report.advertisedButNotConfigured = report.models.map((m: any) => m.id).filter((id: string) => !report.configured.includes(id))
  report.configuredButNotAdvertised = report.configured.filter((id: string) => !report.models.some((m: any) => m.id === id))
  try {
    const cache = JSON.parse(readFileSync(join(homedir(), ".codex/models_cache.json"), "utf8"))
    report.codexAccountModels = cache.models.filter((m: any) => m.visibility === "list").map((m: any) => ({ id: m.slug, api: m.supported_in_api, reasoning: m.supported_reasoning_levels?.map((r: any) => r.effort) }))
  } catch { report.codexAccountModels = "cache unavailable" }
  for (const model of selected) {
    try { report.probes.push(await probeModel(settings.baseURL, settings.apiKey, model, toolRoundtrip)) }
    catch (error) { report.probes.push({ requested: model, ok: false, error: String(error) }) }
  }
  report.ok = report.probes.every((p: any) => p.ok)
  // Never persist connection settings or credential values, including error echoes.
  const safe = JSON.stringify(report, null, 2).replaceAll(settings.apiKey, "[redacted]")
  const directory = join(root, "run/runtime")
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "provider-audit.json"), safe + "\n")
  console.log(safe)
  process.exitCode = report.ok ? 0 : 1
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : "Provider audit failed"); process.exitCode = 1 })
