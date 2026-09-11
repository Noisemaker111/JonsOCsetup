/**
 * Prove the routes the dispatch policy offers, before a worker is launched on one.
 *
 * A route can hold quota and still be unusable. On 2026-09-11 the activation check chose
 * cliproxyapi/claude-fable-5-1#high because it was the first authorized route with live capacity,
 * and it answered "Claude Code 2.1.220 does not support this model; version 2.1.251 or newer is
 * required" -- the broker advertises a client version of its own, so the locally installed CLI
 * being current says nothing about it. That surfaced as a failed release gate rather than as a
 * known fact about the route.
 *
 * This probes each proxy route with the same harmless echo the provider audit uses and records the
 * outcome, so the failure is a preflight fact instead of a mid-run surprise. It never invents
 * health: a route it could not probe is recorded as unknown, not as working.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { parse } from "json5"
import { probeModel } from "./provider-audit"
import { liveDispatchRoutes } from "../models/live-routes"
import { getAccountUsage } from "../usage/account-api"

const root = resolve(import.meta.dir, "..")
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
if (process.argv.includes("--help")) {
  console.log(`bun scripts/route-preflight.ts [--out <file>] [--json]

  Probes every cliproxyapi route the dispatch would rank -- curated and live-derived -- and records
  whether it can actually run.
  Routes on other providers are reported as not probeable from here rather than as healthy.`)
  process.exit(0)
}

const config = parse(readFileSync(join(root, "opencode.jsonc"), "utf8")) as any
const settings = config.providers?.cliproxyapi?.settings
if (!settings?.baseURL || !settings?.apiKey) throw new Error("No cliproxyapi transport is configured; nothing can be proven from here")
const policy = JSON.parse(readFileSync(join(root, "models", "dispatch-policy.json"), "utf8"))
const out = resolve(option("--out") ?? join(process.env.XDG_STATE_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".local", "state"), "opencode", "route-health.json"))

// Dispatch ranks the curated routes plus whatever the live join derives, so probe the same set.
// Health is matched back by provider/model as well as by route id, which is what lets one probe
// speak for every candidate that would place the same call.
const snapshot = await getAccountUsage({ refresh: true })
const live = await liveDispatchRoutes(policy, snapshot)
console.error(live.diagnostics.join("\n"))

const results: any[] = []
for (const route of [...live.curated, ...live.derived]) {
  const id = `${route.providerID}/${route.modelID}`
  if (route.providerID !== "cliproxyapi") {
    results.push({ routeID: route.id, model: id, state: "not-probeable", reason: "Only the local proxy transport can be probed from here" })
    continue
  }
  const probe = await probeModel(settings.baseURL, settings.apiKey, route.modelID, false).catch((error: any) => ({ error: String(error?.message ?? error) }))
  const failed = (probe as any)?.error
  results.push({ routeID: route.id, model: id, state: failed ? "unusable" : "usable", reason: failed ?? undefined })
  console.error(`${failed ? "unusable " : "usable   "} ${route.id.padEnd(22)} ${id}${failed ? "  <- " + String(failed).slice(0, 120) : ""}`)
}

const report = { at: new Date().toISOString(), proxy: settings.baseURL, results }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(report, null, 2) + "\n")
const unusable = results.filter(r => r.state === "unusable")
console.error(`\n${results.length} routes, ${unusable.length} unusable, written to ${out}`)
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2))
