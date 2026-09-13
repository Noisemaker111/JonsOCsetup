import {installWorkerInstructionReads} from './worker-instructions'
import {cleanupQuests} from "./cleanup"
import {connectHostObservation,disconnectHostObservation,recordHostObservation,registerHostObservation} from "./host-observation"
import {installWorkerCapabilities} from './worker-capabilities'
import {installUserGiverContext} from './user-giver'
import {guidanceTool,outcomeTool,workSupplyTool} from "./adaptive-tools"
import {installSharedWorkspaceGuard} from "./shared-guard"
/**
 * The quests server plugin: explicit durable work, tracked to completion.
 *
 * Quest state and verbs live in quest/ — this file is the wiring that attaches
 * them to the host, and it is the only plugin allowed to reach into quest/.
 *
 * It was previously spread across two other plugins: admission and the `quest`
 * tool lived in favorite-router, and the Task binding lived in orchestration.
 * Neither could ship without dragging quests along, and quests could not ship
 * at all. What it owns now:
 *  - binding: an explicitly identified Quest subagent session is attached to its Quest
 *  - gateway: native subagent/task schema is questID + cwd + task; role/runtime are derived
 *  - host events: the model that actually answered and the end of each worker turn
 *  - tools: the `quest` authority
 *  - the spawn ledger and completion watchdog (formerly the orchestration
 *    plugin): what was started, whether its result reached the giver, and a
 *    re-injection when the giver sat idle and never received it. Jk's model is
 *    "the Quest giver and the sessions on Quests"; there is no third actor.
 */
import { createQuestService } from "./service"
import { serveQuestAPI } from "./api-server"
import { questRoot } from "./root"
import { define } from "@opencode-ai/plugin/v2/promise"
import { QuestStore } from "./store"
import { QuestTracker } from "./tracker"
import { createQuestAgentAPI } from "./agent-api"
import { preparedDispatch, validatePreparedSubagent, QUEST_SUBAGENT_DESCRIPTION, QUEST_SUBAGENT_INPUT } from "./spawn"
import { recordSpawn, recordSpawnResult, registerCompletionEvidenceHandler, suppressCompletionDelivery } from "../orchestration/orchestration-ledger"
import { canonicalizeDispatch } from "../orchestration/dispatch"
import { watchSubagentCompletions } from "../orchestration/orchestration"

/** One fail-closed boundary: native subagent identity is canonical. */
export async function installCanonicalDispatch(ctx: { tool?: { hook?: Function } }) {
  const hook = ctx?.tool?.hook
  if (typeof hook !== "function") return
  await safeToolHook(hook, "execute.before", (event: unknown) => {
    if (isSpawn(event)) canonicalizeDispatch(event)
  }, true)
}

/** Record Quest dispatch intent before execution and its result afterwards. */
export async function installLedger(ctx: { tool?: { hook?: Function } }) {
  const hook = ctx?.tool?.hook
  if (typeof hook !== "function") return
  await safeToolHook(hook, "execute.before", (event: unknown) => {
    if (isSpawn(event)) recordSpawn((event ?? {}) as Record<string, unknown>)
  }, true)
  await safeToolHook(hook, "execute.after", (event: unknown, output?: unknown) => {
    const ev = (event ?? {}) as Record<string, unknown>
    if (isSpawn(event)) recordSpawnResult(ev, output ?? ev.output)
  })
}

/**
 * Re-inject a worker completion the giver never received.
 *
 * NOT awaited, and it must never become awaited: watchSubagentCompletions
 * ends in `for await (const event of stream)` over the host event stream, so
 * it only returns when the server is going down. Awaiting it means setup()
 * never resolves and the host hangs before it finishes booting.
 */
export function installWatchdog(ctx: unknown) {
  queueMicrotask(() => { void watchSubagentCompletions(ctx) })
}

/** Attach a hook without letting one bad registration disable the rest. */
async function safeToolHook(hook: Function, name: string, fn: Function, essential = false) {
  try {
    await hook(name, async (...args: unknown[]) => {
      try { return await fn(...args) } catch (error) {
        if (essential) throw error
        console.error(`[quests] ${name} hook error:`, error)
      }
    })
  } catch (error) {
    console.error(`[quests] could not register ${name}:`, error)
    if (essential) throw error
  }
}

