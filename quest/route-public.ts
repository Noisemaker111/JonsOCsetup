import { readFileSync } from 'node:fs'
import { configuredDispatchPolicyFile, resolveDispatchSelector } from '../models/dispatch-planner'
import { getAccountUsage } from '../usage/account-api'
import { liveDispatchRoutes } from '../models/live-routes'
import { ledgerLockStatus } from '../orchestration/orchestration-ledger'
export async function routeFeedback(model = 'openai/gpt-6-astra#medium', hostCapable = true) {
  if (!hostCapable) return { code: 'HOST_CAPABILITY_MISSING', action: 'Open a fresh session with a verified plugin generation' }
  let policy: any
  try { policy = JSON.parse(readFileSync(configuredDispatchPolicyFile(), 'utf8')) } catch { return { code: 'AUTHORIZED_ROUTE_UNAVAILABLE', action: 'Inspect the configured route policy; quota availability does not add a route' } }
  const snapshot = await getAccountUsage()
  // Candidates are what a dispatch would actually rank, so this must show the live join too --
  // the failure message for an unresolvable selector sends the reader straight here.
  try { const live = await liveDispatchRoutes(policy, snapshot); policy = { ...policy, routes: [...live.curated, ...live.derived], request: { ...policy.request, allowedRouteIDs: [...new Set([...(policy.request.allowedRouteIDs ?? []), ...live.derived.map((r: any) => r.id)])] } } } catch {}
  const selection=resolveDispatchSelector(policy,model,snapshot)
  if(!selection.route)return {...selection,action:'Use an explicitly chosen candidate selector in quest.run.model; no replacement selected'}
  const route = selection.route, account = snapshot.accounts.find(a => a.id === route.accountID)
  const code = !account || account.freshness.stale ? 'STALE_QUOTA' : account.state !== 'available' ? 'ACCOUNT_HOLD' : 'ROUTE_CONFIGURED'
  return { code, model, routeID: route.id, candidates:selection.candidates, account: account ? { id: account.id, state: account.state, freshness: account.freshness, windows: account.windows.slice(0, 8).map(w => ({ id: w.id, state: w.state, remainingPercent: w.remainingPercent, resetAt: w.resetAt })) } : null, orchestrationLock: ledgerLockStatus(), action: 'Discovery is not admission. Quest run rechecks ownership, budget, account and reservations; unknown launches require inspection' }
}
