/** Read-only routing workbench. `inventory`/`evaluate` are offline; `dispatch` uses live inputs. */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { discoverModelsText } from "../models/model-catalog"
import { planRoutes, type PlannerInput } from "../models/route-planner"
import { configuredDispatchPolicyFile, dispatchPlanInput } from "../models/dispatch-planner"
import { capacitySnapshot, usageCache } from "../usage/usage-lib"

const root = fileURLToPath(new URL("../", import.meta.url))
const [command = "inventory", file] = process.argv.slice(2)
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
if (command === "dispatch") {
  /**
   * The plan a real dispatch would produce for one kind of work, without reserving anything.
   *
   * Nothing is simulated: this is the same live join, the same connected accounts, the same route
   * health and the same planner that `quest run` goes through, so what it prints is what a worker
   * would be launched on. Only the reservation write is skipped.
   */
  const plan = await dispatchPlanInput({
    policyFile: option("--policy") ?? configuredDispatchPolicyFile(),
    model: option("--model"),
    task: option("--task"),
    readOnly: process.argv.includes("--read-only") ? true : undefined,
    questKind: option("--quest-kind"),
  })
  const decision = planRoutes({ request: plan.request, accounts: plan.accounts, routes: plan.routes })
  const shown = (c: (typeof decision.ranked)[number]) => {
    const route = plan.routes.find(r => r.id === c.routeID)!
    return {
      route: c.routeID, model: route.providerID + "/" + route.modelID, effort: route.reasoning,
      publishedPassAt1: c.benchmarkPassAt1, reasoningTokensPerTurn: c.reasoningTokensPerTurn,
      cacheReadRate: c.cacheReadRate, recorded: c.costSource,
    }
  }
  console.log(JSON.stringify({
    task: plan.classification.task, taskSource: plan.classification.source,
    qualityTolerance: plan.request.qualityTolerance, minBenchmarkPassAt1: plan.request.minBenchmarkPassAt1,
    selected: decision.selected ? shown(decision.selected) : null,
    summary: decision.summary,
    ranked: decision.ranked.slice(0, Number(option("--top") ?? 8)).map(shown),
    diagnostics: plan.diagnostics,
  }, null, 2))
  if (!decision.selected) process.exitCode = 2
} else if (command === "evaluate" && file) {
  const input = JSON.parse(readFileSync(file, "utf8")) as PlannerInput
  const result = planRoutes(input)
  console.log(JSON.stringify(result, null, 2))
  if (!result.selected) process.exitCode = 2
} else if (command === "inventory") {
  const models = discoverModelsText(readFileSync(join(root, "opencode.jsonc"), "utf8"))
  const cache = usageCache()
  const capacity = capacitySnapshot(cache)
  console.log(JSON.stringify({
    mode: "offline inventory; configured does not mean entitled or benchmarked",
    usageObservedAt: cache?.updated ?? null,
    usageStale: capacity.stale,
    configuredModels: new Set(models.map(m => m.providerID + "/" + m.modelID)).size,
    configuredVariants: models.length,
    sources: (cache?.sources ?? []).map(s => ({
      id: s.id, capacity: capacity.providers[s.id]?.state ?? "unknown",
      windows: (s.windows ?? []).map(w => ({
        id: w.label, usedPercent: w.pct, provenance: w.provenance ?? "unknown",
        resetAt: cache && w.provenance === "provider-observed" && Number.isFinite(Date.parse(cache.updated)) && w.resetsInSeconds !== null && Number.isFinite(w.resetsInSeconds)
          ? new Date(Date.parse(cache.updated) + w.resetsInSeconds * 1000).toISOString() : null,
      })),
    })),
    routes: models.map(m => ({
      providerID: m.providerID, modelID: m.modelID, variant: m.variant ?? null,
      readiness: m.readiness ?? "unknown",
      accountID: null, harness: null, taskEvidence: null,
    })),
    missing: [
      "Map exact routes to stable account IDs; share windows across transports of the same account.",
      "Verify harness and reasoning actually executed; a broker transport is not a coding harness.",
      "Collect route-specific outcomes and per-window task consumption before automatic ranking.",
    ],
  }, null, 2))
} else {
  console.error("Usage: bun scripts/route-plan.ts inventory | evaluate <snapshot.json> | dispatch [--task <coding|review|planning|utility>] [--read-only] [--quest-kind <kind>] [--model <route>] [--top <n>]")
  process.exitCode = 1
}
