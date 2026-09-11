import {measuredOutcomeRoutes,type MeasuredOutcomes} from "./measured-outcomes"
import {join,dirname,isAbsolute} from "node:path"
import { calibratedRoutes,type DispatchForecasts } from "./calibrated-dispatch"
import { readCalibrations,accountRegime,updateBurnControls,readQuotaObservations } from "../usage/telemetry-api"
import { assertConfiguredModel } from "./access-policy"
import { accountsForRoute, relevantAccountWindows } from "../usage/account-api"
import { liveDispatchRoutes } from "./live-routes"
import { recordedRouteCosts, withRecordedCosts } from "./route-cost"
import { applyTaskDemand, classifyDispatch, describeDemand, validateTaskDemands, type DispatchFacts, type TaskDemands } from "./task-demand"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import type { AccountSnapshot } from "../usage/account-types"
import { getAccountUsage, ACCOUNT_USAGE_FILE } from "../usage/account-api"
import { RouteReservations } from "./route-reservations"
import type { PlannerInput,Route,RoutingRequest } from "./route-planner"
/** A promoted generation must read the policy promoted with its planner, not mutable root source. */
export const configuredDispatchPolicyFile=()=>process.env.OPENCODE_DISPATCH_POLICY??join(import.meta.dir,"dispatch-policy.json")
/** Explicit fixture/host pin keeps isolated Quest storage on shared atomic account admission. */
export function dispatchReservationFile(runtimeRoot:string){const pin=process.env.OPENCODE_ROUTE_RESERVATIONS;if(pin&&!isAbsolute(pin))throw new Error('OPENCODE_ROUTE_RESERVATIONS must be absolute');return pin??join(runtimeRoot,'route-reservations.json')}
export type DispatchPolicy = { version:1; outcomesFile?:string; calibration?:DispatchForecasts; request:Omit<RoutingRequest,"now"|"explicitRouteID">&{byTask?:TaskDemands}; routes:Route[]; billing:Record<string,PlannerInput["accounts"][number]["billing"]>; bootstrapByProject:Record<string,string[]>; commandsByProject?:Record<string,Record<string,import("../quest/command-runtime").CommandSpec>> }
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
/** A route that answered an error when probed is not a candidate, however much quota it holds.
 *  Health is recorded per probed route id, but the thing that failed is the model behind it:
 *  a derived candidate on the same provider/model is the same broken call, under a new name. */
export function unusableRoutes(maxAgeMs = 6 * 60 * 60 * 1000, now = Date.now()) {
  const file = process.env.OPENCODE_ROUTE_HEALTH ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "route-health.json")
  const byRoute = new Map<string, string>(), byModel = new Map<string, string>()
  try {
    const health = JSON.parse(readFileSync(file, "utf8"))
    const at = Date.parse(health?.at)
    // Stale health is not evidence of breakage; a route recovers without anyone rewriting the file.
    if (Number.isFinite(at) && now - at <= maxAgeMs) for (const row of health.results ?? []) {
      if (row?.state !== "unusable") continue
      const reason = String(row.reason ?? "probe failed")
      if (row.routeID) byRoute.set(row.routeID, reason)
      if (row.model) byModel.set(String(row.model), reason)
    }
  } catch {}
  return { byRoute, byModel }
}

/**
 * Everything a dispatch ranks, assembled from live inputs.
 *
 * `reserveDispatch` and `scripts/route-plan.ts dispatch` both go through here so the plan a person
 * can print is the plan a worker is actually launched on, rather than a second implementation of
 * the same join that drifts from it.
 */
