import { valueRequest, readRequests, requestTiming, type Tokens, type Price } from "../usage/telemetry-api"
import type { Route } from "./route-planner"
import type { LiveCatalog } from "./live-routes"

export type EconomyPolicy = {
  /** Opt in to provider catalog equivalents when no personal account price is configured. */
  useCatalogPrices?: boolean
  comparisonTokens: Tokens
  maxPriceAgeDays: number
  minSpeedSamples: number
  /** Exact account + provider/model + service tier. A personal contract overrides the catalog. */
  accountPrices?: Record<string, Price>
}
export const accountPriceKey = (r: Route) => [r.accountID, r.providerID, r.modelID, r.serviceTier].join("|")
const exactRequestKey = (r: Route) => [accountPriceKey(r), r.reasoning].join("|")

/** Prices value a common workload; recorded request durations remain observations, not forecasts. */
export function withRouteEconomics(routes: Route[], catalog: LiveCatalog, policy: EconomyPolicy | undefined, now: number): Route[] {
  if (!policy) return routes
  if (!Number.isFinite(policy.maxPriceAgeDays) || policy.maxPriceAgeDays <= 0 || !Number.isInteger(policy.minSpeedSamples) || policy.minSpeedSamples < 1 ||
      !policy.comparisonTokens || ["input", "cacheRead", "cacheWrite", "output", "reasoning"].some(k => typeof policy.comparisonTokens[k as keyof Tokens] !== "number" || !Number.isFinite(policy.comparisonTokens[k as keyof Tokens]) || policy.comparisonTokens[k as keyof Tokens]! < 0)) throw Error("Invalid economical routing comparison policy")
  const fresh = (at: string | undefined) => !!at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now && now - Date.parse(at) <= policy.maxPriceAgeDays * 86400000
  const speeds = new Map<string, number[]>()
  // Use account, actual wire effort and known service tier. A UI variant is not proof of effort.
  // Missing identities stay unknown rather than pooling a paid API with a subscription route.
  try {
    for (const r of readRequests().records) {
      if (!r.accountID || !r.route.reasoning || !r.route.serviceTier || r.state !== "completed" || r.startedAt > now || now - r.startedAt > policy.maxPriceAgeDays * 86400000) continue
      const ms = requestTiming(r).elapsedMilliseconds
      if (ms === null || ms <= 0) continue
      const key = [r.accountID,r.route.providerID,r.route.modelID,r.route.serviceTier,r.route.reasoning].join("|")
      const rows = speeds.get(key) ?? []; rows.push(ms); speeds.set(key, rows)
    }
  } catch { /* Unavailable telemetry never invents a speed. */ }
  return routes.map(route => {
    const personal = policy.accountPrices?.[accountPriceKey(route)]
    const model = catalog.models.find(m => m.providerID === route.providerID && m.modelID === route.modelID)
    const cost = model?.cost
    // Never map a broker to another provider's price by matching a model name.
    const price: Price | undefined = personal ?? (policy.useCatalogPrices && cost && fresh(catalog.at) ? {
      version: "models.dev:" + catalog.at, provider: route.providerID, model: route.modelID, date: catalog.at!, currency: "USD",
      perMillion: {input:cost.input, cacheRead:cost.cache_read, cacheWrite:cost.cache_write, output:cost.output, reasoning:cost.output},
    } : undefined)
    if (!price || !fresh(price.date) || price.provider !== route.providerID || price.model !== route.modelID) return route
    const value = valueRequest({id:"comparison",sessionID:"comparison",kind:"price-comparison",route,startedAt:now,state:"completed",tokens:policy.comparisonTokens,price})
    if (!value.complete || value.value === null || value.currency === null) return route
    const samples = speeds.get(exactRequestKey(route)) ?? []
    const requestMilliseconds = samples.length >= policy.minSpeedSamples ? [...samples].sort((a,b) => a-b)[Math.floor(samples.length / 2)] : undefined
    return {...route,economics:{amount:value.value,currency:value.currency,basis:personal ? "account-price" as const : "catalog-equivalent" as const,source:personal ? "user account pricing" : "https://models.dev/api.json",observedAt:price.date,requestMilliseconds,samples:samples.length}}
  })
}
