import { readFileSync } from 'node:fs'
import { configuredDispatchPolicyFile, resolveDispatchSelector } from '../models/dispatch-planner'
import { getAccountUsage } from '../usage/account-api'
import { ledgerLockStatus } from '../orchestration/orchestration-ledger'
export async function routeFeedback(model = 'openai/gpt-6-astra#medium', hostCapable = true) {
  if (!hostCapable) return { code: 'HOST_CAPABILITY_MISSING', action: 'Open a fresh session with a verified plugin generation' }
  let policy: any
  try { policy = JSON.parse(readFileSync(configuredDispatchPolicyFile(), 'utf8')) } catch { return { code: 'AUTHORIZED_ROUTE_UNAVAILABLE', action: 'Inspect the configured route policy; quota availability does not add a route' } }
  const selection=resolveDispatchSelector(policy,model)
  if(!selection.route)return {...selection,action:'Use an explicitly chosen candidate selector in quest.run.model; no replacement selected'}
  const snapshot = await getAccountUsage(), route = selection.route, account = snapshot.accounts.find(a => a.id === route.accountID)
  const code = !account || account.freshness.stale ? 'STALE_QUOTA' : account.state !== 'available' ? 'ACCOUNT_HOLD' : 'ROUTE_CONFIGURED'
  return { code, model, routeID: route.id, candidates:selection.candidates, account: account ? { id: account.id, state: account.state, freshness: account.freshness, windows: account.windows.slice(0, 8).map(w => ({ id: w.id, state: w.state, remainingPercent: w.remainingPercent, resetAt: w.resetAt })) } : null, orchestrationLock: ledgerLockStatus(), action: 'Discovery is not admission. Quest run rechecks ownership, budget, account and reservations; unknown launches require inspection' }
}
