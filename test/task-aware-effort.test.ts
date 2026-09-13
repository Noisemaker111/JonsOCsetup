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
 expect(choose(routes,{explicitRouteID:"practiced"}).selected?.routeID).toBe("practiced")
 expect(planRoutes({request,accounts:[{...accounts[0],capacity:"exhausted"}],routes}).selected).toBeNull()
 expect(choose(routes.map(r=>({...r,verified:false}))).selected).toBeNull()
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
