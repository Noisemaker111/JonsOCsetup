/**
 * Offline route decisions. No provider calls, token prices, or model-name bonuses.
 * A route is an exact account + provider/model + harness + reasoning + service tier.
 *
 * Evidence is local to that route. A published benchmark is a different thing and stays a
 * different field: it is a prior, measured by someone else on someone else's harness, and it only
 * ever orders routes that have nothing measured of their own. The moment any candidate carries
 * local evidence for the task, the priors stop competing rather than being compared against a
 * number on another scale.
 */
export type TaskClass = "coding" | "review" | "planning" | "utility"
export type QuotaWindow = {
  /** Undefined means shared by every route on this account. */
  routeIDs?: string[]
  id: string
  remaining: number
  resetAt: string
  /** Same units as remaining; reservations include already dispatched work. */
  reserved: number
  /** Total capacity of the next window, if the provider actually reports it. */
  nextCapacity?: number
  periodSeconds?: number
}
export type Account = {
  id: string
  billing: "subscription" | "free" | "metered"
  authenticated: boolean
  observedAt: string
  /** Unknown is not zero, unlimited, or available. */
  capacity: "available" | "exhausted" | "unknown"
  concurrentWorkers?: number
  dispatchHold?: string
  pacing?: {state:"ready"|"hold"|"stopped";desiredConcurrency:number;deadlineAt:number;updatedAt:number;reason:string}
  windows: QuotaWindow[]
}
/** Explicit time-bounded pacing can admit uncalibrated subscription work within its finite cap. */
export function pacedSubscriptionAdmission(account:Account,at:string){
 const p=account.pacing,now=Date.parse(at)
 return account.billing==="subscription"&&!!p&&p.state==="ready"&&Number.isInteger(p.desiredConcurrency)&&p.desiredConcurrency>0&&p.desiredConcurrency<=16&&Number.isFinite(now)&&now<p.deadlineAt&&p.updatedAt<=now&&now-p.updatedAt<30000&&(account.concurrentWorkers??0)<p.desiredConcurrency
}
export type RouteEvidence = {
  task: TaskClass
  source: string
  measuredAt: string
  trials: number
  passed: number
  /** Total time/cash across ALL attempts, including failures and retries. */
  totalMilliseconds: number
  totalCash: number | null
  currency?: string
  /** Upper latency estimate, for deadline admission. */
  p95Milliseconds: number
}
/** A public score for this model at this exact effort. Never a measurement of this route. */
export type RouteBenchmark = {
  suite: string
  passAt1: number
  /** The effort level the published score was produced at, not necessarily the route's. */
  effort: string
  provenance: "independent" | "vendor"
  source: string
  measuredAt: string
  /** Artificial Analysis Intelligence Index, when the table records one. Tiebreak only. */
  intelligence?: number
  /** Why this route's effort may claim the score, when the source did not state one. */
  attribution?: string
}
export type Route = {
  id: string
  accountID: string
  providerID: string
  modelID: string
  harness: string
  agent?: string
  reasoning: string
  serviceTier: string
  verified: boolean
  /** Policy authorizes this exact choice without claiming a local measurement of it:
   *  `configured-choice` is the user naming it, `benchmark-ranked` is a live candidate whose
   *  only quality signal is `benchmark`. Both mean task consumption is uncalibrated. */
  admission?: "configured-choice" | "benchmark-ranked"
  outcomeIssue?: {task:TaskClass;reason:string}
  evidence: RouteEvidence[]
  benchmark?: RouteBenchmark
  /** Measured task consumption, in each shared account window's units. */
  quotaPerTask: Record<string, number>
  cashReservation?: { currency:string; upperBound:number }
}
export type RoutingRequest = {
  task: TaskClass
  now: string
  minSuccessRate: number
  minTrials: number
  /** Only routes within this distance of the best observed quality compete on efficiency. */
  qualityTolerance: number
  maxUsageAgeSeconds: number
  maxEvidenceAgeDays: number
  /** Floor for a route whose only quality signal is a published benchmark. A route the user
   *  named explicitly is exempt: naming it is the authorization. */
  minBenchmarkPassAt1?: number
  maxTaskMilliseconds?: number
  maxCashPerSuccess?: number
  cashCurrency?: string
  /** Explicit user policy: no fixed subscription worker cap; quota and ownership still apply. */
  subscriptionConcurrency?: "unlimited" | "calibrated"
  reserveFraction: number
  cashBudget?: { id:string; currency:string; limit:number; spent:number; startsAt:string; endsAt:string; reserved?:number }
  /** Restricts the exact route; never authorizes a silent replacement or extra spending. */
  explicitRouteID?: string
  /** User-configured default route; fallback is a single admission decision, never a call retry. */
  primaryRouteID?: string
  fallback?: { when:"admission-unavailable"; routeIDs:string[] }
  /** The supplied routes are authorized offline inputs; live callers must pin an allowlist. */
  allowedRouteIDs?: string[]
  preference?: "capacity" | "latency" | "cash"
  /** Absolute allowance units held for demanding queued work, by account/window. */
  reserveByAccount?: Record<string, Record<string, number>>
}
export function unlimitedSubscriptionConcurrency(account: Pick<Account, "billing">, request: Pick<RoutingRequest, "subscriptionConcurrency">) {
  return account.billing === "subscription" && request.subscriptionConcurrency === "unlimited"
}
export type PlannerInput = { request: RoutingRequest; accounts: Account[]; routes: Route[] }
export function applicableQuotaWindows(account: Account, route: Route) {
  return account.windows.filter(w => w.routeIDs === undefined || w.routeIDs.includes(route.id))
}