const isSpawn = (event: unknown) => {
  const ev = (event ?? {}) as Record<string, unknown>
  return /^(task|subagent)$/i.test(String(ev.tool ?? ev.name ?? ""))
}

/**
 * Rewrite native subagent/task so callers pass only questID, cwd, and a short
 * task. The original execute still receives derived agent/prompt fields.
 */
export async function installSubagentGateway(ctx: { tool?: { transform?: Function } }) {
  const transform = ctx?.tool?.transform
  if (typeof transform !== "function") return
  await transform((draft: { get: (id: string) => any; update: (id: string, update: (tool: any) => void) => void }) => {
    for (const id of ["subagent", "task"]) {
      if (!draft.get(id)) continue
      draft.update(id, (tool: any) => {
        const original = tool.execute
        if (typeof original !== "function") return
        tool.description = QUEST_SUBAGENT_DESCRIPTION
        tool.input = QUEST_SUBAGENT_INPUT
        tool.execute = async (input: Record<string, unknown>, context: unknown) => original(validatePreparedSubagent(input ?? {}), context)
      })
    }
  })
}

/**
 * Bind a Quest-dispatched OpenCode session to the Quest it belongs to.
 *
 * This rides the same execute hooks the orchestration ledger uses — both care
 * about a model worker starting and finishing — but the two answer different
 * questions, so they live in different plugins.
 */
export async function installQuestBinding(
  ctx: { tool?: { hook?: Function } },
  quests = new QuestTracker(new QuestStore(questRoot())),
) {
  const hook = ctx?.tool?.hook
  if (typeof hook !== "function") return
  await safeToolHook(hook, "execute.before", (event: unknown) => {
    if (isSpawn(event)) quests.onTaskBefore(event)
  }, true)
  await safeToolHook(hook, "execute.after", (event: unknown, output?: unknown) => {
    if (isSpawn(event)) quests.onTaskAfter(event, output)
  })
}

const HOST_EVENTS = Symbol.for("opencode-config.quests.host-events")

/**
 * Subscribe to the host event stream once per server process. The stream is
 * consumed in the background and must never be awaited from setup(): it only
 * ends when the host shuts down. State lives on globalThis so a plugin reload
 * reuses the running subscription instead of stacking a second one.
 */
