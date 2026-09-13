import { valueRequest, readRequests, requestTiming, readWorkflowOutcomes, requestMetrics, TELEMETRY_FILE, type Tokens, type Price } from "../usage/telemetry-api"
import type { Route } from "./route-planner"
import type { LiveCatalog } from "./live-routes"

export type EconomyPolicy = {
  /** Opt in to provider catalog equivalents when no personal account price is configured. */
  useCatalogPrices?: boolean
  comparisonTokens: Tokens
  maxPriceAgeDays: number
  minSpeedSamples: number
  /** Measured task profiles replace the cold-start comparison when enough tasks are captured. */
  minTaskSamples?: number
  /** Exact account + provider/model + service tier. A personal contract overrides the catalog. */
  accountPrices?: Record<string, Price>
}
export const accountPriceKey = (r: Route) => [r.accountID, r.providerID, r.modelID, r.serviceTier].join("|")
const exactRequestKey = (r: Route) => [accountPriceKey(r), r.reasoning].join("|")

/** Prices value a common workload; recorded request durations remain observations, not forecasts. */
export function withRouteEconomics(routes: Route[], catalog: LiveCatalog, policy: EconomyPolicy | undefined, now: number, task?: string): Route[] {
  if (!policy) return routes
  if (!Number.isFinite(policy.maxPriceAgeDays) || policy.maxPriceAgeDays <= 0 || !Number.isInteger(policy.minSpeedSamples) || policy.minSpeedSamples < 1 ||
      !policy.comparisonTokens || ["input", "cacheRead", "cacheWrite", "output", "reasoning"].some(k => typeof policy.comparisonTokens[k as keyof Tokens] !== "number" || !Number.isFinite(policy.comparisonTokens[k as keyof Tokens]) || policy.comparisonTokens[k as keyof Tokens]! < 0)) throw Error("Invalid economical routing comparison policy")
  const fresh = (at: string | undefined) => !!at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now && now - Date.parse(at) <= policy.maxPriceAgeDays * 86400000
  if (policy.minTaskSamples !== undefined && (!Number.isInteger(policy.minTaskSamples) || policy.minTaskSamples < 1)) throw Error("Invalid task profile sample requirement")
  const minimum=policy.minTaskSamples ?? policy.minSpeedSamples
  const taskRuns=(()=>{try{return readWorkflowOutcomes(process.env.OPENCODE_WORKFLOW_OUTCOMES_FILE ?? TELEMETRY_FILE+".workflows.json").runs.filter(r=>task && r.taskTags.includes(task) && r.observation && r.observation.state!=="running" && r.observation.routeConsistent!==false && r.startedAt<=now && now-r.startedAt<=policy.maxPriceAgeDays*86400000 && Object.values(r.observation.tokens).every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0))}catch{return []}})()
  const profile=(rows:typeof taskRuns):Tokens|undefined=>rows.length<minimum?undefined:Object.fromEntries(["input","cacheRead","cacheWrite","output","reasoning"].map(k=>[k,rows.reduce((n,r)=>n+r.observation!.tokens[k as keyof Tokens]!,0)/rows.length])) as Tokens
  const pooled=profile(taskRuns)
  const speeds = new Map<string, number[]>()
  const requests=(()=>{try{return readRequests().records}catch{return []}})()
  // Use account, actual wire effort and known service tier. A UI variant is not proof of effort.
  // Missing identities stay unknown rather than pooling a paid API with a subscription route.
  try {
    for (const r of requests) {
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
    const observed=taskRuns.filter(r=>r.route.accountID===route.accountID&&r.route.providerID===route.providerID&&r.route.modelID===route.modelID&&r.route.reasoning===route.reasoning&&r.route.harness===route.harness&&r.route.serviceTier===route.serviceTier)
    const judged=observed.filter(r=>r.judgment!==null)
    if (judged.length>=minimum && task && ["coding","utility","planning","review"].includes(task)) {
      const durations=judged.map(r=>(r.observation!.completedAt??r.observation!.observedAt)-r.startedAt).sort((a,b)=>a-b)
      const accepted=judged.filter(r=>r.judgment!.accepted).length
      const cash=judged.map(r=>requestMetrics(requests.filter(p=>p.sessionID===r.sessionID&&p.startedAt>=r.startedAt-1000)).cost.find(c=>c.currency===(price?.currency??"USD"))?.actualCharge??null)
      if (durations.every(ms=>ms>0)) route={...route,evidence:[...route.evidence,{task:task as "coding"|"utility"|"planning"|"review",source:"verified task outcomes",measuredAt:new Date(Math.max(...judged.map(r=>r.judgment!.judgedAt))).toISOString(),trials:judged.length,passed:accepted,totalMilliseconds:durations.reduce((n,v)=>n+v,0),totalCash:cash.every(v=>v!==null)?cash.reduce<number>((n,v)=>n+v!,0):null,currency:price?.currency??"USD",p95Milliseconds:durations[Math.ceil(durations.length*.95)-1]}]}
    }
    if (!price || !fresh(price.date) || price.provider !== route.providerID || price.model !== route.modelID) return route
    const own=profile(observed),tokens=own??pooled??policy.comparisonTokens
    const workload=own?"observed "+task+" task profile ("+observed.length+" tasks)":pooled?"pooled "+task+" task profile ("+taskRuns.length+" tasks)":"configured comparison workload"
    const value = valueRequest({id:"comparison",sessionID:"comparison",kind:"price-comparison",route,startedAt:now,state:"completed",tokens,price})
    if (!value.complete || value.value === null || value.currency === null) return route
    const samples = speeds.get(exactRequestKey(route)) ?? []
    const requestMilliseconds = samples.length >= policy.minSpeedSamples ? [...samples].sort((a,b) => a-b)[Math.floor(samples.length / 2)] : undefined
    return {...route,economics:{amount:value.value,currency:value.currency,basis:personal ? "account-price" as const : "catalog-equivalent" as const,source:personal ? "user account pricing" : "https://models.dev/api.json",observedAt:price.date,requestMilliseconds,samples:samples.length,workload}}
  })
}
