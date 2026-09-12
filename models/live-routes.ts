/**
 * Candidate routes, derived at dispatch time instead of hand-typed into a policy file.
 *
 * `dispatch-policy.json` used to carry the entire list of models automatic selection would even
 * look at. On 2026-09-10 `opencode-go/deepseek-v4.1-flash` shipped and was invisible to every
 * local catalog until someone edited that JSON by hand -- which is the whole failure mode: the
 * router could not pick a model nobody had remembered to type.
 *
 * So the candidate set is now a join of things that are already true, none of which is a list of
 * names:
 *   - the live models.dev catalog says which models exist and which effort levels they accept,
 *   - `access-policy.json` says which provider/model identities the user permits at all,
 *   - the usage snapshot says which of those exactly one connected account can actually serve,
 *   - `dispatch-policy.json` billing says whose arrangement is known, and
 *   - `benchmarks.md` says which of them has a published score worth ranking.
 *
 * Every one of those is a veto. A model missing from any of them is not a candidate, so widening
 * the catalog never widens what the user authorized. The curated routes in the policy file are
 * still routes -- they win their identity over a derived twin -- they are just no longer the only
 * ones that exist.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { assertConfiguredModel, assertConfiguredSelection } from "./access-policy"
import { accountsForRoute } from "../usage/account-api"
import { slugModel } from "./model-catalog"
import { benchmarkFor, readBenchmarkTable, type BenchmarkEntry, type BenchmarkTable } from "./benchmark-table"
import type { AccountSnapshot } from "../usage/account-types"
import type { Route, RouteBenchmark } from "./route-planner"

export type CatalogModel = {
  providerID: string
  modelID: string
  /** Effort levels the provider actually accepts, in the order models.dev declares them. */
  efforts: string[]
  releaseDate?: string
}
export type LiveCatalog = { models: CatalogModel[]; source: "live" | "cache" | "stale-cache" | "unavailable"; at?: string; error?: string }

export const CATALOG_URL = "https://models.dev/api.json"
export const catalogCacheFile = () => process.env.OPENCODE_MODELS_DEV_CACHE
  ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "models-dev.json")

function parseCatalog(payload: unknown): CatalogModel[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {}
  const models: CatalogModel[] = []
  for (const [providerID, provider] of Object.entries(root)) {
    for (const [key, model] of Object.entries(provider?.models ?? {}) as [string, any][]) {
      const modelID = typeof model?.id === "string" && model.id ? model.id : key
      const effort = (model?.reasoning_options ?? []).find((option: any) => option?.type === "effort")
      const efforts = (effort?.values ?? []).filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value !== "null")
      models.push({ providerID, modelID, efforts, releaseDate: typeof model?.release_date === "string" ? model.release_date : undefined })
    }
  }
  return models
}

/**
 * A dispatch must not hang on models.dev, and being offline is not a reason to route somewhere the
 * user did not choose. Fresh cache is used as-is; a failed fetch falls back to whatever catalog we
 * last actually saw; with no catalog at all the derived set is empty and only curated routes run.
 */
export async function liveModelCatalog(now = Date.now(), maxAgeMs = 6 * 60 * 60 * 1000, timeoutMs = 8000): Promise<LiveCatalog> {
  const file = catalogCacheFile()
  let cached: { at?: string; models?: CatalogModel[] } | undefined
  try { cached = JSON.parse(readFileSync(file, "utf8")) } catch {}
  const cachedAt = Date.parse(cached?.at ?? "")
  if (cached?.models?.length && Number.isFinite(cachedAt) && now - cachedAt >= 0 && now - cachedAt < maxAgeMs) return { models: cached.models, source: "cache", at: cached.at }
  try {
    const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error("models.dev returned HTTP " + response.status)
    const models = parseCatalog(await response.json())
    if (!models.length) throw new Error("models.dev returned no models")
    const at = new Date(now).toISOString()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ at, models }))
    return { models, source: "live", at }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (cached?.models?.length) return { models: cached.models, source: "stale-cache", at: cached.at, error: reason }
    return { models: [], source: "unavailable", error: reason }
  }
}

/**
 * Which effort level may claim a published score.
 *
 * A per-effort board answers this directly: the model is offered at that effort and the score is
 * that effort's. A headline number with no stated effort is a best case, so it is attributed to
 * the highest effort the model declares and never to a cheaper one. A model that accepts no
 * effort setting runs at the provider's default, which nobody publishes, so a per-effort board
 * only justifies its *lowest* row for it.
 */
