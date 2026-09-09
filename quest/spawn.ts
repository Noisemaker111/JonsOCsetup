import { questRoot } from "./root"
import { compactQuestDispatch } from "./context"
import { QuestStore } from "./store"
import type { Quest } from "./types"
import { aliasModel, reasoningEffortFor, splitProviderModel, subagentChipLabel, WORKER_AGENTS } from "../orchestration/dispatch"

export { WORKER_AGENTS } from "../orchestration/dispatch"

export const QUEST_SUBAGENT_DESCRIPTION = [
  "Legacy internal Quest transport. Start new work with quest action=run and the Quest id.",
  "The Quest runtime prepares dispatch, applies configured routing and manages the worker workspace.",
  "Do not construct or copy dispatch envelopes yourself.",
].join(" ")

export const QUEST_SUBAGENT_INPUT = {
  type: "object" as const,
  properties: {
    agent: { type: "string", description: "Internal legacy runtime field. Use quest run for new work." },
    description: { type: "string", description: "Internal legacy display field. Use quest run for new work." },
    questID: { type: "string", description: "Canonical Quest ID. The worker prompt is derived from this Quest." },
    task: { type: "string", description: "Short task for the worker. Do not paste Quest fields." },
    cwd: { type: "string", description: "Working directory for the subagent (defaults to parent cwd)" },
    sessionID: { type: "string", description: "Existing Quest-bound session to continue" },
    model: { type: "string", description: "Optional: claude | sonnet | haiku | grok | codex, or provider/model. Omit for the default worker." },
  },
  required: ["questID", "task", "agent", "description"],
  additionalProperties: false,
}

export type NativeSubagentInput = {
  agent: string
  description: string
  prompt: string
  sessionID?: string
  background: true
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * The host subagent tool has no model field: a worker's model is its agent's
 * model. A model hint therefore selects the hidden agent pinned to it, and an
 * unpinned provider/model is rejected without substituting a different model.
 */
export function agentForModel(model: unknown): string {
  const raw = text(model)
  if (!raw) return "build"
  const selected = splitProviderModel(raw) ?? aliasModel(raw)
  if (!selected) throw new Error(`Quest dispatch model must be claude, sonnet, haiku, grok, codex, or provider/model (got ${raw})`)
  const agent = WORKER_AGENTS[`${selected.providerID}/${selected.modelID}`]
  if (!agent) throw new Error(`No pinned worker agent for ${raw}; refusing to substitute the default model`)
  return agent
}

/**
 * The dispatched worker's target `cwd` is where it edits code, not where the
 * Quest ledger lives — reading it from there was the per-cwd guessing bug.
 * Every dispatch resolves the one canonical ledger regardless of cwd.
 */
export function readCanonicalQuest(questID: string): Quest {
  const quest = new QuestStore(questRoot()).read(questID)
  if (quest) return quest
  throw new Error(`Quest dispatch references unknown Quest ${questID}`)
}

/** Every dispatched unit is an implementer. The Quest giver is the only coordinator. */
export function derivedSpawnAgent(quest: Quest, input: Record<string, unknown>): string {
  const continuationID = text(input.sessionID)
  if (continuationID) {
    const target = quest.sessions.find((session) => session.sessionID === continuationID || session.openCodeSessionId === continuationID)
    if (!target) throw new Error(`Quest dispatch session ${continuationID} is not bound to Quest ${quest.id}`)
  }
  return agentForModel(input.model)
}

/** Rewrite caller fields into native subagent input. Canonical Quest supplies prompt context. */
export function toNativeSubagentInput(input: Record<string, unknown>, quest: Quest): NativeSubagentInput {
  const task = text(input.task) || text(input.prompt) || text(input.description)
  if (!task) throw new Error("Quest dispatch requires task")
  const sessionID = text(input.sessionID) || undefined
  return {
    agent: derivedSpawnAgent(quest, input),
    // This value must also exist in the ORIGINAL input before host persistence.
    description: dispatchChipLabel(quest, input),
    prompt: compactQuestDispatch(quest, task),
    sessionID,
    background: true,
  }
}

/**
 * The live line for a dispatch that has no ledger session yet: quest title
 * plus the model/reasoning/fast resolved from the same model hint the hidden
 * agent is derived from (lane default when the hint names no variant; unknown
 * parts omitted when it names no model at all).
 */
export function dispatchChipLabel(quest: Quest, input: Record<string, unknown>): string {
  const selected = splitProviderModel(text(input.model) || "opencode/muse-spark-1.3-contributor-free") ?? aliasModel(input.model)
  if (!selected) return subagentChipLabel(quest, {})
  const reasoning = reasoningEffortFor(selected.providerID, selected.modelID, input.variant)
  return subagentChipLabel(quest, {
    providerID: selected.providerID,
    modelID: selected.modelID,
    reasoningEffort: reasoning.reasoningEffort,
    fast: reasoning.fast,
  })
}

export function prepareNativeSubagent(input: Record<string, unknown>): NativeSubagentInput {
  const questID = text(input.questID)
  if (!questID) throw new Error("Quest dispatch requires questID")
  return toNativeSubagentInput(input, readCanonicalQuest(questID))
}

/** Prepared original input is what the host persists and displays in its chip. */
export function preparedDispatch(input: Record<string, unknown>, quest: Quest) {
  const native = toNativeSubagentInput(input, quest)
  return { questID: quest.id, task: text(input.task), ...(text(input.cwd) ? { cwd: text(input.cwd) } : {}), ...(text(input.model) ? { model: text(input.model) } : {}), ...(text(input.sessionID) ? { sessionID: text(input.sessionID) } : {}), agent: native.agent, description: native.description }
}
export function validatePreparedSubagent(input: Record<string, unknown>, quest = readCanonicalQuest(text(input.questID))): NativeSubagentInput {
  const native = toNativeSubagentInput(input, quest)
  if (input.agent !== native.agent || input.description !== native.description) throw new Error("Dispatch fields are missing or stale. Use quest action=run with the Quest id; the runtime prepares dispatch and isolates the worker.")
  return native
}