type Candidate = {
  routeID: string
  accountID: string
  /** Locally measured pass rate. Null means nothing was measured on this exact route. */
  successRate: number | null
  millisecondsPerSuccess: number | null
  cashPerSuccess: number | null
  /** Estimated current-window task slots lost before a longer window resets. */
  expiryOpportunity: number | null
  limitingWindow?: string
  /** Published prior, on a different harness. Only ranks against other priors. */
  benchmarkPassAt1: number | null
  benchmarkProvenance?: "independent" | "vendor"
  intelligence: number | null
  evidenceSource: string
  /** What the caller must still be told about an uncalibrated admission, if anything. */
  note?: string
}
export type RoutingDecision = {
  selected: Candidate | null
  ranked: Candidate[]
  excluded: { routeID: string; reasons: string[] }[]
  summary: string
  fallback?: { fromRouteID:string; toRouteID:string; reasons:string[] }
}
const finite = (n: number) => typeof n === "number" && Number.isFinite(n)
const nonnegative = (n: number) => finite(n) && n >= 0
const positive = (n: number) => finite(n) && n > 0
const date = (s: string) => typeof s === "string" ? Date.parse(s) : NaN

function validateRequest(r: RoutingRequest) {
  if (r.subscriptionConcurrency !== undefined && !["unlimited", "calibrated"].includes(r.subscriptionConcurrency)) throw new Error("Invalid subscription concurrency policy")
  if(r.cashCurrency!==undefined&&(!r.cashCurrency.trim()||r.cashBudget&&r.cashBudget.currency!==r.cashCurrency))throw new Error("Invalid or conflicting cash currency")
  if(r.cashBudget){const b=r.cashBudget;if(!b.id?.trim()||!b.currency?.trim()||![b.limit,b.spent,b.reserved??0].every(nonnegative)||!finite(date(b.startsAt))||!finite(date(b.endsAt))||date(b.startsAt)>=date(b.endsAt))throw new Error("Invalid cash budget")}
  if (r.preference !== undefined && !["capacity", "latency", "cash"].includes(r.preference)) throw new Error("Invalid routing preference")
  if (r.allowedRouteIDs !== undefined && (!Array.isArray(r.allowedRouteIDs) || r.allowedRouteIDs.some(id => typeof id !== "string"))) throw new Error("Invalid route allowlist")
  if (r.minBenchmarkPassAt1 !== undefined && (!nonnegative(r.minBenchmarkPassAt1) || r.minBenchmarkPassAt1 > 1)) throw new Error("Invalid benchmark floor")
  if (!["coding", "review", "planning", "utility"].includes(r.task) || !finite(date(r.now)) ||
      !positive(r.minTrials) || !Number.isInteger(r.minTrials) ||
      !nonnegative(r.minSuccessRate) || r.minSuccessRate > 1 ||
      !nonnegative(r.qualityTolerance) || r.qualityTolerance > 1 ||
      !positive(r.maxUsageAgeSeconds) || !positive(r.maxEvidenceAgeDays) ||
      (r.maxCashPerSuccess !== undefined && !nonnegative(r.maxCashPerSuccess)) ||
      !nonnegative(r.reserveFraction) || r.reserveFraction >= 1 ||
      (r.maxTaskMilliseconds !== undefined && !positive(r.maxTaskMilliseconds))) {
    throw new Error("Invalid routing request")
  }
}

