import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { overlayProviderLane } from "./model-catalog"

export type Fav = { providerID: string; modelID: string }

export type CostLane = "go-quota" | "sub" | "free" | "metered"
export type ModelTier = "worker" | "utility" | "precise" | "codegen" | "heavy" | "escalate" | "explore"

export type ModelProfile = {
  id: string
  match: string[]
  name: string
  lane: CostLane
  tier: ModelTier
  best: string
  avoid: string
  notes?: string
  priceInput?: number
  priceOutput?: number
  context?: number
  output?: number
}

export type ModelData = {
  costInput?: number
  costOutput?: number
  context?: number
  output?: number
  tools?: boolean
  reasoning?: boolean
  structured?: boolean
  source: "models-dev" | "profile"
}
/* Task-aware model selection used to live here, as three hand-tuned keyword scorers:
 * `pickAvailableModel`, `applyPickedModel` and `pickModel` matched regexes against the task text
 * and then added or subtracted points by model name (`gpt-5.6-sol` +90 when the text looked like
 * planning, `gpt-5.6-luna-fast` +85 when it did not). Nothing called them, and nothing should
 * have: a table of names cannot see a model that shipped this morning and cannot say what an
 * effort level buys. That decision is now `models/route-planner.ts`, ranking live candidates on
 * a published per-effort board and recorded per-effort consumption, with the task class deciding
 * how much accuracy it may trade (`models/task-demand.ts`). What is left in this file is the
 * favorites catalog and profile presentation that `favorite-agents.ts` reads. */

type CacheEntry = {
  key: string
  id: string
  name?: string
  costInput?: number
  costOutput?: number
  context?: number
  output?: number
  tools?: boolean
  reasoning?: boolean
  structured?: boolean
}

type CacheFile = { updated: string; models: CacheEntry[] }

const HERE = dirname(fileURLToPath(import.meta.url))
const PROFILES_FILE = join(HERE, "model-profiles.json")
const CACHE_FILE = join(HERE, "models-cache.json")

const LANE_LABEL: Record<CostLane, string> = {
  "go-quota": "Go-quota",
  sub: "Sub",
  free: "Free",
  metered: "Metered",
}

export function modelKey(fav: Fav) {
  return `${fav.providerID}/${fav.modelID}`
}

export function agentName(fav: Fav) {
  return `model-${slug(fav.providerID)}-${slug(fav.modelID)}`
}

export function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function loadProfiles(): ModelProfile[] {
  if (!existsSync(PROFILES_FILE)) return []
  const parsed = JSON.parse(readFileSync(PROFILES_FILE, "utf8").replace(/^\uFEFF/, ""))
  if (!Array.isArray(parsed.profiles)) return []
  return parsed.profiles.filter(isProfile)
}

function isProfile(value: unknown): value is ModelProfile {
  if (typeof value !== "object" || value === null) return false
  const item = value as Partial<ModelProfile>
  return (
    typeof item.id === "string" &&
    Array.isArray(item.match) &&
    typeof item.name === "string" &&
    (item.lane === "go-quota" || item.lane === "sub" || item.lane === "free" || item.lane === "metered") &&
    typeof item.tier === "string" &&
    typeof item.best === "string" &&
    typeof item.avoid === "string"
  )
}

export function readModelCache(): CacheFile | undefined {
  if (!existsSync(CACHE_FILE)) return
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8").replace(/^\uFEFF/, ""))
    if (typeof parsed !== "object" || parsed === null) return
    if (!Array.isArray((parsed as CacheFile).models)) return
    return parsed as CacheFile
  } catch {
    return
  }
}

export function writeModelCache(entries: CacheEntry[]) {
  const file: CacheFile = { updated: new Date().toISOString(), models: entries }
  writeFileSync(CACHE_FILE, JSON.stringify(file, null, 2))
  return file
}

export function modelDataFor(fav: Fav, cache = readModelCache()): ModelData | undefined {
  if (!cache) return
  const key = modelKey(fav).toLowerCase()
  const model = slug(fav.modelID)
  const name = slug(fav.modelID)
  const hit = cache.models.find((entry) => {
    const entryKey = entry.key.toLowerCase()
    const entryId = slug(entry.id)
    const entryName = slug(entry.name ?? "")
    if (entryKey === key) return true
    if (entryId === model || entryName === name) return true
    return entryId.length >= 6 && (entryId.includes(model) || model.includes(entryId))
  })
  if (!hit) return
  const data: ModelData = {
    costInput: hit.costInput,
    costOutput: hit.costOutput,
    context: hit.context,
    output: hit.output,
    tools: hit.tools,
    reasoning: hit.reasoning,
    structured: hit.structured,
    source: "models-dev",
  }
  return data
}

