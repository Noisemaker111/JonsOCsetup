import { installAdaptiveContext } from "./context-plugin"
/**
 * The models plugin: routing, quota and the declared subagent roster.
 *
 * All policy lives in model-routing.ts, which touches no plugin host and can be
 * tested and shipped on its own. This file is only the wiring: it attaches the
 * policy to the host's hooks.
 *
 * What it owns:
 *  - rewriting Task spawns away from a capped or forbidden provider
 *  - refusing to change a live worker's pinned model
 *  - injecting the live cap / quota / usage lines into the orchestrator's turn
 *
 * What it must never own: the Claude Code harness intercept, the orchestration
 * ledger, task display labels, tool-output truncation, or the shell guard —
 * those belong to other plugins and were tangled with routing in
 * favorite-router.ts for far too long.
 */
import { installAccessGuard, assertConfiguredModel } from "./access-policy"
import { define } from "@opencode-ai/plugin/v2/promise"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  enforceSessionModelChange,
  drainFailoverNotices,
  forceUsageCollectOnCap,
  quotaLaneNotice,
  rememberFailoverNotice,
  systemPart,
  type UsageCacheLike,
} from "./model-routing"
import {
  USAGE_STALE_MS,
  kickUsageCollector,
  quotaSummaryLine,
  usageAgeMs,
  usageCache,
  capacitySnapshot,
  getAccountUsage,
  routeAccountCapacity,
} from "../usage/usage-lib"
import { detectProviderFailure, failureMessage } from "../usage/usage-reached"
import { discoverModelsText, isClaudeCodeModel } from "./model-catalog"

const CONFIG_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "opencode.jsonc")

/** Attach a tool hook without letting one bad registration disable the rest. */
async function safeToolHook(hook: Function, name: string, fn: Function, rethrow = false) {
  try {
    await hook(name, async (...args: unknown[]) => {
      try { return await fn(...args) } catch (error) {
        if (rethrow) throw error
        console.error(`[models] ${name} hook error:`, error)
      }
    })
  } catch (error) {
    console.error(`[models] could not register ${name}:`, error)
  }
}

/**
 * Rewrite capped or forbidden Task spawns before they start.
 *
 * The usage cache is re-read on every spawn on purpose: a snapshot captured at
 * setup can authorize a provider that a later probe has already seen capped.
 */
export async function installSpawnGuard(ctx: { tool?: { hook?: Function } }, _cache?: UsageCacheLike, _keys?: readonly string[]) {
  if(typeof ctx.tool?.hook!=="function")throw new Error("Host spawn guard is unavailable")
  await safeToolHook(ctx.tool.hook,"execute.before",(event:any)=>{
    if(!/^(task|subagent)$/i.test(String(event?.tool??event?.name??"")))return
    const input=event.input??event.args
    if(typeof input?.model!=="string")throw new Error("Use quest run to resolve an authorized route; implicit native fallback is disabled")
    const slash=input.model.indexOf("/");if(slash<1)throw new Error("Exact provider/model is required")
    assertConfiguredModel({providerID:input.model.slice(0,slash),modelID:input.model.slice(slash+1)})
  },true)
}

/** A live worker's model is immutable; a different model means a new session. */
export async function installSessionModelGuard(ctx: { tool?: { hook?: Function } }) {
  const hook = ctx?.tool?.hook
  if (typeof hook !== "function") return
  await safeToolHook(hook, "execute.before", (event: unknown) => enforceSessionModelChange(event), true)
}

/**
 * The one-liners the orchestrator needs on its next turn: a live cap, any
 * failover that just happened, and the current quota/usage summary. Pushed as
 * SystemPart objects — a raw string fails opencode2 schema validation.
 */
export function quotaLines(): string[] {
  const usage = usageCache()
  if (usageAgeMs(usage) >= USAGE_STALE_MS) kickUsageCollector()
  const notice = quotaLaneNotice(usage)
  return [
    ...(notice ? [notice] : []),
    ...drainFailoverNotices(),
    quotaSummaryLine(usage),
  ].filter((line) => typeof line === "string" && line.trim().length > 0)
}

function failureBlob(event: unknown, output?: unknown): string {
  try { return JSON.stringify([output, event]).slice(0, 4000) }
  catch { return String(output ?? event).slice(0, 4000) }
}

/** Live 429/402/quota errors become a next-turn quota line, not a silent fail. */
export async function installUsageFailureHook(ctx: { tool?: { hook?: Function } }) {
  const hook = ctx?.tool?.hook
  if (typeof hook !== "function") return
  await safeToolHook(hook, "execute.after", (event: unknown, output?: unknown) => {
    const failure = detectProviderFailure(failureBlob(event, output))
    if (!failure) return
    rememberFailoverNotice(failureMessage(failure))
    if (failure.kind === "usage" && failure.providerID === "opencode-go") forceUsageCollectOnCap(failure.detail)
    else kickUsageCollector()
  })
}

export async function installQuotaContext(ctx: { session?: { hook?: Function } }) {
  const hook = ctx?.session?.hook
  if (typeof hook !== "function") return
  await hook("context", (event: { system?: Array<{ type: "text"; text: string }> }) => {
    if (!Array.isArray(event.system)) return
    // Built here rather than passed through, so it is visible at the call site
    // that every push is a SystemPart object. A raw string fails opencode2
    // schema validation, and the smoke gate checks this line specifically.
    for (const line of quotaLines()) event.system.push(systemPart(line))
  })
}

export default define({
  id: "models",
  async setup(ctx) {
    await installAccessGuard(ctx)
    for (const [name, install] of [
      ["spawn-guard", () => installSpawnGuard(ctx)],
      ["session-model-guard", () => installSessionModelGuard(ctx)],
      ["quota-context", () => installQuotaContext(ctx)],
      ["adaptive-context", () => installAdaptiveContext(ctx)],
      ["usage-failure", () => installUsageFailureHook(ctx)],
    ] as const) {
      try { await install() } catch (error) {
        console.error(`[models] ${name} disabled:`, error)
      }
    }
  },
})
