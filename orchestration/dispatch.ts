/** Hidden worker agents in opencode.jsonc, each pinned to one provider/model. */
export const WORKER_AGENTS: Record<string, string> = {
  "cliproxyapi/claude-opus-5": "proxy-claude",
  "cliproxyapi/claude-sonnet-5": "proxy-sonnet",
  "cliproxyapi/claude-haiku-4-5-20251001": "proxy-haiku",
  "cliproxyapi/gpt-5.6-sol": "proxy-sol",
  "cliproxyapi/gpt-5.6-luna": "proxy-luna",
  "cliproxyapi/gpt-5.6-terra": "proxy-terra",
  "cliproxyapi/claude-fable-5-1": "proxy-fable",
  "opencode/muse-spark-1.3-contributor-free": "build",
  "openai/gpt-5.6-luna-fast": "luna",
  "claude-code/opus": "claude",
  "claude-code/claude": "claude",
  "claude-code/sonnet": "claude-sonnet",
  "claude-code/haiku": "claude-haiku",
  "cliproxyapi/grok-4.6": "grok",
  "openai/gpt-6-astra": "astra",
  // Separate pin preserves the explicit provider identity.
  "cliproxyapi/gpt-6-astra": "astra-proxy",
  "codex/default": "codex",
}

export type WorkerRuntime = "native" | "claude-code"

/** Matches opencode.jsonc variant ids (`{effort}` or `{effort}-fast`), e.g. "high", "xhigh-fast". */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max"

/** Internal lineage only. The public identity is always provider/model - task. */
export type WorkerIdentity = {
  agentRole: "worker" | "orchestrator"
  providerID: string
  modelID: string
  runtime: WorkerRuntime
  openCodeSessionId?: string
  runtimeSessionId?: string
  parentID: string
  runID: string
  task: string
  /** The reasoning/thinking level actually sent. Face disclosure requires this next to the model everywhere a worker is shown. */
  reasoningEffort?: ReasoningEffort
  /** True only for a fast variant (variant hint or a `-fast` model id). Never true for a plain/default variant. */
  fast?: boolean
}

const CLAUDE_MODELS = new Set(["claude", "default", "opus", "sonnet", "haiku"])
const FORBIDDEN_CALLER_FIELDS = ["agent", "agentRole", "role", "runtime", "subagent", "subagent_type"] as const

const VARIANT_HINT = /^(none|low|medium|high|xhigh|max)(-fast)?$/i

/**
 * Lane default when the dispatch carries no explicit `variant` hint. Mirrors
 * opencode.jsonc's base `settings.reasoningEffort` per model — that config is
 * the actual API-bound setting; this is a labeling mirror of it for lineage,
 * not a second source of truth the runtime reads from.
 */
const LANE_REASONING_DEFAULT: Record<string, ReasoningEffort> = {
  "opencode/muse-spark-1.3-contributor-free": "medium",
  "openai/gpt-5.6-luna-fast": "max",
  "openai/gpt-6-astra": "high",
  "cliproxyapi/gpt-6-astra": "high",
  "cliproxyapi/gpt-5.6-sol": "xhigh",
  "cliproxyapi/claude-fable-5-1": "high",
}

/** Explicit variant hint (as set on `input.variant`, e.g. by the model picker) beats the lane default. */
export function parseVariantHint(variant: unknown): { reasoningEffort?: ReasoningEffort; fast?: boolean } {
  const match = text(variant).toLowerCase().match(VARIANT_HINT)
  if (!match) return {}
  return { reasoningEffort: match[1] as ReasoningEffort, fast: !!match[2] }
}

