/**
 * @core-prevents automatic model selection treating token counts as prices, excluding an untried affordable route, or overriding an exact user choice
 * @core-observed On 2026-09-13 the routine reviewer used a high-effort frontier route while routing discarded catalog prices and ranked all previously used routes ahead of untried routes.
 */
import {test,expect} from "bun:test"
import {planRoutes,type Route,type RoutingRequest} from "../models/route-planner"
import {classifyDispatch,applyTaskDemand} from "../models/task-demand"
import {withRouteEconomics,accountPriceKey} from "../models/route-economics"
const now="2026-09-13T00:00:00Z"
const accounts=[{id:"user",billing:"subscription" as const,authenticated:true,observedAt:now,capacity:"available" as const,windows:[{id:"shared",remaining:60,reserved:0,resetAt:"2026-09-14T00:00:00Z"}]}]
const route=(id:string,score:number,amount?:number):Route=>({id,accountID:"user",providerID:"provider",modelID:id,harness:"native",reasoning:"high",serviceTier:"default",verified:true,admission:"benchmark-ranked",evidence:[],quotaPerTask:{},benchmark:{suite:"task-prior",passAt1:score,effort:"high",provenance:"independent",source:"test observation",measuredAt:now},...(amount===undefined?{}:{economics:{amount,currency:"USD",basis:"catalog-equivalent",source:"test quote",observedAt:now}})})
const request:RoutingRequest={task:"utility",now,minSuccessRate:.9,minTrials:5,qualityTolerance:.02,minBenchmarkPassAt1:.4,maxUsageAgeSeconds:120,maxEvidenceAgeDays:30,reserveFraction:0,subscriptionConcurrency:"unlimited",preference:"economy",qualitySelection:"floor",economyPriceTolerance:.25}
const choose=(routes:Route[],extra:Partial<RoutingRequest>={})=>planRoutes({request:{...request,...extra},accounts,routes})
test("qualified cheap routes compete without local history; unknown price is not free and quota still gates",()=>{
 const practiced=route("practiced",.8,10);practiced.evidence=[{task:"utility",source:"outcomes",measuredAt:now,trials:10,passed:10,totalMilliseconds:1000,p95Milliseconds:100,totalCash:10}]
 const routes=[practiced,route("affordable",.5,1),route("unknown",.9),route("incapable",.1,.01)]
 expect(choose(routes).selected?.routeID).toBe("affordable")
 expect(choose([route("unknown",.9)]).selected).toBeNull()
 expect(choose(routes,{explicitRouteID:"practiced"}).selected?.routeID).toBe("practiced")
 expect(planRoutes({request,accounts:[{...accounts[0],capacity:"exhausted"}],routes}).selected).toBeNull()
 expect(choose(routes.map(r=>({...r,verified:false}))).selected).toBeNull()
})
test("subscription attempts tolerate missing telemetry only under user policy; exhaustion and auth still gate",()=>{
 const routes=[route("subscription",.6,1)]
 const unknown={...accounts[0],capacity:"unknown" as const,observedAt:"",windows:[]}
 const permitted={...request,missingSubscriptionUsage:"attempt" as const}
 expect(planRoutes({request,accounts:[unknown],routes}).selected).toBeNull()
 const decision=planRoutes({request:permitted,accounts:[unknown],routes})
 expect(decision.selected?.routeID).toBe("subscription")
 expect(decision.selected?.expiryOpportunity).toBeNull()
 expect(decision.selected?.note).toContain("Capacity and task consumption remain unknown")
 for(const account of [{...unknown,authenticated:false},{...unknown,capacity:"exhausted" as const},{...unknown,windows:[{...accounts[0].windows[0],remaining:0}]},{...unknown,billing:"metered" as const}]) {
  expect(planRoutes({request:permitted,accounts:[account],routes}).selected).toBeNull()
 }
 expect(planRoutes({request:permitted,accounts:[unknown],routes:[{...routes[0],verified:false}]}).selected).toBeNull()
})

test("speed competes only within the user's price range; coding retains its stricter demand",()=>{
 const slow=route("slow",.6,1),fast=route("fast",.61,1.2),expensive=route("expensive",.8,10)
 slow.economics!.requestMilliseconds=5000;fast.economics!.requestMilliseconds=500;expensive.economics!.requestMilliseconds=1
 expect(choose([slow,fast,expensive]).selected?.routeID).toBe("fast")
 expect(choose([slow,fast,expensive],{economyPriceTolerance:0}).selected?.routeID).toBe("slow")
 expect(choose([slow,expensive],{qualitySelection:"near-best"}).selected?.routeID).toBe("expensive")
 expect(classifyDispatch({}).task).toBe("coding")
 expect(classifyDispatch({readOnly:true}).task).toBe("review")
 expect(()=>applyTaskDemand(request,{utility:{preference:"nonsense" as any}},"utility")).toThrow()
})
test("personal account pricing overrides exact-provider catalog quotes without alias or stale-price guessing",()=>{
 const r=route("model",.6),other={...r,id:"other",accountID:"other-user"}
 const catalog={models:[{providerID:"provider",modelID:"model",efforts:["high"],cost:{input:10,output:20}}],source:"cache" as const,at:now}
 const policy={useCatalogPrices:true,maxPriceAgeDays:7,minSpeedSamples:5,comparisonTokens:{input:1000,output:100,reasoning:0,cacheRead:0,cacheWrite:0},accountPrices:{[accountPriceKey(r)]:{version:"contract",provider:"provider",model:"model",date:now,currency:"USD",perMillion:{input:1,output:2}}}}
 const [personal,quoted]=withRouteEconomics([r,other],catalog,policy,Date.parse(now))
 expect(personal.economics?.amount).toBeCloseTo(.0012)
 expect(personal.economics?.basis).toBe("account-price")
 expect(quoted.economics?.amount).toBeCloseTo(.012)
 expect(quoted.economics?.basis).toBe("catalog-equivalent")
 expect(withRouteEconomics([{...r,providerID:"broker"}],catalog,policy,Date.parse(now))[0].economics).toBeUndefined()
 expect(withRouteEconomics([r],catalog,policy,Date.parse(now)+8*86400000)[0].economics).toBeUndefined()
})