export function inferProfile(fav: Fav, profiles = loadProfiles()): ModelProfile {
  const key = modelKey(fav).toLowerCase()
  const model = fav.modelID.toLowerCase()
  const overlay = overlayProviderLane(fav.providerID)
  const hit = profiles.find((profile) =>
    profile.match.some((needle) => {
      const n = needle.toLowerCase()
      return key.includes(n) || model.includes(n)
    }),
  ) ?? fallbackProfile(fav)
  if (!overlay || overlay === hit.lane) return hit
  if (overlay !== "metered") return { ...hit, lane: overlay }
  return {
    ...hit,
    lane: overlay,
    best: `Unavailable under subscription-only policy: ${hit.name} API route`,
    avoid: "default dispatch — metered pay-per-token; automatic pool must not pick this unless named",
  }
}

function fallbackProfile(fav: Fav): ModelProfile {
  const provider = fav.providerID.toLowerCase()
  const overlay = overlayProviderLane(fav.providerID)
  const lane: CostLane = overlay ?? (provider === "opencode-go" ? "go-quota" : provider === "opencode" ? "free" : "sub")
  return {
    id: `inferred-${fav.modelID}`,
    match: [fav.modelID],
    name: fav.modelID,
    lane,
    tier: "worker",
    best: "general coding",
    avoid: "unknown strengths — prefer a curated profile if one fits",
    notes: "No curated profile. Cost data still applies from the models.dev cache.",
  }
}

function ctxLabel(context: number | undefined) {
  if (!context) return "ctx ?"
  const m = context / 1_000_000
  if (m >= 1) return `${m % 1 === 0 ? m : m.toFixed(2)}M ctx`
  return `${Math.round(context / 1000)}k ctx`
}

function priceLabel(input: number | undefined, output: number | undefined) {
  if (typeof input !== "number" || typeof output !== "number") return "price n/a"
  return `$${input}/$${output} per 1M`
}

function capsLabel(data: ModelData | undefined) {
  if (!data) return ""
  const parts: string[] = []
  if (data.tools) parts.push("tools")
  if (data.reasoning) parts.push("reasoning")
  if (data.structured) parts.push("structured")
  return parts.length ? parts.join("+") : ""
}

function effectiveCost(fav: Fav, profile: ModelProfile, cache = readModelCache()) {
  const data = modelDataFor(fav, cache)
  return {
    input: data?.costInput ?? profile.priceInput,
    output: data?.costOutput ?? profile.priceOutput,
    context: data?.context ?? profile.context,
    outputLimit: data?.output ?? profile.output,
    data,
  }
}

export function agentDescription(fav: Fav, profiles = loadProfiles(), cache = readModelCache()) {
  const profile = inferProfile(fav, profiles)
  const cost = effectiveCost(fav, profile, cache)
  const caps = capsLabel(cost.data)
  const parts = [
    `${LANE_LABEL[profile.lane]}/${profile.tier}`,
    ctxLabel(cost.context),
    priceLabel(cost.input, cost.output),
    ...(caps ? [caps] : []),
    `BEST: ${profile.best}`,
    `AVOID: ${profile.avoid}`,
    `Spawn ${profile.name} (${modelKey(fav)}). If the user asks for N of this type, launch all N Task calls in one message.`,
  ]
  return parts.join(" · ")
}

function costRank(fav: Fav, profiles = loadProfiles(), cache = readModelCache()) {
  const profile = inferProfile(fav, profiles)
  const cost = effectiveCost(fav, profile, cache)
  return typeof cost.output === "number" ? cost.output : Number.POSITIVE_INFINITY
}

