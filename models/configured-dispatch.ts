import { accountsForRoute } from "../usage/account-api"
import type { AccountSnapshot } from "../usage/account-types"
import type { DispatchPolicy } from "./dispatch-planner"
/** Convert existing worker settings; callers supply the personal default, never the planner. */
export function policyFromConfiguredWorkers(config:any,snapshot:AccountSnapshot,input:{primaryAgent:string;agents:string[];billing:DispatchPolicy["billing"];bootstrapByProject:DispatchPolicy["bootstrapByProject"]}):DispatchPolicy {
 const routes:DispatchPolicy["routes"]=[]
 for(const agent of input.agents){
  const worker=config.agents?.[agent],identity=worker?.model
  if(!["subagent","all"].includes(worker?.mode)||typeof identity!=="string")throw new Error("Configured worker has no exact model: "+agent)
  const slash=identity.indexOf("/"),providerID=identity.slice(0,slash),modelID=identity.slice(slash+1),model=config.providers?.[providerID]?.models?.[modelID]
  if(slash<1||!model)throw new Error("Configured worker model is absent from the provider catalog: "+agent)
  const accounts=accountsForRoute(snapshot,providerID,modelID)
  if(accounts.length!==1)throw new Error("Configured worker requires one unambiguous connected account: "+agent)
  const accountID=accounts[0].id
  if(!input.billing[accountID])throw new Error("Billing arrangement is unknown for configured worker: "+agent)
  const variants=(Array.isArray(model.variants)?model.variants.map((v:any)=>v.id):Object.keys(model.variants??{})).filter((v:any)=>typeof v==="string"&&v)
  const effort=model.settings?.reasoningEffort
  const choices=[...new Set([typeof effort==="string"?effort:"unknown",...variants])]
  for(const reasoning of choices)routes.push({id:agent+"-"+reasoning,accountID,providerID,modelID,harness:"native",agent,reasoning,serviceTier:"default",verified:true,admission:"configured-choice",evidence:[],quotaPerTask:{}})
 }
 const primary=routes.find(r=>r.agent===input.primaryAgent)
 if(!primary)throw new Error("The configured primary worker is not in the supplied worker list")
 return {version:1,request:{task:"coding",minSuccessRate:0.9,minTrials:5,qualityTolerance:0.02,maxUsageAgeSeconds:120,maxEvidenceAgeDays:30,reserveFraction:0,primaryRouteID:primary.id,allowedRouteIDs:routes.map(r=>r.id)},routes,billing:input.billing,bootstrapByProject:input.bootstrapByProject}
}
