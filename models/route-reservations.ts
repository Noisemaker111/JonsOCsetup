import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { acquireLock } from "../quest/locking"
import { applicableQuotaWindows, planRoutes, pacedSubscriptionAdmission, unlimitedSubscriptionConcurrency, type PlannerInput, type RoutingDecision } from "./route-planner"

type Reservation = { runID: string; routeID: string; accountID: string; windows: Record<string, number>; exclusive?:boolean; paced?:boolean; cash?:{budgetID:string;currency:string;value:number;kind:"reservation"|"actual"}; startedAt?:string; windowResetAt?: Record<string,string>; state: "active" | "unknown" | "settled" | "cancelled"; completedAt?: string; accountedAt?: string; reason: string }
type Ledger = { version: 1; reservations: Reservation[] }
/** Holds shared-account estimates until outcome and a newer observation are known. */
export class RouteReservations {
  constructor(readonly file: string) {}
  private read(): Ledger {
    if (!existsSync(this.file)) return { version: 1, reservations: [] }
    const value = JSON.parse(readFileSync(this.file, "utf8"))
    if (value.version !== 1 || !Array.isArray(value.reservations)) throw new Error("Invalid route reservation ledger; reconcile before dispatch")
    return value
  }
  get(runID:string){return this.read().reservations.find(r=>r.runID===runID)}
  private save(value: Ledger) { mkdirSync(dirname(this.file), { recursive: true }); const tmp = this.file + "." + process.pid + ".tmp"; writeFileSync(tmp, JSON.stringify(value)); renameSync(tmp, this.file) }
  reserve(runID: string, input: PlannerInput): { reservation: Reservation | null; decision: RoutingDecision | null } {
    if (!runID) throw new Error("Run identity required")
    if (!input.request.allowedRouteIDs?.length) throw new Error("Live scheduling requires user-allowed route IDs")
    const lock = acquireLock(dirname(this.file), "route-reservations")
    try {
      const ledger = this.read(), prior = ledger.reservations.find(r => r.runID === runID)
      if (prior) return { reservation: prior, decision: null }
      const effective = structuredClone(input)
      if(effective.request.cashBudget)effective.request.cashBudget.reserved=0
      for (const reservation of ledger.reservations) {
        if (reservation.state === "cancelled") continue
        const budget=effective.request.cashBudget
        if(budget&&reservation.cash?.currency===budget.currency){const completed=Date.parse(reservation.completedAt??"");if(reservation.state==="active"||reservation.state==="unknown"||!Number.isFinite(completed)||completed>=Date.parse(budget.startsAt)&&completed<Date.parse(budget.endsAt))budget.reserved!+=reservation.cash.value}
        const account = effective.accounts.find(a => a.id === reservation.accountID)
        if (!account) continue
        if (reservation.state !== "settled" || !(Date.parse(account.observedAt) > Date.parse(reservation.completedAt ?? ""))) account.concurrentWorkers = (account.concurrentWorkers ?? 0) + 1
        if (reservation.exclusive) {
          // Preserve old ownership, but do not let a historical single-worker policy block independent runs.
          if (unlimitedSubscriptionConcurrency(account,effective.request)) continue
          // This is a concurrency hold, not an attributed consumption estimate.
          if (reservation.state !== "settled" || !(Date.parse(account.observedAt) > Date.parse(reservation.completedAt ?? ""))) account.dispatchHold = "Uncalibrated worker hold: " + reservation.runID + (reservation.state === "settled" ? "; terminal outcome confirmed at " + reservation.completedAt + "; await a newer quota observation (latest " + account.observedAt + ")" : "; outcome " + reservation.state + "; await its terminal outcome and a fresh quota observation")
          continue
        }
        // A finished worker does not by itself refresh the provider's balance.
        if (reservation.state === "settled" && reservation.accountedAt && Date.parse(account.observedAt) >= Date.parse(reservation.accountedAt)) continue
        for (const window of account.windows) {
          const reset = Date.parse(reservation.windowResetAt?.[window.id] ?? "")
          const consumedBeforeReset = reservation.state === "settled" && Date.parse(reservation.completedAt ?? "") < reset && Date.parse(account.observedAt) >= reset && Date.parse(window.resetAt) > reset
          if (!consumedBeforeReset) window.reserved += reservation.windows[window.id] ?? 0
        }
      }
      const decision = planRoutes(effective)
      if (!decision.selected) return { reservation: null, decision }
      const route = effective.routes.find(r => r.id === decision.selected!.routeID)!
      const account=effective.accounts.find(a=>a.id===route.accountID)!,paced=!unlimitedSubscriptionConcurrency(account,input.request)&&route.admission==="configured-choice"&&pacedSubscriptionAdmission(account,input.request.now)
      const windows = applicableQuotaWindows(account, route)
      const reservation: Reservation = { runID, routeID: route.id, accountID: route.accountID, windows: Object.fromEntries(windows.filter(w=>route.quotaPerTask[w.id]!==undefined).map(w=>[w.id,route.quotaPerTask[w.id]])), paced, exclusive:!unlimitedSubscriptionConcurrency(account,input.request) && !paced && route.admission === "configured-choice" && windows.some(w=>!Number.isFinite(route.quotaPerTask[w.id])||route.quotaPerTask[w.id]<=0), windowResetAt: Object.fromEntries(windows.map(w=>[w.id,w.resetAt])), state: "active", startedAt:input.request.now, ...(input.request.cashBudget&&route.cashReservation?{cash:{budgetID:input.request.cashBudget.id,currency:route.cashReservation.currency,value:route.cashReservation.upperBound,kind:"reservation" as const}}:{}), reason: decision.summary+(paced?" Explicit scoped pacing permits up to "+account.pacing!.desiredConcurrency+" concurrent managed workers; consumption remains uncalibrated.":"") }
      ledger.reservations.push(reservation); this.save(ledger)
      return { reservation, decision }
    } finally { lock.release() }
  }
  settle(runID: string, outcome: { state: "settled" | "unknown" | "cancelled"; completedAt?: string; accountedAt?: string; cash?:{currency:string;value:number}; windows?: Record<string, number> }) {
    const lock = acquireLock(dirname(this.file), "route-reservations")
    try {
      const ledger = this.read(), reservation = ledger.reservations.find(r => r.runID === runID)
      if (!reservation) throw new Error("Unknown reservation")
      // A late transport error cannot undo observed terminal settlement.
      if(reservation.state==="settled"&&outcome.state!=="settled")return reservation
      if (outcome.state === "settled" && !Number.isFinite(Date.parse(outcome.completedAt ?? ""))) throw new Error("Settlement requires an observed completion time")
      if (outcome.windows && Object.values(outcome.windows).some(n => !Number.isFinite(n) || n < 0)) throw new Error("Invalid observed consumption")
      if (outcome.accountedAt && (!Number.isFinite(Date.parse(outcome.accountedAt)) || Date.parse(outcome.accountedAt) < Date.parse(outcome.completedAt ?? ""))) throw new Error("Accounted observation must follow completion")
      if(outcome.cash){if(!reservation.cash||outcome.cash.currency!==reservation.cash.currency||!Number.isFinite(outcome.cash.value)||outcome.cash.value<0)throw new Error("Invalid observed cash settlement");reservation.cash={...reservation.cash,value:outcome.cash.value,kind:"actual"}}
      reservation.state = outcome.state; reservation.completedAt ??= outcome.completedAt; reservation.accountedAt = outcome.accountedAt
      if (outcome.windows) reservation.windows = { ...outcome.windows }
      this.save(ledger)
      return reservation
    } finally { lock.release() }
  }
}
