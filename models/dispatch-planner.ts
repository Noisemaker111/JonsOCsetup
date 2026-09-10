import {measuredOutcomeRoutes,type MeasuredOutcomes} from "./measured-outcomes"
import {join,dirname,isAbsolute} from "node:path"
import { calibratedRoutes,type DispatchForecasts } from "./calibrated-dispatch"
import { readCalibrations,accountRegime,updateBurnControls,readQuotaObservations } from "../usage/telemetry-api"
import { assertConfiguredModel } from "./access-policy"
import { accountsForRoute, relevantAccountWindows } from "../usage/account-api"
import { readFileSync } from "node:fs"
import type { AccountSnapshot } from "../usage/account-types"
import { getAccountUsage, ACCOUNT_USAGE_FILE } from "../usage/account-api"
import { RouteReservations } from "./route-reservations"
import type { PlannerInput,Route,RoutingRequest } from "./route-planner"
/** A promoted generation must read the policy promoted with its planner, not mutable root source. */
export const configuredDispatchPolicyFile=()=>process.env.OPENCODE_DISPATCH_POLICY??join(import.meta.dir,"dispatch-policy.json")
/** Explicit fixture/host pin keeps isolated Quest storage on shared atomic account admission. */
export function dispatchReservationFile(runtimeRoot:string){const pin=process.env.OPENCODE_ROUTE_RESERVATIONS;if(pin&&!isAbsolute(pin))throw new Error('OPENCODE_ROUTE_RESERVATIONS must be absolute');return pin??join(runtimeRoot,'route-reservations.json')}
export type DispatchPolicy = { version:1; outcomesFile?:string; calibration?:DispatchForecasts; request:Omit<RoutingRequest,"now"|"explicitRouteID">; routes:Route[]; billing:Record<string,PlannerInput["accounts"][number]["billing"]>; bootstrapByProject:Record<string,string[]>; commandsByProject?:Record<string,Record<string,import("../quest/command-runtime").CommandSpec>> }
export type SelectorResult={code:string;route?:Route;candidates:{selector:string;model:string;accountID:string;serviceTier:string}[]}
/** Shared model-facing exact selector. `route:<id>` includes account and service identity.
 *  A selector the user typed is itself the authorization: it resolves against every registered
 *  route, and otherwise against any identity the access policy permits on exactly one connected
 *  account. `allowedRouteIDs` is the pool automatic selection ranks, never a veto on an explicit
 *  choice. Silent substitution stays forbidden: an unresolvable selector still fails closed. */