/** A `-fast` model id (e.g. gpt-5.6-luna-fast) is itself a fast variant even with no separate variant hint. */
export function reasoningEffortFor(providerID: string, modelID: string, variant: unknown): { reasoningEffort?: ReasoningEffort; fast: boolean } {
  const hint = parseVariantHint(variant)
  const fast = hint.fast || /-fast$/i.test(modelID)
  if (hint.reasoningEffort) return { reasoningEffort: hint.reasoningEffort, fast }
  return { reasoningEffort: LANE_REASONING_DEFAULT[`${providerID}/${modelID}`.toLowerCase()], fast }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function splitProviderModel(value: string): { providerID: string; modelID: string } | undefined {
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return
  const providerID = value.slice(0, slash).trim()
  const modelID = value.slice(slash + 1).trim()
  if (!providerID || !modelID || /\s/.test(providerID)) return
  return { providerID, modelID }
}

export function taskDescription(input: Record<string, unknown>): string {
  return text(input.task) || text(input.prompt) || text(input.description)
}

export function canonicalWorkerTitle(identity: Pick<WorkerIdentity, "providerID" | "modelID" | "task">): string {
  return `${identity.providerID}/${identity.modelID} - ${identity.task}`
}

/** The face a worker shows: provider/model, reasoning level, fast only when true. */
export type ChipFaceSession = {
  providerID?: string
  modelID?: string
  model?: string
  reasoningEffort?: ReasoningEffort
  fast?: boolean
}

/**
 * The exact, bare chip beside a worker: quest title, model, reasoning level,
 * and "fast" only when true — nothing else. Unknown parts are omitted, never
 * placeholder text ("model pending" never renders on a face). This is the one
 * live line every dispatch surface carries: the host's own background-subagent
 * chip reads ORIGINAL input.description; execute-time mutation is too late.
 * Quest prepare-dispatch supplies that input before host persistence. Single
 * source: the board chip, the native dispatch description, and the harness
 * session titles all build from here.
 */
export function subagentChipLabel(quest: { title: string }, session: ChipFaceSession): string {
  const model = session.providerID && session.modelID ? `${session.providerID}/${session.modelID}` : session.model
  const parts = [quest.title, model, session.reasoningEffort].filter(Boolean) as string[]
  if (session.fast) parts.push("fast")
  return `(${parts.join(", ")})`
}

export function bindWorkerSessions(identity: WorkerIdentity, sessions: { openCodeSessionId?: string; runtimeSessionId?: string }): WorkerIdentity {
  return { ...identity, openCodeSessionId: sessions.openCodeSessionId ?? identity.openCodeSessionId, runtimeSessionId: sessions.runtimeSessionId ?? identity.runtimeSessionId }
}

export function claudeModelAlias(model: unknown): string | undefined {
  const raw = text(model)
  if (!raw || raw === "claude-code") return "claude"
  const parsed = splitProviderModel(raw)
  const alias = parsed ? parsed.modelID : raw
  if (parsed && parsed.providerID !== "claude-code") return
  return CLAUDE_MODELS.has(alias) ? alias : undefined
}

/** Short model names use the subscription broker. Explicit claude-code keeps its distinct legacy identity. */
export const MODEL_ALIASES: Record<string, { providerID: string; modelID: string }> = {
  claude: { providerID: "cliproxyapi", modelID: "claude-opus-5" },
  "claude-code": { providerID: "claude-code", modelID: "opus" },
  opus: { providerID: "cliproxyapi", modelID: "claude-opus-5" },
  sonnet: { providerID: "cliproxyapi", modelID: "claude-sonnet-5" },
  haiku: { providerID: "cliproxyapi", modelID: "claude-haiku-4-5-20251001" },
  grok: { providerID: "cliproxyapi", modelID: "grok-4.6" },
  astra: { providerID: "openai", modelID: "gpt-6-astra" },
  codex: { providerID: "cliproxyapi", modelID: "gpt-5.6-sol" },
}

export function aliasModel(value: unknown): { providerID: string; modelID: string } | undefined {
  const raw = text(value).toLowerCase()
  return raw ? MODEL_ALIASES[raw] : undefined
}

function normalizeMuseModel(value: unknown): { providerID: string; modelID: string } | undefined {
  const raw = text(value)
  if (!raw) return
  if (/muse/i.test(raw)) return { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" }
}

const DISPATCH_TOOLS = /^(task|subagent)$/i

/**
 * Fail-closed dispatch boundary. Approved Quest work enters through the native
 * subagent/task tool with only questID, cwd, and a short task. Role and runtime
 * are derived; callers may not select them.
 */
export function canonicalizeDispatch(event: unknown): WorkerIdentity | undefined {
  const ev = (event ?? {}) as Record<string, unknown>
  const tool = text(ev.tool ?? ev.name)
  if (!DISPATCH_TOOLS.test(tool)) return

  const input = (ev.input ?? ev.args) as Record<string, unknown> | undefined
  if (!input || typeof input !== "object") throw new Error("Quest dispatch requires an input object")
  const requested = splitProviderModel(text(input.model)) ?? aliasModel(input.model) ?? (!text(input.model) ? { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" } : undefined)
  const preparedAgent = requested && typeof input.description === "string" && input.agent === WORKER_AGENTS[`${requested.providerID}/${requested.modelID}`]
  const forbidden = FORBIDDEN_CALLER_FIELDS.find((field) => field in input && !(field === "agent" && preparedAgent))
  if (forbidden) throw new Error(`Quest dispatch derives hidden role/runtime; caller field ${forbidden} is forbidden`)

  const task = taskDescription(input)
  if (!task) throw new Error("Quest dispatch requires task")
  if (!text(input.questID)) throw new Error("Quest dispatch requires questID")
  const selected = splitProviderModel(text(input.model)) ?? aliasModel(input.model) ?? normalizeMuseModel(input.model) ?? (!text(input.model) ? { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" } : undefined)
  if (text(input.model) && !selected) throw new Error("Quest dispatch model must be an explicit provider/model")
  if (selected?.providerID === "claude-code" && !claudeModelAlias(`${selected.providerID}/${selected.modelID}`)) {
    throw new Error("claude-code only accepts claude-code/{claude|default|opus|sonnet|haiku}")
  }

  const parentID = text(ev.sessionID ?? ev.parentSessionID)
  const runID = text(ev.callID ?? ev.id ?? ev.messageID)
  if (!parentID || !runID) throw new Error("Quest dispatch requires parent session and run IDs")
  const reasoning = selected ? reasoningEffortFor(selected.providerID, selected.modelID, input.variant) : { reasoningEffort: undefined, fast: false }
  const identity: WorkerIdentity = {
    agentRole: "worker",
    providerID: selected?.providerID ?? "",
    modelID: selected?.modelID ?? "",
    // A native subagent stays native even on the claude-code provider: the CLI sits behind the bridge, the session is OpenCode's.
    runtime: "native",
    parentID,
    runID,
    task,
    reasoningEffort: reasoning.reasoningEffort,
    fast: reasoning.fast,
  }
  if (selected) input.model = `${selected.providerID}/${selected.modelID}`
  ev.workerIdentity = identity
  const metadata = ev.metadata && typeof ev.metadata === "object" ? ev.metadata as Record<string, unknown> : {}
  const title = identity.providerID && identity.modelID ? canonicalWorkerTitle(identity) : identity.task
  ev.metadata = { ...metadata, worker: { ...identity, title } }
  return identity
}

export function workerIdentityFromEvent(event: unknown): WorkerIdentity | undefined {
  const value = (event as { workerIdentity?: unknown } | undefined)?.workerIdentity
  return value && typeof value === "object" ? value as WorkerIdentity : undefined
}

/**
 * Workers are evidence on the Quest board first — but a native worker (even
 * one on the claude-code model) rides a real OpenCode session on the
 * in-process harness bridge, so clicking its id can jump straight to that
 * session's transcript. `row` is the live `session.get` result: it must
 * confirm the id actually resolves (and share the same parent) before we
 * hand back a route. An external harness session (runtime "claude-code",
 * started outside the bridge) has no OpenCode session to route to — this
 * returns undefined and callers fall back to showing details instead.
 */
export function nativeSessionNavigation(identity: WorkerIdentity, row: { id?: string; parentID?: string }): { type: "session"; sessionID: string } | undefined {
  if (identity.runtime !== "native") return
  const sessionID = identity.openCodeSessionId
  if (!sessionID || row.id !== sessionID) return
  if (row.parentID && row.parentID !== identity.parentID) return
  return { type: "session", sessionID }
}
