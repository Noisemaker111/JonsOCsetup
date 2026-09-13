/** Task demand comes from explicit dispatch facts; no model-name or prompt-keyword tiering. */
import type { RoutingRequest, TaskClass } from "./route-planner"

export const TASK_CLASSES: TaskClass[] = ["coding", "review", "planning", "utility"]
/** The demand an unclassified dispatch falls to: exactly what every dispatch ran under before. */
export const DEFAULT_TASK: TaskClass = "coding"

export type TaskDemand = Partial<Pick<RoutingRequest, "qualityTolerance" | "minBenchmarkPassAt1" | "minSuccessRate" | "qualitySelection" | "preference">>
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
      if (key === "qualitySelection" && ["floor", "near-best"].includes(String(value))) continue
      if (key === "preference" && ["economy", "cash", "latency", "capacity"].includes(String(value))) continue
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
export function describeDemand(classification: Classification, request: Pick<RoutingRequest, "qualityTolerance" | "minBenchmarkPassAt1" | "qualitySelection">) {
  if (request.qualitySelection === "floor") return "task " + classification.task + " (" + classification.source + "); own quality floor " + ((request.minBenchmarkPassAt1 ?? 0) * 100).toFixed(1) + "% published prior, local outcomes checked separately"
  return "task " + classification.task + " (" + classification.source + "); tolerance " + (request.qualityTolerance * 100).toFixed(1) +
    "pp below the best published score" + (request.minBenchmarkPassAt1 === undefined ? "" : ", floor " + (request.minBenchmarkPassAt1 * 100).toFixed(1) + "%")
}