export function resolveDispatchSelector(policy: DispatchPolicy, selector: string, snapshot?: AccountSnapshot): SelectorResult {
 const allowed=policy.routes.filter(r=>policy.request.allowedRouteIDs?.includes(r.id))
 const candidates=allowed.map(r=>({selector:'route:'+r.id,model:`${r.providerID}/${r.modelID}#${r.reasoning}`,accountID:r.accountID,serviceTier:r.serviceTier}))
 if(selector.startsWith('route:')){const route=policy.routes.find(r=>r.id===selector.slice(6));return route?{code:'ROUTE_CONFIGURED',route,candidates}:{code:'AUTHORIZED_ROUTE_UNAVAILABLE',candidates}}
 const [identity,reasoning,...extra]=selector.split('#')
 if(extra.length)return {code:'INVALID_ROUTE_SELECTOR',candidates}
 const models=policy.routes.filter(r=>`${r.providerID}/${r.modelID}`===identity)
 if(models.length&&!reasoning)return {code:'REASONING_REQUIRED',candidates:candidates.filter(c=>c.model.startsWith(identity+'#'))}
 const matches=models.filter(r=>r.reasoning===reasoning)
 if(matches.length>1)return {code:'AMBIGUOUS_ACCOUNT_SERVICE_ROUTE',candidates}
 if(matches.length===1)return {code:'ROUTE_CONFIGURED',route:matches[0],candidates}
 const slash=identity.indexOf('/'),providerID=identity.slice(0,slash),modelID=identity.slice(slash+1)
 if(slash<1||!modelID)return {code:'INVALID_ROUTE_SELECTOR',candidates}
 // Reachability before reasoning: asking which effort level to use on a model no connected
 // account serves would name the wrong problem.
 if(!snapshot)return {code:'AUTHORIZED_ROUTE_UNAVAILABLE',candidates}
 try{assertConfiguredModel({providerID,id:modelID})}catch{return {code:'AUTHORIZED_ROUTE_UNAVAILABLE',candidates}}
 const linked=accountsForRoute(snapshot,providerID,modelID)
 if(linked.length!==1)return {code:linked.length?'AMBIGUOUS_ACCOUNT_SERVICE_ROUTE':'AUTHORIZED_ROUTE_UNAVAILABLE',candidates}
 if(!reasoning)return {code:'REASONING_REQUIRED',candidates}
 return {code:'ROUTE_CONFIGURED',candidates,route:{id:'chosen-'+providerID+'-'+modelID+'-'+reasoning,accountID:linked[0].id,providerID,modelID,harness:'native',agent:'worker',reasoning,serviceTier:'default',verified:true,admission:'configured-choice',evidence:[],quotaPerTask:{}}}
}
/** User policy supplies routes and thresholds; live balances replace offline snapshots. */
export async function reserveDispatch(input:{runID:string;model?:string;policyFile:string;reservationFile:string;now?:number},loadUsage:typeof getAccountUsage=getAccountUsage) {
 let policy:DispatchPolicy
 try{policy=JSON.parse(readFileSync(input.policyFile,"utf8"))}catch{throw new Error("Configure the dispatch policy with authorized routes, quality evidence, budgets and project bootstrap before running a Quest")}
 if(policy.version!==1||!Array.isArray(policy.routes)||!policy.request?.allowedRouteIDs?.length)throw new Error("Invalid dispatch policy: version 1 and an explicit route allowlist are required")
 const snapshot=await loadUsage({refresh:true}),now=input.now??Date.now()
 let explicitRouteID:string|undefined
 if(input.model){
  const result=resolveDispatchSelector(policy,input.model,snapshot)
  if(!result.route)throw new Error(result.code+': explicit model must resolve to one account/reasoning/service route the access policy permits on a single connected account; use project_route_status candidates, no replacement selected')
  explicitRouteID=result.route.id
  // The chosen route competes as itself. A curated pool orders automatic picks; it never vetoes an explicit choice.
  if(!policy.routes.some(r=>r.id===explicitRouteID))policy.routes=[...policy.routes,result.route]
  if(!(policy.request.allowedRouteIDs??[]).includes(explicitRouteID))policy.request={...policy.request,allowedRouteIDs:[...(policy.request.allowedRouteIDs??[]),explicitRouteID]}
 }
 for(const route of policy.routes){if(route.admission==="configured-choice")assertConfiguredModel({providerID:route.providerID,id:route.modelID});const linked=accountsForRoute(snapshot,route.providerID,route.modelID);if(linked.length!==1||linked[0].id!==route.accountID)route.verified=false}
 const pacing=updateBurnControls(snapshot.accounts,readQuotaObservations(ACCOUNT_USAGE_FILE+".observations").observations,now)
 const accounts:PlannerInput["accounts"]=snapshot.accounts.filter(a=>policy.routes.some(r=>r.accountID===a.id)).map(a=>({id:a.id,pacing:pacing.find(p=>p.accountID===a.id),billing:policy.billing[a.id],authenticated:a.state!=="auth-required"&&a.connections.length>0,observedAt:a.observedAt??"",capacity:a.state==="available"?"available":a.state==="exhausted"?"exhausted":"unknown",windows:a.windows.filter(w=>(w.scope==="shared"||w.scope==="model")&&!(w.state==="available"&&(w.remainingPercent==null||!w.resetAt))).map(w=>({id:w.id,...(w.scope==="model"?{routeIDs:policy.routes.filter(r=>r.accountID===a.id&&relevantAccountWindows(a,r.modelID).includes(w)).map(r=>r.id)}:{}),remaining:w.state==="unknown"?NaN:w.state==="exhausted"?0:w.remainingPercent??NaN,reserved:0,resetAt:w.resetAt??"",periodSeconds:w.durationSeconds??undefined}))}))
 const unbilled=accounts.filter(a=>!a.billing).map(a=>a.id)
 if(unbilled.length)throw new Error("Dispatch policy must identify billing for connected accounts: "+unbilled.join(", "))
 const observedRoutes=policy.outcomesFile?measuredOutcomeRoutes(policy.routes,JSON.parse(readFileSync(isAbsolute(policy.outcomesFile)?policy.outcomesFile:join(dirname(input.policyFile),policy.outcomesFile),"utf8")) as MeasuredOutcomes).routes:policy.routes
 const routes=calibratedRoutes(observedRoutes,readCalibrations().calibrations,Object.fromEntries(snapshot.accounts.map(a=>[a.id,accountRegime(a)])),policy.calibration,now)
 const ledger=new RouteReservations(input.reservationFile),result=ledger.reserve(input.runID,{request:{...policy.request,now:new Date(now).toISOString(),explicitRouteID},routes,accounts})
 if(!result.reservation)throw new Error(result.decision?.summary+": "+result.decision?.excluded.map(x=>x.routeID+" "+x.reasons.join(", ")).join("; "))
 const route=policy.routes.find(r=>r.id===result.reservation!.routeID)
 if(!route)throw new Error("Reserved route was removed; reconcile the existing run before retrying")
 return {route,bootstrapByProject:policy.bootstrapByProject??{},ledger,decision:result.decision}
}
