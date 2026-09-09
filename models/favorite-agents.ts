import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type Fav,
  modelKey,
  pullModelsDev,
  readModelCache,
} from "./model-router.ts"
import { isForbiddenXai, openRouterTwin } from "./model-catalog.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const STATE_FILES = [
  join(homedir(), ".local", "state", "opencode", "model.json"),
  join(homedir(), ".local", "share", "opencode", "state", "model.json"),
]
const AGENT_DIR = join(homedir(), ".opencode", "agent")
const PREFIX = "model-"
const REPO_ROOT = dirname(HERE)
const OPENCODE_JSONC = join(REPO_ROOT, "opencode.jsonc")

export function readFavorites(stateFiles = STATE_FILES): Fav[] {
  const file = stateFiles.find((path) => existsSync(path))
  if (!file) return []
  const parsed = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""))
  if (!Array.isArray(parsed.favorite)) return []
  return parsed.favorite.filter(
    (item: unknown): item is Fav =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Fav).providerID === "string" &&
      typeof (item as Fav).modelID === "string",
  )
}

function listAgentFiles(directory = AGENT_DIR): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).filter((file) => file.startsWith(PREFIX) && file.endsWith(".md"))
}

function findMatchingBrace(src: string, openIdx: number): number {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (c === "\\") {
        esc = true
        continue
      }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function parseAgentsObject(jsoncPath: string) {
  if (!existsSync(jsoncPath)) return
  const raw = readFileSync(jsoncPath, "utf8")
  const match = raw.match(/"agents"\s*:\s*\{/)
  if (!match || match.index == null) return
  const brace = raw.indexOf("{", match.index + match[0].length - 1)
  const end = findMatchingBrace(raw, brace)
  if (end < 0) throw new Error(`[favorite-agents] unbalanced agents brace in ${jsoncPath}`)
  const agents = JSON.parse(raw.slice(brace, end + 1)) as Record<string, Record<string, unknown>>
  return { raw, brace, end, agents }
}

/** Leftover model-* agents already in opencode.jsonc. Empty after fake-agent removal. */
export function readJsoncModelAgents(jsoncPath = OPENCODE_JSONC): Fav[] {
  const parsed = parseAgentsObject(jsoncPath)
  if (!parsed) return []
  const favs: Fav[] = []
  for (const [key, val] of Object.entries(parsed.agents)) {
    if (!key.startsWith(PREFIX)) continue
    const model = val?.model
    if (typeof model !== "string" || !model.includes("/")) continue
    const [providerID, ...rest] = model.split("/")
    favs.push({ providerID, modelID: rest.join("/") })
  }
  return favs
}

/** Same-model OpenRouter twins for already-favorited models. Never xai / x-ai. Does not write model-* jsonc agents. */
export function openRouterTwinFavorites(favs: Fav[], cache = readModelCache()): Fav[] {
  const keys = cache?.models.map((entry) => entry.key).filter((key): key is string => typeof key === "string") ?? []
  const out: Fav[] = []
  const seen = new Set<string>()
  for (const fav of favs) {
    if (fav.providerID.toLowerCase() !== "opencode-go") continue
    if (isForbiddenXai(modelKey(fav))) continue
    const twin = openRouterTwin(fav.modelID, keys)
    if (!twin || isForbiddenXai(`${twin.providerID}/${twin.modelID}`)) continue
    const key = `${twin.providerID}/${twin.modelID}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(twin)
  }
  return out
}

export function syncFavoriteAgents(refreshData = false, sources:{stateFiles?:string[];agentDirectory?:string;configFile?:string} = {}) {
  const favs = readFavorites(sources.stateFiles)
  if (refreshData) {
    pullModelsDev().catch((error) => console.error("[favorite-agents] models.dev refresh failed", error))
  }
  return { favs, legacyAgentFiles:listAgentFiles(sources.agentDirectory), legacyConfiguredModels:readJsoncModelAgents(sources.configFile) }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("favorite-agents.ts") === true

if (invokedDirectly) {
  const cmd = process.argv[2] ?? "sync"
  const cache = readModelCache()
  if (cmd === "off") {
    console.error("The destructive off command is retired. Existing agent files, configured agents and legacy records were preserved.")
    process.exitCode = 1
  } else if (cmd === "list") {
    const favs = readFavorites()
    console.log(`favorites (${favs.length}):`)
    for (const fav of favs) console.log(`  ${modelKey(fav)}`)
    console.log(`leftover model-* agent files (${listAgentFiles().length}):`)
    for (const file of listAgentFiles()) console.log(`  ${file}`)
    console.log(`data cache: ${cache ? `${cache.models.length} models, ${cache.updated}` : "missing"}`)
  } else if (cmd === "sync" || cmd === "on") {
    const { favs, legacyAgentFiles, legacyConfiguredModels } = syncFavoriteAgents(true)
    console.log(`synced ${favs.length} favorite model(s) as models, not agents`)
    if (legacyAgentFiles.length || legacyConfiguredModels.length) console.log(`preserved ${legacyAgentFiles.length} legacy agent files and ${legacyConfiguredModels.length} configured model agents`)
    console.log(`data cache: ${cache ? `${cache.models.length} models (${cache.updated})` : "refresh queued"}`)
    console.log("preserved hand-maintained skills and AGENTS.md; did not write model-* agents")
  } else {
    console.log("usage: bun models/favorite-agents.ts [sync|on|list]")
  }
}