test("task accounting includes failed attempts, deduplicates updates and never labels estimates as actual charges",async()=>{
 const {requestMetrics}=await import("../usage/request-metrics")
 const r={id:"request",sessionID:"session",route:{providerID:"provider",modelID:"model"},kind:"chat",startedAt:0,completedAt:2000,state:"completed" as const,tokens:{input:1000,cacheRead:0,cacheWrite:0,output:80,reasoning:20},price:{version:"recorded",provider:"provider",model:"model",date:now,currency:"USD",perMillion:{input:1,output:2,reasoning:2}}}
 const failed={...r,id:"retry",state:"failed" as const,startedAt:2000,completedAt:3000}
 const m=requestMetrics([r,r,failed])
 expect(m.requests).toBe(2)
 expect(m.cost[0].estimatedCost).toBeCloseTo(.0024)
 expect(m.cost[0].actualCharge).toBeNull()
 expect(m.speed.outputIncludingReasoningPerSecond).toBeCloseTo(200/3)
 const partial=requestMetrics([r,{...failed,price:undefined}])
 expect(partial.cost[0].estimatedCost).toBeNull()
 expect(partial.cost[0].estimateMissingRequests).toBe(1)
})


test("shared reviewer requests belong only to their task interval; incomplete support never becomes a complete task cost",async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path")
 const {beginWorkflowRun,observeWorkflowRun,recordWorkflowSupport,reportWorkflowOutcomes,readWorkflowOutcomes}=await import("../usage/workflow-outcomes")
 const dir=mkdtempSync(join(tmpdir(),"task-review-accounting-")),file=join(dir,"workflows.json"),requestsFile=join(dir,"requests.jsonl"),at=Date.parse(now)
 try{
  const identity={workflowID:"quest",stepID:"step",taskTags:["coding"],startedAt:at,route:{accountID:"account",providerID:"provider",modelID:"worker",reasoning:"high",harness:"native",version:"unknown",serviceTier:"default"}}
  for(const id of ["a","b"]){beginWorkflowRun(file,{...identity,runID:id,sessionID:id});observeWorkflowRun(file,{runID:id,observedAt:at+6000,completedAt:at+5000,state:"completed",tokens:{input:1,cacheRead:0,cacheWrite:0,output:1,reasoning:0},reviewMilliseconds:null,integrationMilliseconds:null})}
  recordWorkflowSupport(file,"a",{id:"review-a",role:"permission-review",sessionID:"shared",startedAt:at+1000,completedAt:at+2000})
  recordWorkflowSupport(file,"b",{id:"review-b",role:"permission-review",sessionID:"shared",startedAt:at+2000,completedAt:at+3000})
  expect(()=>recordWorkflowSupport(file,"b",{id:"review-a",role:"permission-review",sessionID:"shared",startedAt:at+1000})).toThrow()
  const request=(id:string,sessionID:string,offset:number)=>({id,sessionID,route:{providerID:"provider",modelID:sessionID==="shared"?"reviewer":"worker"},kind:"chat",startedAt:at+offset,completedAt:at+offset+100,state:"completed",tokens:{input:1,cacheRead:0,cacheWrite:0,output:1,reasoning:0},actualCharge:{currency:"USD",value:1}})
  const rows=[request("a","a",0),request("b","b",0),request("review-a","shared",1000),request("review-b","shared",2000),request("unrelated","shared",4000)]
  writeFileSync(requestsFile,rows.map(request=>JSON.stringify({version:1,request})).join("\n"))
  const report=reportWorkflowOutcomes(file,{now:at+10000,requestsFile})
  expect(report.runs.map(r=>[r.metrics.requests,r.supportMetrics.requests,r.taskMetrics.requests])).toEqual([[1,1,2],[1,1,2]])
  expect(report.matrix[0].costs[0].actualPerTask).toBe(2)
  expect(report.runs[0].metrics.cost[0].actualCharge).toBe(1)
  expect(readWorkflowOutcomes(file).runs[0].support?.[0].id).toBe("review-a")
  expect(()=>beginWorkflowRun(file,{...identity,runID:"a",sessionID:"a"})).not.toThrow()
  recordWorkflowSupport(file,"a",{id:"unfinished",role:"permission-review",sessionID:"shared",startedAt:at+4000})
  const incomplete=reportWorkflowOutcomes(file,{now:at+10000,requestsFile})
  expect(incomplete.runs[0].supportCoverage.unclosedReviews).toBe(1)
  expect(incomplete.matrix[0].costs[0].actualPerTask).toBeNull()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
