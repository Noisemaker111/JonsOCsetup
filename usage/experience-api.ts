import { usageExperience, type ExperienceQuery } from "./experience"
import { readAccountUsage, ACCOUNT_USAGE_FILE } from "./account-api"
import { readQuotaObservations } from "./calibration-store"
import { readLedger, ledgerRows } from "./passive-ledger"
import { readRequests } from "./telemetry-store"
import { readUsageTargets } from "./usage-target"
import { readBurnControls } from "./burn-control"

/** Read cached numeric evidence only; unlike status/pacing this never renews a target or controller. */
export function getUsageExperience(input: ExperienceQuery) {
  const now=Date.now(),snapshot=readAccountUsage(undefined,now),quota=readQuotaObservations(ACCOUNT_USAGE_FILE+".observations")
  const ledger=readLedger({to:now}),native=readRequests()
  return usageExperience({now,accounts:snapshot.accounts,observations:[...quota.observations,...ledger.observations],requests:[...ledger.rows,...ledgerRows(native.records)],targets:readUsageTargets(),controls:readBurnControls(),collectorAt:ledger.receipt?.at,hostScanAt:ledger.receipt?.hostScanAt,coverageFrom:ledger.coverageFrom,counterGaps:ledger.gaps,diagnosticCount:snapshot.diagnostics.length+quota.diagnostics.length+ledger.diagnostics.length+native.diagnostics.length+(ledger.receipt?.diagnostics.length??0)},input)
}
