import {portfolioPacing} from "./portfolio-pacing"
import {sessionBurn} from "./session-burn"
import {updateBurnControls} from "./burn-control"
import { readLedger, summarizeLedger } from "./passive-ledger"
import { measuredIntervals, empiricalModels } from "./empirical-usage"
import { renewUsageTargets } from "./usage-target"
import { harvestCodexUsage } from "./codex-harvest"
import { modelUsage } from "./model-usage"
import { readContextEvents } from "./context-events"
import { usageTimeline } from "./timeline"
import { getAccountUsage, formatAccountUsage, ACCOUNT_USAGE_FILE } from "./account-api"
import { aggregateTelemetry, type TelemetryFilter } from "./telemetry"
import { telemetryLines } from "./telemetry-view"
import { readQuotaObservations, readCalibrations, calibratedUsage } from "./calibration-store"
import { readRequests } from "./telemetry-store"
import { resetPlan } from "./reset-planner"
import { compareWorkloads } from "./workload-planner"
import { CREDIT_RATE_CARD, validateWorkloads, type UsageWorkload } from "./credit-rates"
export type UsageStatusQuery = TelemetryFilter & { refresh?: boolean; offset?: number; limit?: number; reservePoints?: number; harvest?: boolean; allSessions?:boolean; deadlineAt?:number; workloads?: UsageWorkload[] }
/** One calculation service shared by the global tool, terminal and route forecasts. */
export async function getUsageStatus(query: UsageStatusQuery = {}) {
  const offset = query.offset ?? 0, limit = query.limit ?? 25
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid telemetry pagination")
  if (query.from !== undefined && !Number.isFinite(query.from) || query.to !== undefined && !Number.isFinite(query.to) || query.from !== undefined && query.to !== undefined && query.from > query.to) throw new Error("Invalid telemetry time range")
  validateWorkloads(query.workloads ?? [])
  resetPlan([], [], Date.now(), query.reservePoints, query.deadlineAt)
  const accounts = await getAccountUsage({ refresh: query.refresh === true })
  const stored = readRequests(), aggregate = aggregateTelemetry(stored.records, query)
  const contextEvents=readContextEvents(),observations=readQuotaObservations(ACCOUNT_USAGE_FILE + ".observations"),timeline=usageTimeline(stored.records,contextEvents.events,query,observations.observations)
  const history = aggregate.requestHistory.slice(offset, offset + limit)
  const pageStart=history[0]?.startedAt??query.from??-Infinity,pageEnd=aggregate.requestHistory[offset+limit]?.startedAt??query.to??Infinity
  const pageTimeline={...timeline,points:timeline.points.slice(offset,offset+limit),compactions:timeline.compactions.filter(c=>(c.endedAt??c.startedAt)>=pageStart&&(c.endedAt??c.startedAt)<pageEnd).slice(-limit),quotaPoints:timeline.quotaPoints.filter(o=>o.at>=pageStart&&o.at<pageEnd).slice(-limit)}
  const calibration = readCalibrations(), ids = new Set(aggregate.requestHistory.map(r=>r.id))
  const allowance = calibratedUsage(stored.records.filter(r=>ids.has(r.id)), calibration.calibrations, { now: Date.now() })
  const now = Date.now(), selectedAccounts = query.accountID ? accounts.accounts.filter(a => a.id === query.accountID) : accounts.accounts
  const targets=renewUsageTargets(accounts.accounts,now)
  const allControls=updateBurnControls(accounts.accounts,observations.observations,now,targets)
  const portfolio=portfolioPacing(accounts.accounts,observations.observations,targets,allControls,now)
  const burnControl=allControls.filter(c=>!query.accountID||c.accountID===query.accountID)
  const planning = selectedAccounts.flatMap(account=>{const target=targets.find(t=>t.accountID===account.id&&t.deadlineAt>now);return resetPlan([account],observations.observations,now,query.reservePoints??target?.reservePoints,query.deadlineAt??target?.deadlineAt)})
  const ledger=readLedger({from:query.from??now-7*86400000,to:query.to??now})
  const sessionLedger=readLedger(query)
  const intervals=measuredIntervals(accounts.accounts,ledger.observations,ledger.rows,{from:ledger.coverageFrom,gaps:ledger.gaps,diagnostics:ledger.receipt?.calibrationDiagnostics??ledger.receipt?.diagnostics})
  const burn=sessionBurn(accounts.accounts,ledger.observations,ledger.rows,now,{from:ledger.coverageFrom,gaps:ledger.gaps,diagnostics:ledger.receipt?.calibrationDiagnostics??ledger.receipt?.diagnostics,observedAt:ledger.receipt?.at})
  const accounting={sessionBurn:{...burn,pools:burn.pools.filter(p=>!query.accountID||p.scope.accountID===query.accountID)},...summarizeLedger(sessionLedger.rows),observedAt:ledger.receipt?.at??null,stale:!ledger.receipt||now<ledger.receipt.at||now-ledger.receipt.at>90000,coverageFrom:ledger.coverageFrom,collector:ledger.receipt,gaps:ledger.gaps,resolvedGaps:ledger.resolvedGaps,diagnostics:ledger.diagnostics,intervals,empiricalModels:empiricalModels(intervals),targets:targets.map(t=>({...t,state:t.deadlineAt>now?"active":"expired"}))}
  const models = modelUsage(stored.records.filter(r => selectedAccounts.some(a => a.id === r.accountID)), now)
  const workloads = compareWorkloads(selectedAccounts, planning, calibration.calibrations, query.workloads ?? [], now, accounting.stale ? [] : accounting.empiricalModels)
  const harvest = query.harvest ? harvestCodexUsage({from:query.from,to:query.to,now}) : undefined
  const creditRates = { ...CREDIT_RATE_CARD, state: now < Date.parse(CREDIT_RATE_CARD.validUntil) ? "current" : "expired", note: "Published credit equivalent; not included-allowance percentage or actual charges." }
  return { ...accounts, portfolio, burnControl, planning, workloads, models, creditRates, harvest, accounting, accounts: query.accountID ? accounts.accounts.filter(a => a.id === query.accountID) : accounts.accounts,
    telemetry: { ...aggregate, portfolio, burnControl, planning, workloads, models, creditRates, harvest, accounting, allowance, timeline:pageTimeline, requestHistory: history, nextOffset: offset + limit < aggregate.requestHistory.length ? offset + limit : null, diagnostics: [...stored.diagnostics, ...contextEvents.diagnostics, ...observations.diagnostics, ...calibration.diagnostics], lastRecordedAt: stored.records.length ? Math.max(...stored.records.map(r => r.completedAt ?? r.startedAt)) : null } }
}
export function formatUsageStatus(value: Awaited<ReturnType<typeof getUsageStatus>>) {
  return [formatAccountUsage(value), "", ...telemetryLines(value.telemetry)].join("\n")
}