export async function dispatchPlanInput(input:{model?:string;policyFile:string;now?:number}&DispatchFacts,loadUsage:typeof getAccountUsage=getAccountUsage) {
 let policy:DispatchPolicy
 try{policy=JSON.parse(readFileSync(input.policyFile,"utf8"))}catch{throw new Error("Configure the dispatch policy with authorized routes, quality evidence, budgets and project bootstrap before running a Quest")}
 if(policy.version!==1||!Array.isArray(policy.routes)||!policy.request?.allowedRouteIDs?.length)throw new Error("Invalid dispatch policy: version 1 and an explicit route allowlist are required")
 validateTaskDemands(policy.request.byTask)
 const snapshot=await loadUsage({refresh:true}),now=input.now??Date.now()
 // The policy file no longer decides which models exist. It contributes curated routes, the
 // billing arrangements and the thresholds; the rest of the candidate pool is joined live from
 // the models.dev catalog, the access policy, the connected accounts and benchmarks.md.
 const live=await liveDispatchRoutes(policy,snapshot,now)
 policy.routes=[...live.curated,...live.derived]
 const allowed=[...new Set([...(policy.request.allowedRouteIDs??[]),...live.derived.map(r=>r.id)])]
 // What kind of work this is, and therefore how much published accuracy it may trade for a cheaper
 // effort. The class is resolved from the dispatch itself, never from the policy file, and an
 // unclassified dispatch lands on the same demand every dispatch already ran under.
 const classification=classifyDispatch(input)
 policy.request={...applyTaskDemand(policy.request,policy.request.byTask,classification.task),allowedRouteIDs:allowed}
 // A configured default still wins while it is admissible. Everything else it can fall back to is
 // now whatever is live and ranked, instead of a second list somebody had to keep in step.
 const alternatives=allowed.filter(id=>id!==policy.request.primaryRouteID)
 if(policy.request.primaryRouteID&&alternatives.length)policy.request={...policy.request,fallback:{when:"admission-unavailable",routeIDs:alternatives}}
 let explicitRouteID:string|undefined
 if(input.model){
  const result=resolveDispatchSelector(policy,input.model,snapshot)
  if(!result.route)throw new Error(result.code+': explicit model must resolve to one account/reasoning/service route the access policy permits on a single connected account; use project_route_status candidates, no replacement selected')
  explicitRouteID=result.route.id
  // The chosen route competes as itself. A curated pool orders automatic picks; it never vetoes an explicit choice.
  if(!policy.routes.some(r=>r.id===explicitRouteID))policy.routes=[...policy.routes,result.route]
  if(!(policy.request.allowedRouteIDs??[]).includes(explicitRouteID))policy.request={...policy.request,allowedRouteIDs:[...(policy.request.allowedRouteIDs??[]),explicitRouteID]}
 }
 const unusable=unusableRoutes()
 policy.routes=policy.routes.map(route=>{const probed=unusable.byRoute.get(route.id)??unusable.byModel.get(route.providerID+"/"+route.modelID);return probed?{...route,verified:false,outcomeIssue:{task:policy.request.task,reason:"Probed unusable: "+probed.slice(0,160)}}:route})
 policy.routes=policy.routes.map(route=>{if(route.admission)assertConfiguredModel({providerID:route.providerID,id:route.modelID});const linked=accountsForRoute(snapshot,route.providerID,route.modelID);return linked.length===1&&linked[0].id===route.accountID?route:{...route,verified:false}})
 const pacing=updateBurnControls(snapshot.accounts,readQuotaObservations(ACCOUNT_USAGE_FILE+".observations").observations,now)
 const accounts:PlannerInput["accounts"]=snapshot.accounts.filter(a=>policy.routes.some(r=>r.accountID===a.id)).map(a=>({id:a.id,pacing:pacing.find(p=>p.accountID===a.id),billing:policy.billing[a.id],authenticated:a.state!=="auth-required"&&a.connections.length>0,observedAt:a.observedAt??"",capacity:a.state==="available"?"available":a.state==="exhausted"?"exhausted":"unknown",windows:a.windows.filter(w=>(w.scope==="shared"||w.scope==="model")&&!(w.state==="available"&&(w.remainingPercent==null||!w.resetAt))).map(w=>({id:w.id,...(w.scope==="model"?{routeIDs:policy.routes.filter(r=>r.accountID===a.id&&relevantAccountWindows(a,r.modelID).includes(w)).map(r=>r.id)}:{}),remaining:w.state==="unknown"?NaN:w.state==="exhausted"?0:w.remainingPercent??NaN,reserved:0,resetAt:w.resetAt??"",periodSeconds:w.durationSeconds??undefined}))}))
 const unbilled=accounts.filter(a=>!a.billing).map(a=>a.id)
 if(unbilled.length)throw new Error("Dispatch policy must identify billing for connected accounts: "+unbilled.join(", "))
 const observedRoutes=policy.outcomesFile?measuredOutcomeRoutes(policy.routes,JSON.parse(readFileSync(isAbsolute(policy.outcomesFile)?policy.outcomesFile:join(dirname(input.policyFile),policy.outcomesFile),"utf8")) as MeasuredOutcomes).routes:policy.routes
 // Recorded per-effort consumption from the host's own request records. It orders the routes that
 // already cleared the quality demand; it never admits or excludes one, so an unreadable database
 // is not a dispatch failure.
 const recorded=recordedRouteCosts({now})
 const routes=withRecordedCosts(calibratedRoutes(observedRoutes,readCalibrations().calibrations,Object.fromEntries(snapshot.accounts.map(a=>[a.id,accountRegime(a)])),policy.calibration,now),recorded.costs)
 const request={...policy.request,now:new Date(now).toISOString(),explicitRouteID}
 const diagnostics=[...live.diagnostics,describeDemand(classification,request),
  recorded.source==="unavailable"?"recorded route cost unavailable ("+recorded.error+"); efforts rank on the published board alone"
  :"recorded route cost for "+Object.keys(recorded.costs).length+" route identities ("+recorded.source+")"]
 return {policy,request,routes,accounts,snapshot,live,classification,diagnostics,explicitRouteID}
}

/** User policy supplies routes and thresholds; live balances replace offline snapshots. */
export async function reserveDispatch(input:{runID:string;model?:string;policyFile:string;reservationFile:string;now?:number}&DispatchFacts,loadUsage:typeof getAccountUsage=getAccountUsage) {
 const plan=await dispatchPlanInput(input,loadUsage)
 const ledger=new RouteReservations(input.reservationFile),result=ledger.reserve(input.runID,{request:plan.request,routes:plan.routes,accounts:plan.accounts})
 if(!result.reservation)throw new Error(result.decision?.summary+": "+result.decision?.excluded.map(x=>x.routeID+" "+x.reasons.join(", ")).join("; ")+" | candidates: "+plan.diagnostics.join(" | "))
 const route=plan.policy.routes.find(r=>r.id===result.reservation!.routeID)
 if(!route)throw new Error("Reserved route was removed; reconcile the existing run before retrying")
 const decision=result.decision?{...result.decision,summary:result.decision.summary+"; "+describeDemand(plan.classification,plan.request)}:result.decision
 return {route,bootstrapByProject:plan.policy.bootstrapByProject??{},ledger,decision,classification:plan.classification,candidates:{derived:plan.live.derived.length,curated:plan.live.curated.length,catalog:plan.live.catalog.source,diagnostics:plan.diagnostics}}
}
