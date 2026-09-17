import { usageExperience, type ExperienceQuery } from "./experience"
import { readAccountUsage, ACCOUNT_USAGE_FILE } from "./account-api"
import { readQuotaObservations } from "./calibration-store"
import { readLedger } from "./passive-ledger"
import { readUsageTargets } from "./usage-target"
import { readBurnControls } from "./burn-control"

/**
 * Read cached numeric evidence only; unlike status/pacing this never renews a target or controller.
 *
 * Every captured request reaches the ledger as it happens and the collector backfills whatever the
 * events missed, so this no longer re-parses the whole request log to merge the same rows back in.
 */
export function getUsageExperience(input: ExperienceQuery) {
  const now=Date.now(),snapshot=readAccountUsage(undefined,now)
  const from=input.from??(input.resetAt??now)-7*86400000,to=input.to??now
  const quota=readQuotaObservations(ACCOUNT_USAGE_FILE+".observations",{from})
  const ledger=readLedger({from,to})
  return usageExperience({now,accounts:snapshot.accounts,observations:[...quota.observations,...ledger.observations],requests:ledger.rows,targets:readUsageTargets(),controls:readBurnControls(),collectorAt:ledger.receipt?.at,hostScanAt:ledger.receipt?.hostScanAt,coverageFrom:ledger.coverageFrom,counterGaps:ledger.gaps,diagnosticCount:snapshot.diagnostics.length+quota.diagnostics.length+ledger.diagnostics.length+(ledger.receipt?.diagnostics.length??0)},input)
}