export function installQuestEvents(ctx: { event?: { subscribe?: Function }; session?: any; permission?: any }, quests: QuestTracker) {
  const state = globalThis as { [HOST_EVENTS]?: WeakMap<object, { controller: AbortController }> }
  const connections = state[HOST_EVENTS] ??= new WeakMap()
  const owner = ctx.session ?? ctx.event
  if (!owner) return
  if(ctx.session)registerHostObservation(ctx.session,ctx.permission)
  if (connections.has(owner)) return
  const subscribe = ctx?.event?.subscribe
  if (typeof subscribe !== "function") {
    console.warn("[quests] ctx.event.subscribe unavailable; worker models and turn ends come from the ledger only")
    return
  }
  const controller = new AbortController()
  connections.set(owner, { controller })
  const handle = (event: unknown) => { try { if(ctx.session)recordHostObservation(ctx.session,event);quests.onHostEvent(event);if(ctx.session&&/^session\.execution\.(succeeded|failed|interrupted)$/.test((event as any)?.type))void cleanupQuests(quests.store,ctx.session).catch(error=>console.error('[quests] cleanup',error)) } catch (error) { console.error("[quests] host event error:", error) } }
  queueMicrotask(async () => {
    let delay=1000
    while(!controller.signal.aborted){
      try {
        const stream=await subscribe({signal:controller.signal})
        if(!stream||typeof stream[Symbol.asyncIterator]!=="function")throw new Error("Unsupported host event stream shape")
        if(ctx.session)connectHostObservation(ctx.session,ctx.permission)
        for await(const event of stream){if(controller.signal.aborted)break;handle(event);delay=1000}
      }catch(error){if(!controller.signal.aborted)console.error("[quests] host event connection lost; reconnecting and polling persisted outcomes:",error)}
      if(ctx.session)disconnectHostObservation(ctx.session)
      if(controller.signal.aborted)break
      await new Promise<void>(done=>{const finish=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',finish);done()};const timer=setTimeout(finish,delay);timer.unref();controller.signal.addEventListener('abort',finish,{once:true})})
      delay=Math.min(delay*2,30000)
    }
    if(connections.get(owner)?.controller===controller)connections.delete(owner)
  })
}

export function installQuestCompletionEvidence(quests: QuestTracker, api = createQuestAgentAPI(questRoot())) {
  return registerCompletionEvidenceHandler((completion) => {
    const disposition = quests.onCompletion(completion)
    if (disposition === "parked" && suppressCompletionDelivery(completion)) quests.onCompletion(completion, true)
    const blockerSessionID = completion.openCodeSessionId ?? completion.runtimeSessionId
    if (blockerSessionID && (disposition === "recorded" || disposition === "duplicate")) void api.handoff({ sessionID: blockerSessionID, reason: "Blocking worker reached terminal handoff" }).catch((error) => console.error("[quests] automatic dependency handoff failed:", error))
  })
}

export async function installQuestTools(ctx: { tool?: { transform?: Function }; mcp?: {transform:Function}; session?: any;permission?:any;location?:{directory:string} }, api = createQuestAgentAPI(questRoot())) {
  const transform = ctx?.tool?.transform
  if (typeof transform !== "function") return
  let dispose: (()=>void)|undefined
  // A transform is replayed whenever the catalog changes. Runtime state and timers
  // belong to plugin setup, not to each replay of the description registration.
  if(!ctx.session||!ctx.location||!ctx.mcp)throw Error('Quest API requires the installed OpenCode session and MCP plugin interfaces')
  const service=createQuestService(api.store,ctx.session,{directory:ctx.location.directory,onDispose:fn=>{dispose=fn}})
  const endpoint=await serveQuestAPI(api.store,service,ctx.location.directory)
  const tools=[guidanceTool(api.store,ctx.session),outcomeTool(api.store,ctx.session),workSupplyTool(api.store,ctx.session)]
  try{
    await ctx.mcp.transform((draft:any)=>draft.set('quests',{type:'remote',url:endpoint.mcpURL,headers:{authorization:'Bearer '+endpoint.token},oauth:false,codemode:true}))
    await transform((draft: { add: (tool: unknown) => void }) => {for(const tool of tools)draft.add(tool)})
  }catch(error){endpoint.dispose();dispose?.();throw error}
  return ()=>{endpoint.dispose();dispose?.()}
}

export default define({
  id: "quests",
  async setup(ctx) {
    const quests = new QuestTracker(new QuestStore(questRoot()), ctx.session)
    const api = createQuestAgentAPI(questRoot(), ctx.session)
    let disposeTools: (()=>void)|undefined
    for (const [name, install] of [
      // Dispatch canonicalisation and the spawn ledger register their
      // execute.before hooks first: binding reads the worker identity they set.
      ["canonical-dispatch", () => installCanonicalDispatch(ctx)],
      ["ledger", () => installLedger(ctx)],
      ["subagent-gateway", () => installSubagentGateway(ctx)],
      ["binding", () => installQuestBinding(ctx, quests)],
      ["watchdog", () => installWatchdog(ctx)],
      ["host-events", () => installQuestEvents(ctx, quests)],
      ["completion-evidence", () => installQuestCompletionEvidence(quests, api)],
      ["worker-capabilities", () => installWorkerCapabilities(ctx,api.store)],
      ["user-giver", () => installUserGiverContext(api.store,ctx.session)],
      ["tools", async () => {disposeTools=await installQuestTools(ctx, api)}],
      ["shared-workspace-guard", () => installSharedWorkspaceGuard(ctx,api.store)],
      ["worker-instruction-reads", () => installWorkerInstructionReads(ctx,api.store)],
      ["shell-guidance", async () => (await import('./shell-guidance')).installShellGuidance(ctx)],
    ] as const) {
      try { await install() } catch (error) {
        console.error(`[quests] ${name} disabled:`, error)
      }
    }
    return ()=>disposeTools?.()
  },
})
