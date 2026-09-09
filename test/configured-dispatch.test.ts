import {expect,test} from "bun:test"
import {mkdtempSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {planRoutes,type PlannerInput} from "../models/route-planner"
import {RouteReservations} from "../models/route-reservations"
import {policyFromConfiguredWorkers} from "../models/configured-dispatch"
import fixture from "./fixtures/routing-19h.json"
function choice(){const input=structuredClone(fixture) as PlannerInput;const route=input.routes[0];input.routes=[route];input.request.allowedRouteIDs=[route.id];input.request.primaryRouteID=route.id;route.admission="configured-choice";route.evidence=[];route.quotaPerTask={};return input}
test("configured exact choices report unknown measurements, without entering empirical ranking",()=>{
 const input=choice(),result=planRoutes(input)
 expect(result.selected?.routeID).toBe(input.routes[0].id);expect(result.selected?.successRate).toBeNull();expect(result.selected?.cashPerSuccess).toBeNull();expect(result.summary).toContain("uncalibrated")
 delete input.request.primaryRouteID;expect(planRoutes(input).selected).toBeNull()
 input.request.explicitRouteID=input.routes[0].id;expect(planRoutes(input).selected).not.toBeNull()
 input.accounts[0].windows[0].remaining=0;expect(planRoutes(input).selected).toBeNull()
})
test("configured choices still reject fresh measured regressions and metered work without a budget",()=>{
 const input=choice();input.routes[0].evidence=structuredClone(fixture.routes[0].evidence);input.routes[0].evidence[0].passed=1;expect(planRoutes(input).selected).toBeNull()
 input.routes[0].evidence=[];input.accounts[0].billing="metered";expect(planRoutes(input).excluded[0].reasons).toContain("configured metered choice requires a cash budget")
})
test("uncalibrated holds serialize the account, survive unknown outcomes, then require a newer observation",()=>{
 const root=mkdtempSync(join(tmpdir(),"configured-dispatch-"));try{
 const input=choice(),ledger=new RouteReservations(join(root,"holds.json")),account=input.accounts.find(a=>a.id===input.routes[0].accountID)!
 expect(ledger.reserve("a",input).reservation?.exclusive).toBe(true);expect(ledger.reserve("b",input).reservation).toBeNull()
 ledger.settle("a",{state:"unknown"});account.observedAt=new Date(Date.parse(input.request.now)+1000).toISOString();input.request.now=account.observedAt;expect(ledger.reserve("b",input).reservation).toBeNull()
 ledger.settle("a",{state:"settled",completedAt:input.request.now});expect(ledger.reserve("b",input).reservation).toBeNull()
 account.observedAt=new Date(Date.parse(input.request.now)+1000).toISOString();input.request.now=account.observedAt;expect(ledger.reserve("b",input).reservation).not.toBeNull()
 }finally{rmSync(root,{recursive:true,force:true})}
})
test("uncalibrated work cannot join a measured worker already using the same account",()=>{
 const root=mkdtempSync(join(tmpdir(),"configured-dispatch-"));try{const input=structuredClone(fixture) as PlannerInput;input.request.allowedRouteIDs=[input.routes[0].id];const ledger=new RouteReservations(join(root,"holds.json"));expect(ledger.reserve("measured",input).reservation).not.toBeNull();expect(ledger.reserve("unknown",choice()).reservation).toBeNull()}finally{rmSync(root,{recursive:true,force:true})}
})
test("migration preserves configured variants and leaves unspecified reasoning unknown",()=>{
 const snapshot:any={accounts:[{id:"account",provider:"openai",connections:[{routeProviders:["provider"],modelPrefix:null}]}]};const config={agents:{worker:{mode:"subagent",model:"provider/model"}},providers:{provider:{models:{model:{variants:[{id:"high"},{id:"max"}]}}}}}
 const policy=policyFromConfiguredWorkers(config,snapshot,{primaryAgent:"worker",agents:["worker"],billing:{account:"subscription"},bootstrapByProject:{}})
 expect(policy.routes.map(r=>r.reasoning)).toEqual(["unknown","high","max"]);expect(policy.routes.every(r=>r.evidence.length===0&&Object.keys(r.quotaPerTask).length===0)).toBe(true)
 expect(()=>policyFromConfiguredWorkers(config,{accounts:[...snapshot.accounts,...snapshot.accounts]} as any,{primaryAgent:"worker",agents:["worker"],billing:{account:"subscription"},bootstrapByProject:{}})).toThrow("unambiguous")
})
