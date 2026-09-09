import {readRequests} from "./telemetry-store"
import {sessionTokenLine} from "./session-count"
import {readAccountUsage,ACCOUNT_USAGE_FILE} from "./account-api"
import {readQuotaObservations} from "./calibration-store"
import {readUsageTargets} from "./usage-target"
import {resetPlan} from "./reset-planner"
/** Cached feedback on every turn; never probes a provider or scans rollouts on the prompt path. */
export function usageContextLine(sessionID:string,now=Date.now()) {
 const session=sessionTokenLine(readRequests().records,sessionID),targets=readUsageTargets().filter(t=>t.deadlineAt>now),accounts=readAccountUsage(),observations=readQuotaObservations(ACCOUNT_USAGE_FILE+".observations").observations
 const plans=accounts.accounts.flatMap(a=>{const target=targets.find(t=>t.accountID===a.id);return target?resetPlan([a],observations,now,target.reservePoints,target.deadlineAt).filter(p=>p.scope==="shared"):[]})
 const text=[session,...plans.slice(0,4).map(p=>`${p.provider} ${p.label}: ${p.state==="ready"?`${p.spendablePoints?.toFixed(2)} points available; target ${p.requiredPointsPerMinute?.toFixed(3)} points/min until ${new Date(p.targetAt!).toISOString()}; estimated cap ${p.forecast?.projectedExhaustionAt?new Date(p.forecast.projectedExhaustionAt).toISOString():"unresolved before reset"}`:"refresh required"}`),"usage_status(format=json) has measured coverage, pending counters, quota intervals and forecast assumptions; usage_target saves the deadline. Estimates are not exact charges."].join("\n")
 return text.length>1400?text.slice(0,1360)+"… usage_status(format=json)":text
}
export async function installUsageContext(ctx:any) {
 if(typeof ctx.session?.hook!=="function")return false
 await ctx.session.hook("context",(event:any)=>{if(!event.sessionID||!Array.isArray(event.system))return;try{event.system.push({ type: "text", text:usageContextLine(event.sessionID)})}catch{event.system.push({ type: "text", text:"Usage accounting is unavailable; query usage_status before making a burn forecast."})}})
 return true
}
