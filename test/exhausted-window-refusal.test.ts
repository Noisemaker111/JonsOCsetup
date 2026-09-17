/**
 * @core-prevents Quest dispatch admitting a route whose target subscription window is exhausted, or refusing it without naming the account, window and reset
 * @core-observed On 2026-09-16 claude-8ca596da07b766ac72c8's five_hour window was exhausted (used 100%, reset 2026-09-17T01:30Z) while six workers were dispatched onto route:proxy-claude-unknown and later refusals said only "insufficient unreserved quota in five_hour".
 */
import {test,expect} from "bun:test"
import {planRoutes,type Account,type QuotaWindow,type Route,type RoutingRequest} from "../models/route-planner"
const now="2026-09-16T22:30:00Z"
const fiveHourReset="2026-09-17T01:30:00Z"
const window=(id:string,remaining:number,resetAt:string,state:QuotaWindow["state"]="available"):QuotaWindow=>({id,remaining,resetAt,reserved:0,state})
const accounts:Account[]=[
  {id:"claude-8ca596da07b766ac72c8",billing:"subscription",authenticated:true,observedAt:"2026-09-16T22:29:30Z",capacity:"unknown",windows:[window("five_hour",0,fiveHourReset,"exhausted"),window("seven_day",45,"2026-09-19T21:59:59Z")]},
  {id:"funded-account",billing:"subscription",authenticated:true,observedAt:"2026-09-16T22:29:30Z",capacity:"available",windows:[window("rolling",90,"2026-09-16T23:30:00Z")]},
]
const configured=(id:string,accountID:string):Route=>({id,accountID,providerID:"provider",modelID:id,harness:"native",reasoning:"high",serviceTier:"default",verified:true,admission:"configured-choice",evidence:[],quotaPerTask:{}})
const routes=[configured("exhausted-route","claude-8ca596da07b766ac72c8"),configured("funded-route","funded-account")]
// The saved policy shape at the incident: attempts are permitted when telemetry is missing and a
// subscription account carries no fixed concurrency cap. Neither may waive a known exhausted window.
const request:RoutingRequest={task:"coding",now,minSuccessRate:.9,minTrials:5,qualityTolerance:.02,maxUsageAgeSeconds:120,maxEvidenceAgeDays:30,reserveFraction:0,subscriptionConcurrency:"unlimited",missingSubscriptionUsage:"attempt",allowedRouteIDs:["exhausted-route","funded-route"]}
test("an exhausted subscription window refuses its route by name and leaves the funded route usable",()=>{
  const refused=planRoutes({request:{...request,explicitRouteID:"exhausted-route"},accounts,routes})
  expect(refused.selected).toBeNull()
  const reasons=refused.excluded.find(x=>x.routeID==="exhausted-route")!.reasons.join("; ")
  expect(reasons).toContain("claude-8ca596da07b766ac72c8") // the account
  expect(reasons).toContain("five_hour")                    // the window
  expect(reasons).toContain(fiveHourReset)                  // its reset
  const automatic=planRoutes({request,accounts,routes})
  expect(automatic.selected?.routeID).toBe("funded-route")
  const named=planRoutes({request:{...request,explicitRouteID:"funded-route"},accounts,routes})
  expect(named.selected?.routeID).toBe("funded-route")
})
test("a provider-reported exhausted window vetoes even when its remaining reading is missing",()=>{
  const blind={...accounts[0],windows:[{...accounts[0].windows[0],remaining:NaN}]}
  const decision=planRoutes({request:{...request,explicitRouteID:"exhausted-route"},accounts:[blind,accounts[1]],routes})
  expect(decision.selected).toBeNull()
  expect(decision.excluded.find(x=>x.routeID==="exhausted-route")!.reasons.join("; ")).toContain("allowance is exhausted")
})
