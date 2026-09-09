/** Read-only offline routing workbench. Does not refresh usage or dispatch inference. */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { discoverModelsText } from "../models/model-catalog"
import { planRoutes, type PlannerInput } from "../models/route-planner"
import { capacitySnapshot, usageCache } from "../usage/usage-lib"

const root = fileURLToPath(new URL("../", import.meta.url))
const [command = "inventory", file] = process.argv.slice(2)
if (command === "evaluate" && file) {
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
  console.error("Usage: bun scripts/route-plan.ts inventory | evaluate <snapshot.json>")
  process.exitCode = 1
}