/** Pure and clock-injected so reset boundaries can be tested without spending inference. */
export function planRoutes(input: PlannerInput): RoutingDecision {
 const req=input.request
 if(req.primaryRouteID!==undefined&&(!req.primaryRouteID.trim()||!req.allowedRouteIDs?.includes(req.primaryRouteID)))throw new Error("Primary route must be explicitly allowed")
 if(req.fallback && (!req.primaryRouteID||req.fallback.when!=="admission-unavailable"||!Array.isArray(req.fallback.routeIDs)||!req.fallback.routeIDs.length||new Set(req.fallback.routeIDs).size!==req.fallback.routeIDs.length||req.fallback.routeIDs.some(id=>id===req.primaryRouteID||!req.allowedRouteIDs?.includes(id))))throw new Error("Fallback requires a primary route and explicitly allowed alternatives")
 if(req.explicitRouteID||!req.primaryRouteID)return planEligibleRoutes(input)
 const first=planEligibleRoutes({...input,request:{...req,explicitRouteID:req.primaryRouteID}})
 if(first.selected||!req.fallback)return first
 // The alternatives are ranked as a pool, not tried in list order. Attempting them one at a time
 // made the list's own order the decision -- whoever typed it first won -- which is exactly what
 // a benchmark-informed ranking is for. Policy authorization no longer depends on a route being
 // the one requested, so a pooled pass admits them and then sorts them on the evidence it has.
 const reasons=first.excluded.flatMap(r=>r.reasons)
 const alternative=planEligibleRoutes({...input,request:{...req,allowedRouteIDs:req.fallback.routeIDs}})
 if(!alternative.selected)return {...alternative,excluded:[...first.excluded,...alternative.excluded],summary:"Configured primary and fallback routes unavailable"}
 const fallback={fromRouteID:req.primaryRouteID,toRouteID:alternative.selected.routeID,reasons}
 return {...alternative,fallback,excluded:[...first.excluded,...alternative.excluded.filter(r=>r.routeID!==req.primaryRouteID)],summary:"Configured fallback "+fallback.fromRouteID+" → "+fallback.toRouteID+": "+reasons.join("; ")}
}
function planEligibleRoutes(input: PlannerInput): RoutingDecision {
  const { request: req, accounts, routes } = input
  validateRequest(req)
  if (new Set(accounts.map(a => a.id)).size !== accounts.length ||
      new Set(routes.map(r => r.id)).size !== routes.length) throw new Error("Duplicate account or route identity")
  const now = date(req.now)
  const excluded: RoutingDecision["excluded"] = []
  const candidates: Candidate[] = []
  for (const route of routes) {
    if (req.explicitRouteID && route.id !== req.explicitRouteID) continue
    const named = req.explicitRouteID === route.id
    // Policy authorized this exact route without a local measurement of it, so its task
    // consumption is uncalibrated and admitted on quota alone. That was always the meaning;
    // it was only ever computed from `explicitRouteID` because nothing else could be chosen.
    const chosen = route.admission !== undefined
    const reasons: string[] = []
    if (route.outcomeIssue?.task === req.task) reasons.push("Measured outcomes unavailable: " + route.outcomeIssue.reason)
    const account = accounts.find(a => a.id === route.accountID)
    const windows = account ? applicableQuotaWindows(account, route) : []
    if (![route.id, route.accountID, route.providerID, route.modelID, route.harness, route.reasoning, route.serviceTier].every(x => typeof x === "string" && x.trim())) reasons.push("incomplete exact route identity")
    if (req.allowedRouteIDs && !req.allowedRouteIDs.includes(route.id)) reasons.push("route is not allowed by user policy")
    if(req.cashBudget){const b=req.cashBudget,c=route.cashReservation;if(now<date(b.startsAt)||now>=date(b.endsAt))reasons.push("cash budget is outside its authorized time range");if(!c||c.currency!==b.currency||!nonnegative(c.upperBound))reasons.push("route has no matching cash reservation bound");else if(c.upperBound>b.limit-b.spent-(b.reserved??0))reasons.push("insufficient unreserved cash budget")}
    if (!route.verified) reasons.push("route transport/entitlement is unverified")
    if (!account) reasons.push("account is not registered")
    else {
      if (!["subscription", "free", "metered"].includes(account.billing)) reasons.push("unknown billing arrangement")
      if (chosen && windows.some(w=>!positive(route.quotaPerTask[w.id])) && (account.concurrentWorkers ?? 0) > 0 && !unlimitedSubscriptionConcurrency(account,req) && !pacedSubscriptionAdmission(account,req.now)) reasons.push("uncalibrated admission awaits existing account workers and fresh quota")
      if(account.pacing){const p=account.pacing,now=Date.parse(req.now);if(p.state==="stopped"||(!unlimitedSubscriptionConcurrency(account,req)&&now>=p.deadlineAt))reasons.push("Burn pacing stopped: "+p.reason);else if(p.state!=="ready"||p.updatedAt>now||now-p.updatedAt>=30000||(!unlimitedSubscriptionConcurrency(account,req)&&(account.concurrentWorkers??0)>=p.desiredConcurrency))reasons.push("Burn pacing hold: "+p.reason)}
      if (account.dispatchHold) reasons.push(account.dispatchHold)
      if (chosen && account.billing === "metered" && !req.cashBudget) reasons.push("configured metered choice requires a cash budget")
      if (!account.authenticated) reasons.push("account is not authenticated")
      if (account.capacity !== "available") reasons.push("account capacity is " + account.capacity)
      const age = now - date(account.observedAt)
      if (!finite(age) || age < 0 || age >= req.maxUsageAgeSeconds * 1000) reasons.push("usage observation is stale or invalid")
      if (account.billing === "subscription" && !windows.length) reasons.push("subscription windows are unknown")
      if (new Set(account.windows.map(w => w.id)).size !== account.windows.length) reasons.push("duplicate quota window")
    }
    // Newest matching measurement only. An older favorable result cannot mask a regression.
    const evidence = route.evidence.filter(e => e.task === req.task)
      .sort((a, b) => date(b.measuredAt) - date(a.measuredAt))[0]
    // A published score is admitted as a prior, not as a measurement. It is checked here so a
    // malformed or sub-floor one excludes the route instead of silently ranking it at zero.
    const prior = route.benchmark
    let benchmarkPassAt1: number | null = null
    let benchmarkNote = ""
    if (prior) {
      const age = now - date(prior.measuredAt)
      if (!prior.suite?.trim() || !prior.source?.trim() || !prior.effort?.trim() || !positive(prior.passAt1) || prior.passAt1 > 1 ||
          !["independent", "vendor"].includes(prior.provenance) || !finite(age) || age < 0 ||
          (prior.intelligence !== undefined && !positive(prior.intelligence))) reasons.push("invalid benchmark prior")
      // A stale public score is not evidence of breakage, only of nobody re-running the board.
      // It stops being a ranking signal; it does not remove a route the user already authorized.
      else if (age > req.maxEvidenceAgeDays * 86400000) benchmarkNote = "benchmark prior from " + prior.measuredAt + " is stale and was not ranked"
      else if (!named && req.minBenchmarkPassAt1 !== undefined && prior.passAt1 < req.minBenchmarkPassAt1) reasons.push("benchmark prior " + (prior.passAt1 * 100).toFixed(1) + "% is below the task floor")
      else {
        benchmarkPassAt1 = prior.passAt1
        benchmarkNote = prior.suite + " " + (prior.passAt1 * 100).toFixed(1) + "% at effort " + prior.effort + " (" + prior.provenance + ", " + prior.measuredAt + ", " + prior.source + ")" + (prior.attribution ? "; " + prior.attribution : "")
      }
    }
    let successRate = 0
    if (!evidence && !chosen) reasons.push("no evidence for this task and exact route")
    else if (evidence) {
      const age = now - date(evidence.measuredAt)
      if (!finite(age) || age < 0 || age > req.maxEvidenceAgeDays * 86400000) reasons.push("evidence is stale or invalid")
      if (!evidence.source?.trim() || !Number.isInteger(evidence.trials) ||
          !Number.isInteger(evidence.passed) || evidence.trials < req.minTrials ||
          evidence.passed <= 0 || evidence.passed > evidence.trials ||
          !positive(evidence.totalMilliseconds) || (evidence.totalCash !== null && !nonnegative(evidence.totalCash)) ||
          !positive(evidence.p95Milliseconds)) reasons.push("insufficient or invalid measured outcomes")
      else {
        if(evidence.totalCash!==null&&(evidence.currency??"USD")!==(req.cashCurrency??req.cashBudget?.currency??"USD"))reasons.push("measured cash currency does not match the budget")
        successRate = evidence.passed / evidence.trials
        if (successRate < req.minSuccessRate) reasons.push("below task quality floor")
        if (evidence.totalCash === null && (req.maxCashPerSuccess !== undefined || req.preference === "cash")) reasons.push("actual cash per success is unavailable for the requested cash constraint")
        if (evidence.totalCash !== null && req.maxCashPerSuccess !== undefined && evidence.totalCash / evidence.passed > req.maxCashPerSuccess) reasons.push("cash per success exceeds budget")
        if (req.maxTaskMilliseconds !== undefined && evidence.p95Milliseconds > req.maxTaskMilliseconds) reasons.push("p95 latency exceeds task deadline")
      }
    }
    let expiryOpportunity = 0
    let limitingWindow: string | undefined
    if (account) {
      const valid: { window: QuotaWindow; slots: number; reset: number }[] = []
      for (const window of windows) {
        const burn = route.quotaPerTask[window.id]
        const reset = date(window.resetAt)
        if ((!positive(burn) && (!chosen || burn !== undefined)) || !nonnegative(window.remaining) || !nonnegative(window.reserved) ||
            !finite(reset) || reset <= now ||
            (window.nextCapacity !== undefined && !positive(window.nextCapacity)) ||
            (window.periodSeconds !== undefined && !positive(window.periodSeconds))) {
          reasons.push("unknown or invalid quota/reset/consumption for " + window.id)
          continue
        }
        const reserve = req.reserveByAccount?.[account.id]?.[window.id] ?? window.remaining * req.reserveFraction
        if (!nonnegative(reserve)) { reasons.push("invalid reserve for " + window.id); continue }
        if (chosen && !positive(burn)) {
          if (window.remaining - reserve - window.reserved <= 0) reasons.push("insufficient unreserved quota in " + window.id)
          continue // Unknown consumption is not a zero-token forecast. Concurrency follows explicit policy.
        }
        const slots = (window.remaining - reserve - window.reserved) / burn
        if (slots < 1) reasons.push("insufficient unreserved quota in " + window.id)
        valid.push({ window, slots, reset })
      }
      // Deadline matters: slots that cannot be completed before expiry are not useful capacity.
      if (evidence && positive(evidence.p95Milliseconds)) {
        for (const short of valid) {
          const usefulNow = Math.max(0, Math.floor(Math.min(...valid.map(w => w.slots), (short.reset - now) / evidence.p95Milliseconds)))
          // Basic expiring allowance, normalized by time to reset.
          let pressure = usefulNow / Math.max(1, (short.reset - now) / 3600000)
          // Nested windows: can the longer allowance still be consumed after skipping this session?
          // Only compare units after converting each window to measured task slots.
          for (const long of valid.filter(w => w.reset > short.reset)) {
            if (!short.window.nextCapacity || !short.window.periodSeconds) continue
            const periods = Math.ceil((long.reset - short.reset) / (short.window.periodSeconds * 1000))
            const futureSlots = Math.min(periods * short.window.nextCapacity * (1 - req.reserveFraction) / route.quotaPerTask[short.window.id], (long.reset - short.reset) / evidence.p95Milliseconds)
            const neededNow = Math.max(0, long.slots - futureSlots)
            pressure += Math.min(usefulNow, neededNow) / Math.max(1, (short.reset - now) / 3600000)
          }
          if (pressure > expiryOpportunity) { expiryOpportunity = pressure; limitingWindow = short.window.id }
        }
      }
    }
    if (reasons.length) { excluded.push({ routeID: route.id, reasons }); continue }
    const unknownConsumption = !!account && windows.some(w => !positive(route.quotaPerTask[w.id]))
    // Every eligible route becomes a candidate now. It used to return the first uncalibrated
    // choice straight out of the loop, which meant automatic selection could never compare two
    // of them: whichever came first in the policy file won, and the ranking below was dead code
    // for every route the user had not measured -- which is all of them.
    candidates.push({
      routeID: route.id, accountID: route.accountID,
      successRate: evidence ? successRate : null,
      millisecondsPerSuccess: evidence ? evidence.totalMilliseconds / evidence.passed : null,
      cashPerSuccess: evidence ? (evidence.totalCash === null ? null : evidence.totalCash / evidence.passed) : null,
      expiryOpportunity: !evidence || (chosen && unknownConsumption) ? null : expiryOpportunity, limitingWindow,
      benchmarkPassAt1, benchmarkProvenance: benchmarkPassAt1 === null ? undefined : prior!.provenance,
      intelligence: benchmarkPassAt1 === null ? null : prior!.intelligence ?? null,
      evidenceSource: evidence ? evidence.source : benchmarkNote || "configured choice; outcomes and consumption uncalibrated",
      note: unknownConsumption
        ? (unlimitedSubscriptionConcurrency(account!, req) ? "consumption uncalibrated; user policy permits concurrent subscription workers without a fixed account cap. Fresh quota is required; unknown consumption is not a capacity guarantee."
          : pacedSubscriptionAdmission(account!, req.now) ? "consumption uncalibrated; explicit scoped pacing permits up to " + account!.pacing!.desiredConcurrency + " concurrent managed workers. Quota movement, not session count, controls pacing."
          : "consumption uncalibrated; one worker on this account, refresh after completion. Quota reserves are admission thresholds, not a task consumption guarantee.")
        : undefined,
    })
  }
  if (req.explicitRouteID && !routes.some(r => r.id === req.explicitRouteID)) excluded.push({ routeID: req.explicitRouteID, reasons: ["explicit route is not registered"] })
  // Measured outcomes and public priors are different scales on different harnesses, so they are
  // never compared. Anything measured locally for this task wins the field outright; the priors
  // only order the routes that are left when nothing has been measured at all.
  const measured = candidates.filter(c => c.successRate !== null)
  const pool = measured.length ? measured : candidates
  for (const c of candidates) if (!pool.includes(c)) excluded.push({ routeID: c.routeID, reasons: ["only a published benchmark prior; measured routes are available for this task"] })
  const quality = (c: Candidate) => c.successRate ?? c.benchmarkPassAt1 ?? 0
  const bestQuality = Math.max(0, ...pool.map(quality))
  const provenanceRank = (c: Candidate) => c.benchmarkProvenance === "vendor" ? 1 : 0
  const ranked = pool.filter(c => {
    if (quality(c) + req.qualityTolerance + 1e-12 >= bestQuality) return true
    excluded.push({ routeID: c.routeID, reasons: ["outside quality tolerance of best eligible route"] })
    return false
  }).sort((a, b) =>
    (req.preference === "cash" ? (a.cashPerSuccess ?? Infinity) - (b.cashPerSuccess ?? Infinity) : req.preference === "latency" ? (a.millisecondsPerSuccess ?? 0) - (b.millisecondsPerSuccess ?? 0) : (b.expiryOpportunity ?? -Infinity) - (a.expiryOpportunity ?? -Infinity)) ||
    (a.millisecondsPerSuccess ?? 0) - (b.millisecondsPerSuccess ?? 0) ||
    (a.cashPerSuccess ?? Infinity) - (b.cashPerSuccess ?? Infinity) ||
    (b.successRate ?? 0) - (a.successRate ?? 0) ||
    // Nothing measured on either side: the published board is the only quality signal left, and
    // an independent measurement beats a vendor's own number at the same score.
    (b.benchmarkPassAt1 ?? 0) - (a.benchmarkPassAt1 ?? 0) ||
    provenanceRank(a) - provenanceRank(b) ||
    (b.intelligence ?? 0) - (a.intelligence ?? 0) || a.routeID.localeCompare(b.routeID))
  const selected = ranked[0] ?? null
  return {
    selected, ranked, excluded,
    summary: selected ? describe(selected, req) : "No evidenced, funded route meets the task constraints. No fallback was authorized.",
  }
}

/** The decision text carries the provenance of whatever justified it, never a bare percentage. */
function describe(selected: Candidate, req: RoutingRequest) {
  const parts = [selected.successRate === null
    ? (selected.benchmarkPassAt1 === null ? "quality uncalibrated" : "no local outcomes; ranked on " + selected.evidenceSource)
    : "observed success " + (selected.successRate * 100).toFixed(1) + "%; " +
      (selected.cashPerSuccess === null ? "actual cash unavailable" : (req.cashCurrency ?? req.cashBudget?.currency ?? "USD") + " " + selected.cashPerSuccess.toFixed(4) + "/success") + "; " +
      Math.round((selected.millisecondsPerSuccess ?? 0) / 1000) + "s/success; " +
      (selected.expiryOpportunity === null ? "expiry pressure unavailable" : "expiry pressure " + selected.expiryOpportunity.toFixed(2) + " task slots/hour")]
  if (selected.note) parts.push(selected.note)
  return selected.routeID + ": " + parts.join("; ")
}