export function benchmarkedEfforts(entry: BenchmarkEntry, model: CatalogModel): { reasoning: string; benchmark: RouteBenchmark }[] {
  const prior = (effort: string, passAt1: number, attribution?: string): RouteBenchmark =>
    ({ suite: "", passAt1, effort, provenance: entry.provenance, source: entry.source, measuredAt: entry.measuredAt, ...(entry.intelligence !== undefined ? { intelligence: entry.intelligence } : {}), ...(attribution ? { attribution } : {}) })
  const unstated = entry.passAt1.unstated
  if (unstated !== undefined) {
    const highest = model.efforts[model.efforts.length - 1]
    return [{ reasoning: highest ?? "unknown", benchmark: prior(highest ?? "unknown", unstated, "The source published no effort level; attributed to the highest effort this model declares") }]
  }
  const scored = Object.entries(entry.passAt1)
  if (!model.efforts.length) {
    const [effort, passAt1] = scored.sort((a, b) => a[1] - b[1])[0]
    return [{ reasoning: "unknown", benchmark: prior(effort, passAt1, "This model accepts no effort setting, so only the lowest published effort (" + effort + ") is claimed") }]
  }
  return model.efforts.filter(effort => scored.some(([name]) => name === effort))
    .map(effort => ({ reasoning: effort, benchmark: prior(effort, entry.passAt1[effort]) }))
}

export type DerivationPolicy = { routes: Route[]; billing: Record<string, unknown> }

/** A curated route keeps its own identity; a derived twin of the same exact route is dropped. */
const identity = (route: { accountID: string; providerID: string; modelID: string; reasoning: string }) =>
  [route.accountID, route.providerID, route.modelID, route.reasoning].join("\0")

export function deriveBenchmarkRoutes(input: { catalog: CatalogModel[]; table: BenchmarkTable; snapshot: AccountSnapshot; policy: DerivationPolicy }) {
  const { catalog, table, snapshot, policy } = input
  const taken = new Set(policy.routes.map(identity))
  const routes: Route[] = []
  const diagnostics: string[] = []
  const note = (reason: string) => { if (!diagnostics.includes(reason)) diagnostics.push(reason) }
  for (const model of catalog) {
    const entry = benchmarkFor(table, model.modelID)
    if (!entry) continue
    try { assertConfiguredModel({ providerID: model.providerID, id: model.modelID }) } catch { continue }
    const accounts = accountsForRoute(snapshot, model.providerID, model.modelID)
    if (accounts.length !== 1) { note(model.providerID + "/" + model.modelID + ": " + (accounts.length ? "several connected accounts serve this identity" : "no connected account serves this identity")); continue }
    const accountID = accounts[0].id
    if (!policy.billing[accountID]) { note(model.providerID + "/" + model.modelID + ": billing arrangement for " + accountID + " is not configured"); continue }
    for (const { reasoning, benchmark } of benchmarkedEfforts(entry, model)) {
      try { assertConfiguredSelection({ ...model, reasoning }) } catch(error) { note(String(error)); continue }
      const route: Route = {
        id: "live-" + slugModel(model.providerID) + "-" + slugModel(model.modelID) + "-" + slugModel(reasoning),
        accountID, providerID: model.providerID, modelID: model.modelID,
        harness: "native", agent: "worker", reasoning, serviceTier: "default",
        verified: true, admission: "benchmark-ranked",
        benchmark: { ...benchmark, suite: table.suite },
        evidence: [], quotaPerTask: {},
      }
      if (taken.has(identity(route)) || routes.some(existing => existing.id === route.id)) continue
      taken.add(identity(route))
      routes.push(route)
    }
  }
  return { routes, diagnostics }
}

/**
 * Curated routes are ranked on the same published scores; they simply were not derived from them.
 *
 * A broker like `cliproxyapi` is not a models.dev provider, so the effort levels it accepts are
 * read off whichever provider does publish the same weights. Without that, an unstated-effort
 * score has no highest effort to attach to and a curated broker route silently loses its prior.
 */
export function withBenchmarkPriors(routes: Route[], table: BenchmarkTable, catalog: CatalogModel[]): Route[] {
  return routes.map(route => {
    if (route.benchmark) return route
    const entry = benchmarkFor(table, route.modelID)
    if (!entry) return route
    const want = slugModel(route.modelID)
    const model = catalog.find(m => m.providerID === route.providerID && m.modelID === route.modelID)
      ?? catalog.find(m => slugModel(m.modelID) === want && m.efforts.length)
      ?? { providerID: route.providerID, modelID: route.modelID, efforts: [] as string[] }
    const match = benchmarkedEfforts(entry, model).find(candidate => candidate.reasoning === route.reasoning)
    return match ? { ...route, benchmark: { ...match.benchmark, suite: table.suite } } : route
  })
}

/**
 * The whole join, as dispatch and preflight both need it: curated routes carrying their published
 * scores, plus every live candidate the access policy, accounts, billing and benchmarks all permit.
 */
export async function liveDispatchRoutes(policy: DerivationPolicy, snapshot: AccountSnapshot, now = Date.now()) {
  const table = readBenchmarkTable()
  const catalog = await liveModelCatalog(now)
  const derived = deriveBenchmarkRoutes({ catalog: catalog.models, table, snapshot, policy })
  return {
    curated: withBenchmarkPriors(policy.routes, table, catalog.models),
    derived: derived.routes,
    catalog,
    diagnostics: [catalog.source === "unavailable" ? "models.dev catalog unavailable (" + catalog.error + "); only curated routes are candidates"
      : catalog.source === "stale-cache" ? "models.dev fetch failed (" + catalog.error + "); using the cached catalog from " + catalog.at
      : "models.dev catalog " + catalog.source + " at " + catalog.at, ...derived.diagnostics],
  }
}
