import type { RequestRecord } from "./telemetry"
import { aggregateTelemetry } from "./telemetry"
import { routeKey, tokenFeatures } from "./calibration"
export function modelUsage(records: RequestRecord[], now: number) {
  const groups = new Map<string, RequestRecord[]>()
  for (const r of new Map(records.map(r => [r.id,r])).values()) {
    if (r.startedAt < now-30*60000 || r.startedAt > now) continue
    const key = JSON.stringify([r.accountID,routeKey(r)])
    const group = groups.get(key) ?? []; group.push(r); groups.set(key,group)
  }
  return [...groups.values()].map(rows => {
    const totals = aggregateTelemetry(rows), complete = rows.filter(r => r.state === "completed" && tokenFeatures(r))
    return {accountID:rows[0].accountID,route:rows[0].route,requests:rows.length,sessions:new Set(rows.map(r => r.sessionID)).size,
      from:Math.min(...rows.map(r=>r.startedAt)),to:now,windowMinutes:30,completeTokenRequests:complete.length,
      tokens:totals.tokens,timing:totals.timing,
      meanRequestTokens:complete.length ? {input:complete.reduce((n,r)=>n+tokenFeatures(r)![0],0)/complete.length,cacheRead:complete.reduce((n,r)=>n+tokenFeatures(r)![1],0)/complete.length,cacheWrite:complete.reduce((n,r)=>n+tokenFeatures(r)![2],0)/complete.length,outputIncludingReasoning:complete.reduce((n,r)=>n+tokenFeatures(r)![3],0)/complete.length} : null,
      note:"Recent measured requests, not completed-session costs or a quota conversion. Work outside OpenCode may be missing."}
  })
}