export function routingCard(favs: Fav[], profiles = loadProfiles(), cache = readModelCache()) {
  const lines = [
    "MODEL ROUTING — pick the cheapest favorite that can do the job.",
    "Prices below are real list $/1M from the models.dev-backed cache, sorted by output price.",
    "Go-quota, Sub, and Free lanes are cheap for you EVEN IF the list price looks big (Luna/Sol/Grok ride subs). Metered = pay-per-token and is disabled, including named requests.",
    'Flash/Pro/fast suffixes are NAMES, not speed or quality guarantees — trust the cost column and curated BEST/AVOID.',
    "A named model wins only through a verified subscription/free transport; otherwise report it unavailable. `general` is isolation, not a quality upgrade. `explore` is read-only search.",
    "",
  ]
  if (favs.length === 0) {
    lines.push("No favorited models synced.")
    return lines.join("\n")
  }
  const sorted = favs
    .map((fav) => ({ fav, rank: costRank(fav, profiles, cache) }))
    .toSorted((a, b) => a.rank - b.rank)
  for (const { fav } of sorted) {
    const profile = inferProfile(fav, profiles)
    const cost = effectiveCost(fav, profile, cache)
    const caps = capsLabel(cost.data)
    lines.push(
      [
        `- ${modelKey(fav)}`,
        `${LANE_LABEL[profile.lane]}/${profile.tier}`,
        ctxLabel(cost.context),
        priceLabel(cost.input, cost.output),
        ...(caps ? [caps] : []),
        `BEST: ${profile.best}`,
        `AVOID: ${profile.avoid}`,
      ].join(" · "),
    )
  }
  lines.push("")
  lines.push(
    "SELECTION: preserve an explicitly authorized exact model and effort. Otherwise rank permitted routes for this task using current benchmark methodology, measured task outcomes, available quota and observed cost/latency. There is no universal model default. Apply access-policy.json restrictions to givers, workers, reviews, retries and resumes; never substitute a banned or unsupported effort. Missing evidence stays unknown. Profile descriptions are curation, not comparative proof.",
  )
  lines.push(
    "Curation lives in model-profiles.json; costs come from models-cache.json (auto-refreshed from models.dev). Edit profiles, then `bun favorite-agents.ts sync`.",
  )
  return lines.join("\n")
}


const AGENTS_MARK_START = "<!-- model-routing:start -->"
const AGENTS_MARK_END = "<!-- model-routing:end -->"

export function upsertAgentsRouting(existing: string, card: string) {
  const block = [
    AGENTS_MARK_START,
    "",
    "### Model routing",
    "",
    card,
    "",
    "Load the `model-routing` skill when the choice is not obvious. Agent `description` fields repeat lane/tier/cost/BEST/AVOID so the Task tool can see them.",
    "",
    AGENTS_MARK_END,
  ].join("\n")
  if (existing.includes(AGENTS_MARK_START) && existing.includes(AGENTS_MARK_END)) {
    return existing.replace(
      new RegExp(`${escapeRegExp(AGENTS_MARK_START)}[\\s\\S]*?${escapeRegExp(AGENTS_MARK_END)}`),
      block,
    )
  }
  if (existing.includes("## Subagents")) {
    return existing.replace("## Subagents", `## Subagents\n\n${block}\n`)
  }
  return `${existing.trimEnd()}\n\n${block}\n`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function pullModelsDev(): Promise<CacheFile | undefined> {
  const response = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) return
  const json: unknown = await response.json()
  const entries = parseModelsDev(json)
  if (!entries) return
  return writeModelCache(entries)
}

function parseModelsDev(json: unknown): CacheEntry[] | undefined {
  const root = recordOf(json)
  if (!root) return
  const entries: CacheEntry[] = []
  for (const [providerKey, providerValue] of Object.entries(root)) {
    const provider = recordOf(providerValue)
    const models = recordOf(provider?.models)
    if (!models) continue
    for (const [modelKey, modelValue] of Object.entries(models)) {
      const entryValue = recordOf(modelValue)
      if (!entryValue) continue
      const cost = recordOf(entryValue.cost)
      const limit = recordOf(entryValue.limit)
      if (!cost && !limit) continue
      const id = typeof entryValue.id === "string" ? entryValue.id : modelKey
      entries.push({
        key: `${providerKey}/${id}`.toLowerCase(),
        id,
        name: typeof entryValue.name === "string" ? entryValue.name : undefined,
        costInput: typeof cost?.input === "number" ? cost.input : undefined,
        costOutput: typeof cost?.output === "number" ? cost.output : undefined,
        context: typeof limit?.context === "number" ? limit.context : undefined,
        output: typeof limit?.output === "number" ? limit.output : undefined,
        tools: entryValue.tool_call === true ? true : undefined,
        reasoning: entryValue.reasoning === true ? true : undefined,
        structured: entryValue.structured_output === true ? true : undefined,
      })
    }
  }
  return entries.length ? entries : undefined
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as Record<string, unknown>
}
