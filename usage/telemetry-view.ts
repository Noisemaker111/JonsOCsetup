import {portfolioPacingLines} from "./portfolio-pacing"
import {sessionBurnLines} from "./session-burn"
import { measuredIntervalLines } from "./empirical-usage"
import type { getUsageStatus } from "./status-api"
import type { harvestCodexUsage } from "./codex-harvest"
import type { CREDIT_RATE_CARD } from "./credit-rates"
import type { modelUsage } from "./model-usage"
import { resetPlanLines, type resetPlan } from "./reset-planner"
import type { compareWorkloads } from "./workload-planner"
import type { usageTimeline } from "./timeline"
import type { calibratedUsage } from "./calibration-store"
import type { aggregateTelemetry } from "./telemetry"
export function telemetryLines(value: ReturnType<typeof aggregateTelemetry> & { portfolio?:Awaited<ReturnType<typeof getUsageStatus>>["portfolio"]; burnControl?:Awaited<ReturnType<typeof getUsageStatus>>["burnControl"]; accounting?:Awaited<ReturnType<typeof getUsageStatus>>["accounting"]; harvest?:ReturnType<typeof harvestCodexUsage>; creditRates?:typeof CREDIT_RATE_CARD & {state:string}; models?:ReturnType<typeof modelUsage>; planning?:ReturnType<typeof resetPlan>; workloads?:ReturnType<typeof compareWorkloads>; timeline?:ReturnType<typeof usageTimeline>; allowance?: ReturnType<typeof calibratedUsage> }): string[] {
  const t = value.tokens.knownTotals, number = (n: number | null) => n === null ? "unknown" : n.toLocaleString("en-US")
  const costs = Object.entries(value.apiEquivalent).map(([currency,cost]) => cost.unavailableRequests ? (currency === "unknown" ? "" : currency + ": ") + "unavailable for " + cost.unavailableRequests + " request(s)" : currency + " " + cost.knownValue.toFixed(4))
  const latest = value.latestRequest ?? value.requestHistory.at(-1), speed = latest?.timing.visibleOutputTokensPerSecond
  return [
    ...(value.accounting ? ["Passive accounting: " + (value.accounting.stale ? "stale / collecting" : "current") + "; " + value.accounting.requests + " counter records / " + value.accounting.sessionCount + " sessions",
      ...value.accounting.sources.filter(s=>s.requests>0).map(s=>s.source+": " + number(s.totals.input) + " uncached / " + number(s.totals.cacheRead) + " cached / " + number(s.outputIncludingReasoning) + " output incl. reasoning; " + s.runningRequests + " pending"),
      "Cross-host overlap is unverified; these are source counters, not unique billed tokens.",
      ...measuredIntervalLines(value.accounting.intervals),
      ...(value.accounting.sessionBurn?sessionBurnLines(value.accounting.sessionBurn):[]),
      ...value.accounting.empiricalModels.map(m=>"Token-to-allowance " + (m.scope?.windowID??"unknown pool") + ": " + m.state + " (" + m.completeIntervals + "/" + m.intervals + " complete intervals); " + m.reason)] : []),
    ...(value.portfolio?portfolioPacingLines(value.portfolio):[]),
    ...(value.burnControl??[]).map(c=>"Quest pacing: "+c.state+"; desired "+c.desiredConcurrency+" / "+c.maxConcurrent+" concurrent workers; "+c.reason+". Actual launches and outcomes are in Quest runs."),
    ...resetPlanLines(value.planning ?? []),
    ...(value.harvest ? ["Harvest: " + value.harvest.families.length + " families / " + value.harvest.sessions.length + " sessions; " + value.harvest.coverage.reconciledRequests + " reconciled requests", "Counter gaps: " + value.harvest.coverage.rejectedCounters + "; repeated readings removed: " + value.harvest.coverage.repeatedCounters, ...value.harvest.diagnostics] : []),
    ...(value.creditRates ? value.creditRates.state === "current" ? ["Published Standard credits per 1M uncached / cached / output tokens:", ...Object.entries(value.creditRates.rates).map(([model,rates]) => model + ": " + rates.join(" / ")), "Credit comparison only; included allowance needs calibration. Fast: 2.5x."] : ["Published credit rates expired; recheck official pricing."] : []),
    ...(value.workloads ?? []).map(w => w.label + ": " + (w.creditEquivalent.credits === null ? "credit comparison unavailable" : w.creditEquivalent.credits.toFixed(3) + " published credit equivalent") + "; allowance " + (w.windows.some(p => p.estimate) ? w.windows.map(p => p.windowID + " " + p.fit).join(", ") : "uncalibrated")),
    ...(value.workloads ?? []).flatMap(w=>w.windows.filter(p=>p.empiricalScenario?.state==="provisional").map(p=>{
      const scenario=p.empiricalScenario
      return w.label+" / "+p.windowID+": provisional "+scenario.points!.toFixed(3)+" points; historical-error scenario "+scenario.observedErrorScenario!.low.toFixed(3)+"–"+scenario.observedErrorScenario!.high.toFixed(3)+" (not a confidence bound or capacity guarantee)"
    })),
    ...(value.models ?? []).map(m => m.route.modelID + " (" + (m.route.reasoning ?? m.route.variant ?? "reasoning unknown") + ", " + (m.route.serviceTier ?? "tier unknown") + "): " + m.requests + " requests / " + m.sessions + " sessions in 30m; " + m.completeTokenRequests + " complete token records"),
    value.requests + " recorded requests",
    (value.filter.sessionID?"Current context: ":"Latest observed session context: ")+(value.context.current?number(value.context.current.tokens)+" ("+value.context.current.source+")":"unavailable"),
    "Input " + number(t.input) + " · cache read " + number(t.cacheRead) + " · cache write " + number(t.cacheWrite),
    "Output incl. reasoning " + number(value.tokens.outputIncludingReasoning.knownTotal) + (value.tokens.outputIncludingReasoning.missingRequests ? " (partial)" : ""),
    "Latest output rate: " + (speed != null ? speed.toFixed(1) + " visible tokens/s" : "unavailable"),
    "API equivalent: " + (costs.join("; ") || "unavailable"),
    ...(value.allowance?.windows.length ? value.allowance.windows.map(w=>w.windowID+": estimated "+w.points.toFixed(2)+" points ("+w.low.toFixed(2)+"–"+w.high.toFixed(2)+"); "+(w.percentagePointsPerMinute===null?"rate unavailable":w.percentagePointsPerMinute.toFixed(3)+" points/min over "+((w.to-w.from)/60000).toFixed(1)+" min")) : ["Allowance attribution: insufficient data"]),
    value.timeline?.compactions.length ? value.timeline.compactions.map(c=>"Compaction "+c.state+": "+number(c.beforeTokens)+" → "+number(c.afterTokens)).join("; ") : value.compactions.length ? value.compactions.length + " compaction request(s); activation unverified" : "",
    Object.keys(value.tokens.missingRequests).length ? "Some token components are unavailable." : "",
  ].filter(Boolean)
}
