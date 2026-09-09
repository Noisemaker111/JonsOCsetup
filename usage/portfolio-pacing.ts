import {getAccountUsage,ACCOUNT_USAGE_FILE} from "./account-api"
import {readQuotaObservations} from "./calibration-store"
import {renewUsageTargets} from "./usage-target"
import {updateBurnControls} from "./burn-control"
import type {AccountUsage} from "./account-types"
import type {Observation} from "./calibration"
import type {UsageTarget} from "./usage-target"
import {burnTargetKey,type BurnControl} from "./burn-control"
import {resetPlan} from "./reset-planner"

/** Separate subscription envelopes. Percentages and token prices never become a pooled balance. */
export function portfolioPacing(accounts:AccountUsage[],observations:Observation[],targets:UsageTarget[],controls:BurnControl[],now=Date.now()){
 if(!Number.isFinite(now))throw Error("Invalid portfolio clock")
 const subscriptions=accounts.map(account=>{
  const target=targets.find(t=>t.accountID===account.id),active=target&&target.deadlineAt>now
  const plans=resetPlan([account],observations,now,target?.reservePoints??0,active?target.deadlineAt:undefined)
  const shared=plans.filter(p=>p.scope==="shared"),focus=target?.pacing?shared.find(p=>p.windowID===target.pacing!.windowID):shared.filter(p=>p.state==="ready").sort((a,b)=>a.targetAt!-b.targetAt!)[0]
  const bindings=account.connections.flatMap(c=>c.routeProviders.map(providerID=>{
   const ids=[...new Set(accounts.filter(a=>a.connections.some(other=>other.routeProviders.includes(providerID)&&(!c.modelPrefix||!other.modelPrefix||c.modelPrefix===other.modelPrefix))).map(a=>a.id))]
   return {providerID,modelPrefix:c.modelPrefix,accountIDs:ids,state:ids.length===1?"unique-account-metadata":"ambiguous-account-selection"}
  }))
  const control=target?controls.find(c=>c.accountID===account.id&&c.targetKey===burnTargetKey(target)&&c.updatedAt<=now&&now-c.updatedAt<30000):undefined
  const constraints=shared.filter(p=>p.state!=="ready"||p.remainingPoints===0).map(p=>({windowID:p.windowID,reason:p.reason??"Shared allowance depleted"}))
  const mode=!target?.pacing?"monitor-only":target.followResets?"follow-observed-resets":"fixed-deadline"
  const state=mode==="monitor-only"?"monitor-only":constraints.length?"quota-constrained":!bindings.some(b=>b.state==="unique-account-metadata")?"account-selection-unverified":!control?"awaiting-controller":control.state
  return {accountID:account.id,identity:account.identity,provider:account.provider,plan:account.plan.name??account.plan.rateLimitTier??"unknown",mode,state,target:target??null,focus:focus??null,pools:plans,sharedConstraints:constraints,bindings,
   pacing:control?{desiredSlots:control.desiredConcurrency,ceiling:control.maxConcurrent,reason:control.reason,updatedAt:control.updatedAt}:null,
   requestedSlots:state==="ready"?control!.desiredConcurrency:0,
   projectedUnusedPoints:focus?.projectedUsedAtTarget==null?null:Math.max(0,100-focus.projectedUsedAtTarget-(target?.reservePoints??0)),
   targetBasis:target?target.followResets?"provider-observed reset with explicit renewal authorization":"user-supplied deadline":"provider-observed reset; no workload authorization"}
 }).sort((a,b)=>(a.focus?.targetAt??Infinity)-(b.focus?.targetAt??Infinity)||a.accountID.localeCompare(b.accountID))
 return {at:now,accounts:subscriptions,requestedSlots:subscriptions.reduce((n,a)=>n+a.requestedSlots,0),readyAccounts:subscriptions.filter(a=>a.state==="ready").length,
  limitations:["Each account and quota pool keeps its own balance, reset and measured pace; percentage points are never summed across accounts","Requested slots are feedback, not confirmed workers or guaranteed throughput","Connection metadata does not prove a configured route or a provider charge; ambiguous accounts require selectable verified routes","Existing billing, access, per-model limits, reservations and useful-work availability still govern admission"]}
}
export function portfolioPacingLines(portfolio:ReturnType<typeof portfolioPacing>){
 return ["Subscription portfolio: "+portfolio.requestedSlots+" requested slots across "+portfolio.readyAccounts+" ready account(s); balances stay separate",...portfolio.accounts.map(a=>a.provider+"/"+a.accountID.slice(-6)+" "+a.plan+": "+a.state+"; "+a.mode+(a.focus?.paceMultiplier==null?"":"; "+a.focus.paceMultiplier.toFixed(2)+"x current pace required")+(a.pacing?"; desired "+a.pacing.desiredSlots+"/"+a.pacing.ceiling:""))]
}

/** Small scheduler-facing status: no transcripts, request history, charts or coefficient matrices. */
export async function getUsagePacing(query:{refresh?:boolean;accountID?:string}={}){
 const snapshot=await getAccountUsage({refresh:query.refresh}),now=Date.now(),observations=readQuotaObservations(ACCOUNT_USAGE_FILE+".observations").observations
 const targets=renewUsageTargets(snapshot.accounts,now),controls=updateBurnControls(snapshot.accounts,observations,now,targets),portfolio=portfolioPacing(snapshot.accounts,observations,targets,controls,now)
 const accounts=portfolio.accounts.filter(a=>!query.accountID||a.accountID===query.accountID).map(a=>({accountID:a.accountID,provider:a.provider,plan:a.plan,state:a.state,mode:a.mode,requestedSlots:a.requestedSlots,pacing:a.pacing,targetBasis:a.targetBasis,
  deadlineAt:a.target?.deadlineAt??null,windowID:a.focus?.windowID??null,resetAt:a.focus?.resetAt??null,remainingPoints:a.focus?.remainingPoints??null,minutesToTarget:a.focus?.minutesToTarget??null,requiredPointsPerMinute:a.focus?.requiredPointsPerMinute??null,observedPointsPerMinute:a.focus?.observedPointsPerMinute??null,paceMultiplier:a.focus?.paceMultiplier??null,projectedUnusedPoints:a.projectedUnusedPoints,sharedConstraints:a.sharedConstraints,ambiguousBindings:a.bindings.filter(b=>b.state==="ambiguous-account-selection"),
  pools:a.pools.map(p=>({windowID:p.windowID,scope:p.scope,model:p.model??null,state:p.state,remainingPoints:p.remainingPoints,resetAt:p.resetAt,observedAt:p.observedAt,reason:p.reason}))}))
 return {at:now,accounts,requestedSlots:accounts.reduce((n,a)=>n+a.requestedSlots,0),workSupply:"Not observed here; requested slots are not confirmed workers",limitations:portfolio.limitations,diagnostics:snapshot.diagnostics}
}
