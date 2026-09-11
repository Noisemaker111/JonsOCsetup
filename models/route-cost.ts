/**
 * What a turn on an exact route actually costs, read from the host's own request records.
 *
 * A published board says how well a model scores at an effort level. It says nothing about what
 * that effort spends. Both halves are needed to choose an effort, and only one of them existed:
 * on 2026-09-11 a 16m53s Quest Giver session spent 4m39s -- 28%, the single largest band -- inside
 * assistant reasoning, at one effort setting, whether the turn was planning a Quest or deciding to
 * call `quest get`. Ranking on the benchmark alone can only ever answer "pick the highest score",
 * which is how every dispatch ended up at the top of the effort curve.
 *
 * So this reads the other half from the same database `/context-graph` and `/duration-graph` read.
 * Every figure is a recorded per-request counter the provider billed, grouped by the exact route
 * identity the host recorded it under -- provider, model and the reasoning variant actually sent --
 * because effort is part of that identity and the counters differ enormously across it. Measured
 * over 14 days on this machine: `openai/gpt-6-astra#low` bills 6.2 reasoning tokens per turn and
 * `#medium` bills 68.9, an eleven-fold difference on the same weights.
 *
 * Two numbers are kept, and neither is a quality signal:
 *
 *  - `reasoningTokensPerTurn` is the discretionary band. It is the thing the effort setting
 *    controls, the thing that shows up as reasoning wall time, and the thing a routine turn should
 *    not be spending.
 *  - `cacheReadRate` is read/(read+uncached-sent). A route that never caches re-bills and
 *    re-processes the whole resident context every turn, so it is slower and dearer than its
 *    headline price. Measured the same night: `openai/gpt-6-astra` 59.8% against
 *    `opencode-go/omen-alpha` 2.9%.
 *
 * Nothing here is an estimate and nothing is invented. A route with no recorded turns has no cost,
 * which is different from being free -- `route-planner.ts` ranks unknown cost last, never first.
 */
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { hostDatabaseFile } from "../context-graph/context-graph"

export type RouteCost = {
  /** Where the counters came from, carried into the decision text. */
  source: string
  observedAt: string
  /** Assistant turns behind these averages. */
  turns: number
  reasoningTokensPerTurn: number
  outputTokensPerTurn: number
  /** Uncached prompt tokens plus cache reads, per turn. */
  sentTokensPerTurn: number
  /** read / (read + uncached sent). */
  cacheReadRate: number
}

/** Effort is part of route identity, so the key carries it. Unset variant is the provider default. */
export const routeCostKey = (providerID: string, modelID: string, reasoning: string) =>
  providerID + "/" + modelID + "#" + (!reasoning || reasoning === "unknown" ? "default" : reasoning)

export const routeCostCacheFile = () => process.env.OPENCODE_ROUTE_COST_CACHE
  ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "route-cost.json")

/**
 * Aggregation is one grouped query rather than a row scan: the table holds tens of thousands of
 * assistant messages and a dispatch cannot afford to parse all of them.
 */
function aggregate(file: string, since: number, minTurns: number): Record<string, RouteCost> {
  const db = new Database(file, { readonly: true })
  try {
    db.exec("PRAGMA busy_timeout=1000")
    const rows = db.query(
      `select json_extract(data,'$.model.providerID') provider,
              coalesce(json_extract(data,'$.model.modelID'), json_extract(data,'$.model.id')) model,
              json_extract(data,'$.model.variant') variant,
              count(*) turns,
              sum(coalesce(json_extract(data,'$.tokens.input'),0)) sent,
              sum(coalesce(json_extract(data,'$.tokens.output'),0)) output,
              sum(coalesce(json_extract(data,'$.tokens.reasoning'),0)) reasoning,
              sum(coalesce(json_extract(data,'$.tokens.cache.read'),0)) cacheRead
         from session_message
        where type='assistant' and time_created>=?
          and json_extract(data,'$.tokens.input') is not null
        group by 1,2,3`).all(since) as any[]
    const observedAt = new Date().toISOString()
    const costs: Record<string, RouteCost> = {}
    for (const row of rows) {
      // A fixture or a replayed session records a route identity with no billed prompt at all.
      // Averaging that would make the cheapest route in the pool one that never ran.
      if (!row.provider || !row.model || row.turns < minTurns || row.sent + row.cacheRead <= 0) continue
      costs[routeCostKey(String(row.provider), String(row.model), String(row.variant ?? "default"))] = {
        source: file, observedAt, turns: row.turns,
        reasoningTokensPerTurn: row.reasoning / row.turns,
        outputTokensPerTurn: row.output / row.turns,
        sentTokensPerTurn: (row.sent + row.cacheRead) / row.turns,
        cacheReadRate: row.cacheRead / (row.sent + row.cacheRead),
      }
    }
    return costs
  } finally { db.close() }
}

/**
 * Recorded cost per route identity.
 *
 * The aggregate takes seconds on a real database, so it is cached the way the models.dev catalog
 * is. A dispatch must never fail or stall because the cost evidence is unreadable: an unavailable
 * database yields no costs, and every candidate then ranks as it did before this evidence existed.
 */
export function recordedRouteCosts(options: {
  file?: string; cacheFile?: string; now?: number; maxAgeMs?: number; windowDays?: number; minTurns?: number; refresh?: boolean
} = {}): { costs: Record<string, RouteCost>; source: "fresh" | "cache" | "unavailable"; error?: string } {
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000
  const cacheFile = options.cacheFile ?? routeCostCacheFile()
  if (!options.refresh) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8"))
      const at = Date.parse(cached?.at ?? "")
      if (cached?.costs && Number.isFinite(at) && now - at >= 0 && now - at < maxAgeMs) return { costs: cached.costs, source: "cache" }
    } catch {}
  }
  const file = options.file ?? hostDatabaseFile()
  try {
    if (!existsSync(file)) throw new Error("no session database at " + file)
    const costs = aggregate(file, now - (options.windowDays ?? 14) * 86400000, options.minTurns ?? 10)
    try {
      mkdirSync(dirname(cacheFile), { recursive: true })
      writeFileSync(cacheFile, JSON.stringify({ at: new Date(now).toISOString(), costs }))
    } catch {}
    return { costs, source: "fresh" }
  } catch (error) {
    return { costs: {}, source: "unavailable", error: error instanceof Error ? error.message : String(error) }
  }
}

/** Attach recorded cost to the routes that have any. Routes with none keep an absent `cost`. */
export function withRecordedCosts<T extends { providerID: string; modelID: string; reasoning: string; cost?: RouteCost }>(
  routes: T[], costs: Record<string, RouteCost>,
): T[] {
  return routes.map(route => {
    const cost = costs[routeCostKey(route.providerID, route.modelID, route.reasoning)]
    return cost ? { ...route, cost } : route
  })
}
