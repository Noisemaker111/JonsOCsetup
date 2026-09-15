import { readFileSync } from 'node:fs'
import { configuredDispatchPolicyFile, resolveDispatchSelector, type DispatchPolicy } from '../models/dispatch-planner'
import { liveDispatchRoutes } from '../models/live-routes'
import { getAccountUsage } from '../usage/account-api'
import type { AccountSnapshot } from '../usage/account-types'
import type { GoalRoute } from './continuation'
import { QuestError } from './api'

/** Resolve against the same connected accounts and catalog as native dispatch. */
export async function goalRoute(selector:string, pin?:GoalRoute) {
  const snapshot=await getAccountUsage()
  const policy:DispatchPolicy=JSON.parse(readFileSync(configuredDispatchPolicyFile(),'utf8'))
  const live=await liveDispatchRoutes(policy,snapshot)
  return resolveGoalRoute({...policy,routes:[...live.curated,...live.derived]},snapshot,selector,pin)
}

export function resolveGoalRoute(policy:DispatchPolicy,snapshot:AccountSnapshot,selector:string,pin?:GoalRoute):GoalRoute {
  let result=resolveDispatchSelector(policy,selector,snapshot)
  // Generated explicit-choice IDs need not survive another catalog refresh.
  // Re-resolve the exact choice, then require every account/service field to match.
  if(!result.route&&result.code==='AUTHORIZED_ROUTE_UNAVAILABLE'&&pin)
    result=resolveDispatchSelector(policy,`${pin.providerID}/${pin.modelID}#${pin.reasoning}`,snapshot)
  if(!result.route)throw new QuestError(result.code,'Select an exact authorized route from project_route_status')
  const r=result.route
  const route={routeID:r.id,accountID:r.accountID,providerID:r.providerID,modelID:r.modelID,reasoning:r.reasoning,serviceTier:r.serviceTier}
  if(pin){
    for(const key of ['accountID','providerID','modelID','reasoning','serviceTier'] as const)
      if(route[key]!==pin[key])throw new QuestError('GOAL_ROUTE_CHANGED','Authorized account/service route changed')
    return {...route,routeID:pin.routeID}
  }
  return route
}
