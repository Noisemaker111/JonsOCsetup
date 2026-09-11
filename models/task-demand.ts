/**
 * What kind of work a dispatch is, and how much published accuracy that kind may trade away.
 *
 * `route-planner.ts` has carried a `task` on every request since it was written, and every dispatch
 * has always set it to `"coding"`: the policy file names it once, nothing derives it, and the only
 * thing it changed was which local evidence rows were read. Effort was never chosen at all -- the
 * live join builds one route per benchmarked effort and the ranking's last tiebreak is pass@1
 * descending, so automatic selection always landed on the top of every model's effort curve. That
 * is the right answer for planning a Quest and the wrong one for reading three files and reporting
 * what they say.
 *
 * Two decisions live here, and neither of them is a table of models or efforts.
 *
 * ## Where the class comes from
 *
 * In precedence order, and the source is disclosed in the routing decision:
 *
 *  1. **Stated.** The dispatching agent named the class on `quest run`. It is the only thing that
 *     knows a step is a status check rather than an implementation.
 *  2. **Enforced.** A read-only research run cannot edit source or run commands -- the host's
 *     research guard refuses the tools -- so it is a `review`. This is a property of the dispatch,
 *     not a reading of its text.
 *  3. **Inferred.** `quest.kind` is `investigation` for root-cause and debugging work, which is
 *     planning. It is only ever read in the direction that *tightens* the demand, because
 *     `inferQuestKind` falls back to a regex and a guess must not be able to buy a discount.
 *  4. **Unclassified** falls to `coding`, which is the demand every dispatch already ran under.
 *     Unknown therefore changes nothing and can never reach a cheaper class; reaching one requires
 *     a statement or an enforced fact.
 *
 * ## What the class actually sets
 *
 * One number per class: how far below the best eligible route's published pass@1 a route may sit
 * and still count as good enough. That is `qualityTolerance`, which the request already had as a
 * single global value. Widening it does not name an effort or a model -- it admits more of each
 * model's published effort curve, and the curve's own shape decides what survives. On the live
 * board that means `gpt-6-astra` keeps its cheap tier at every class (67.0% at low, still
 * Sol-class) while `gpt-5.6-luna` loses everything below max (1.5% at low) without either being
 * written down anywhere. Among what survives, `route-planner.ts` ranks on recorded cost.
 */
import type { RoutingRequest, TaskClass } from "./route-planner"

export const TASK_CLASSES: TaskClass[] = ["coding", "review", "planning", "utility"]
/** The demand an unclassified dispatch falls to: exactly what every dispatch ran under before. */
export const DEFAULT_TASK: TaskClass = "coding"

export type TaskDemand = Partial<Pick<RoutingRequest, "qualityTolerance" | "minBenchmarkPassAt1" | "minSuccessRate">>
/** Per-class overrides on the request thresholds. Absent classes keep the request's own values. */
export type TaskDemands = Partial<Record<TaskClass, TaskDemand>>

export type Classification = { task: TaskClass; source: string; stated: boolean }

export type DispatchFacts = {
  /** Named by the dispatching agent. Validated; an unknown string is rejected, never coerced. */
  task?: string
  /** Enforced by the host research guard: no source writes, no shell, no delegation. */
  readOnly?: boolean
  questKind?: string
}

/**
 * Classify one dispatch. The returned `source` is carried into the decision text so a cheap route
 * can always be traced back to the fact that authorized it.
 */
export function classifyDispatch(facts: DispatchFacts): Classification {
  if (facts.task !== undefined) {
    const stated = String(facts.task).trim().toLowerCase()
    if (!(TASK_CLASSES as string[]).includes(stated)) throw new Error("Unknown task class '" + facts.task + "'; use one of " + TASK_CLASSES.join(", "))
    return { task: stated as TaskClass, source: "stated by the dispatching agent", stated: true }
  }
  if (facts.readOnly === true) return { task: "review", source: "enforced read-only research access mode", stated: false }
  // Only the tightening direction is inferred. `inferQuestKind` is a regex over the title, and a
  // regex must not be able to widen the tolerance that decides how cheap a route may be.
  if (facts.questKind === "investigation") return { task: "planning", source: "Quest kind investigation", stated: false }
  return { task: DEFAULT_TASK, source: "unclassified; the default " + DEFAULT_TASK + " demand applies, never a cheaper class", stated: false }
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

export function validateTaskDemands(demands: TaskDemands | undefined): TaskDemands {
  if (demands === undefined) return {}
  if (!demands || typeof demands !== "object" || Array.isArray(demands)) throw new Error("Invalid per-task demands")
  for (const [task, demand] of Object.entries(demands)) {
    if (!(TASK_CLASSES as string[]).includes(task)) throw new Error("Unknown task class in demands: " + task)
    if (!demand || typeof demand !== "object") throw new Error(task + ": invalid demand")
    for (const [key, value] of Object.entries(demand)) {
      if (!["qualityTolerance", "minBenchmarkPassAt1", "minSuccessRate"].includes(key)) throw new Error(task + ": unknown demand '" + key + "'")
      if (!finite(value) || value < 0 || value > 1) throw new Error(task + "." + key + " must be a fraction in [0,1]")
    }
  }
  return demands
}

/**
 * Apply a class's demand to the request.
 *
 * The request's own values stay the floor: a class may only be configured, never invented, and a
 * class the policy does not configure runs at exactly the thresholds the request already carried.
 */
export function applyTaskDemand<T extends Omit<RoutingRequest, "now">>(request: T, demands: TaskDemands | undefined, task: TaskClass): T {
  const demand = validateTaskDemands(demands)[task]
  return { ...request, task, ...(demand ?? {}) }
}

/** One line for the routing decision, so the demand that selected a cheap route is never silent. */
export function describeDemand(classification: Classification, request: Pick<RoutingRequest, "qualityTolerance" | "minBenchmarkPassAt1">) {
  return "task " + classification.task + " (" + classification.source + "); tolerance " + (request.qualityTolerance * 100).toFixed(1) +
    "pp below the best published score" + (request.minBenchmarkPassAt1 === undefined ? "" : ", floor " + (request.minBenchmarkPassAt1 * 100).toFixed(1) + "%")
}
