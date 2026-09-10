import { installAdaptiveContext } from "./context-plugin"
/** Access policy, pinned worker identity and observed provider failures.
 * Account-aware dispatch lives in dispatch-planner.ts; this plugin never substitutes models.
 */
import { installAccessGuard, assertConfiguredModel } from "./access-policy"
import { define } from "@opencode-ai/plugin/v2/promise"
import { enforceSessionModelChange } from "./session-lifecycle"


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

/** Require the explicit authorized identity resolved by Quest dispatch. */
export async function installSpawnGuard(ctx: { tool?: { hook?: Function } }) {
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

/** Observe actual model HTTP failures, scoped to the session that made the request. */
export async function installProviderFailureObservation(ctx:any) {
 const notices=new Map<string,string>()
 await ctx.session.hook('http.response',(event:any)=>{
  const status=event.response.status
  if(status<400){notices.delete(event.sessionID);return}
  const target=event.model.providerID+'/'+event.model.id
  const kind=status===429?'rate limited':status===401?'authentication failed':status===403?'access denied':status===402?'payment or credit requirement':'request failed'
  notices.set(event.sessionID,'Observed provider request: '+target+' — '+kind+' (HTTP '+status+'). This response alone does not establish subscription exhaustion or authorize a fallback. Inspect the actual error and retry guidance before recovery.')
 })
 await ctx.session.hook('context',(event:any)=>{const note=notices.get(event.sessionID);if(note&&Array.isArray(event.system)){event.system.push({type:'text',text:note});notices.delete(event.sessionID)}})
}

export default define({
  id: "models",
  async setup(ctx) {
    await installAccessGuard(ctx)
    for (const [name, install] of [
      ["spawn-guard", () => installSpawnGuard(ctx)],
      ["session-model-guard", () => installSessionModelGuard(ctx)],
      ["provider-failures", () => installProviderFailureObservation(ctx)],
      ["adaptive-context", () => installAdaptiveContext(ctx)],
    ] as const) {
      try { await install() } catch (error) {
        console.error(`[models] ${name} disabled:`, error)
      }
    }
  },
})
