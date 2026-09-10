import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RouteReservations } from "../models/route-reservations"
import type { PlannerInput } from "../models/route-planner"
import fixture from "./fixtures/routing-19h.json"
test("reservations share account windows, survive retries, and await fresh settlement", () => {
  const root = mkdtempSync(join(tmpdir(), "route-reserve-"))
  try {
    const input = structuredClone(fixture) as PlannerInput
    const route = input.routes[0], account = input.accounts.find(a => a.id === route.accountID)!
    input.request.allowedRouteIDs = [route.id]; input.request.reserveFraction = 0
    for (const window of account.windows) window.remaining = route.quotaPerTask[window.id]
    const first = new RouteReservations(join(root, "reservations.json")), second = new RouteReservations(join(root, "reservations.json"))
    expect(first.reserve("a", input).reservation?.routeID).toBe(route.id)
    expect(second.reserve("a", input).decision).toBeNull()
    expect(second.reserve("b", input).reservation).toBeNull()
    first.settle("a", { state: "unknown" })
    expect(second.reserve("b", input).reservation).toBeNull()
    first.settle("a", { state: "settled", completedAt: input.request.now })
    expect(first.settle("a",{state:"unknown"}).state).toBe("settled")
    expect(first.settle("a",{state:"cancelled"}).state).toBe("settled")
    expect(second.reserve("b", input).reservation).toBeNull()
    const later = new Date(Date.parse(input.request.now) + 1000).toISOString()
    input.request.now = later; account.observedAt = later
    expect(second.reserve("b", input).reservation).toBeNull()
    first.settle("a", { state: "settled", completedAt: fixture.request.now, accountedAt: later })
    expect(second.reserve("b", input).reservation?.routeID).toBe(route.id)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("settled work stops reserving a reset window, while unknown work retains its hold",()=>{
 const root=mkdtempSync(join(tmpdir(),"route-reserve-"));try{const input=structuredClone(fixture) as PlannerInput,route=input.routes[0],account=input.accounts.find(a=>a.id===route.accountID)!;input.request.allowedRouteIDs=[route.id];input.request.reserveFraction=0;const window=account.windows[0];account.windows=[window];route.quotaPerTask={[window.id]:1};window.remaining=1;const ledger=new RouteReservations(join(root,"reservations.json"));expect(ledger.reserve("a",input).reservation).not.toBeNull();ledger.settle("a",{state:"settled",completedAt:input.request.now});const reset=Date.parse(window.resetAt);input.request.now=new Date(reset+1000).toISOString();account.observedAt=input.request.now;window.resetAt=new Date(reset+86400000).toISOString();expect(ledger.reserve("b",input).reservation).not.toBeNull();ledger.settle("b",{state:"unknown"});expect(ledger.reserve("c",input).reservation).toBeNull()}finally{rmSync(root,{recursive:true,force:true})}
})

test("concurrent cash holds survive unknown outcomes and reconcile only observed charges",()=>{
 const root=mkdtempSync(join(tmpdir(),"route-cash-"));try{const input=structuredClone(fixture) as PlannerInput,route=input.routes[0];input.request.allowedRouteIDs=[route.id];input.request.reserveFraction=0;route.cashReservation={currency:"USD",upperBound:6};input.request.cashBudget={id:"budget",currency:"USD",limit:10,spent:0,startsAt:new Date(Date.parse(input.request.now)-1000).toISOString(),endsAt:new Date(Date.parse(input.request.now)+3600000).toISOString()};const ledger=new RouteReservations(join(root,"reservations.json"));expect(ledger.reserve("a",input).reservation?.cash?.value).toBe(6);expect(ledger.reserve("b",input).decision?.excluded[0].reasons).toContain("insufficient unreserved cash budget");ledger.settle("a",{state:"unknown"});expect(ledger.reserve("b",input).reservation).toBeNull();ledger.settle("a",{state:"settled",completedAt:input.request.now,cash:{currency:"USD",value:3}});expect(ledger.reserve("b",input).reservation?.cash?.value).toBe(6);ledger.settle("b",{state:"cancelled"});expect(ledger.reserve("c",input).reservation).not.toBeNull()
 }finally{rmSync(root,{recursive:true,force:true})}
})
test("an exact model is not replaced when its cash budget cannot fund it",()=>{
 const root=mkdtempSync(join(tmpdir(),"route-cash-"));try{const input=structuredClone(fixture) as PlannerInput;input.request.allowedRouteIDs=input.routes.map(r=>r.id);input.request.explicitRouteID=input.routes[0].id;input.request.cashBudget={id:"b",currency:"USD",limit:0,spent:0,startsAt:new Date(Date.parse(input.request.now)-1000).toISOString(),endsAt:new Date(Date.parse(input.request.now)+10000).toISOString()};input.routes[0].cashReservation={currency:"USD",upperBound:1};expect(new RouteReservations(join(root,"r.json")).reserve("r",input).reservation).toBeNull()}finally{rmSync(root,{recursive:true,force:true})}
})

test("configured fallback is admitted atomically and recorded on the reservation",()=>{
 const root=mkdtempSync(join(tmpdir(),"fallback-reserve-"));try{const value=structuredClone(fixture) as PlannerInput,primary=value.routes[0],next=value.routes[1];value.request.allowedRouteIDs=[primary.id,next.id];value.request.primaryRouteID=primary.id;value.request.fallback={when:"admission-unavailable",routeIDs:[next.id]};value.accounts.find(a=>a.id===primary.accountID)!.capacity="exhausted";const ledger=new RouteReservations(join(root,"routes.json")),result=ledger.reserve("run",value);expect(result.reservation?.routeID).toBe(next.id);expect(result.reservation?.reason).toContain("Configured fallback");expect(ledger.reserve("run",value).decision).toBeNull()}finally{rmSync(root,{recursive:true,force:true})}
})

test("duplicate settlement retains first completion boundary",()=>{const dir=mkdtempSync(join(tmpdir(),"settle-once-"));try{const file=join(dir,"holds.json");writeFileSync(file,JSON.stringify({version:1,reservations:[{runID:"r",routeID:"r",accountID:"a",windows:{},state:"active",reason:"fixture"}]}));const ledger=new RouteReservations(file);ledger.settle("r",{state:"settled",completedAt:"2026-09-06T10:00:00Z"});ledger.settle("r",{state:"settled",completedAt:"2026-09-06T10:01:00Z"});expect(ledger.get("r")?.completedAt).toBe("2026-09-06T10:00:00Z")}finally{rmSync(dir,{recursive:true,force:true})}})

 test('uncalibrated hold needs a terminal outcome and a newer quota observation',()=>{
 const root=mkdtempSync(join(tmpdir(),'route-uncalibrated-'))
 try{
  const input=structuredClone(fixture) as PlannerInput,route=input.routes[0],account=input.accounts.find(a=>a.id===route.accountID)!
  input.request.allowedRouteIDs=[route.id];input.request.explicitRouteID=route.id;route.admission='configured-choice';route.quotaPerTask={};account.windows.forEach(w=>w.remaining=80)
  const ledger=new RouteReservations(join(root,'reservations.json'))
  expect(ledger.reserve('existing',input).reservation?.exclusive).toBe(true)
  expect(ledger.reserve('next',input).decision?.excluded.flatMap(r=>r.reasons).join(' ')).toContain('outcome active')
  ledger.settle('existing',{state:'settled',completedAt:input.request.now})
  expect(ledger.reserve('next',input).decision?.excluded.flatMap(r=>r.reasons).join(' ')).toContain('terminal outcome confirmed')
  account.observedAt=new Date(Date.parse(input.request.now)+1000).toISOString();input.request.now=account.observedAt
  expect(ledger.reserve('next',input).reservation?.runID).toBe('next')
  expect(ledger.reserve('next',input).decision).toBeNull()
 }finally{rmSync(root,{recursive:true,force:true})}
 })

test('explicit unlimited subscription policy admits independent runs without changing uncertain ownership',()=>{
 const root=mkdtempSync(join(tmpdir(),'route-unlimited-'))
 try{
  const input=structuredClone(fixture) as PlannerInput,route=input.routes[0],account=input.accounts.find(a=>a.id===route.accountID)!
  input.request.allowedRouteIDs=[route.id];input.request.explicitRouteID=route.id;route.admission='configured-choice';route.quotaPerTask={};route.evidence=[]
  account.billing='subscription';account.windows.forEach(w=>w.remaining=80)
  const ledger=new RouteReservations(join(root,'reservations.json'))
  expect(ledger.reserve('older',input).reservation?.exclusive).toBe(true)
  ledger.settle('older',{state:'unknown'})
  const old=ledger.get('older')
  input.request.subscriptionConcurrency='unlimited'
  for(let n=0;n<32;n++){
   const next=new RouteReservations(ledger.file).reserve('independent-'+n,input)
   expect(next.reservation?.routeID).toBe(route.id)
   expect(next.reservation?.exclusive).toBe(false)
   expect(next.reservation?.windows).toEqual({})
   expect(next.decision?.summary).toContain('without a fixed account cap')
  }
  expect(ledger.get('older')).toEqual(old)
  expect(ledger.reserve('older',input)).toEqual({reservation:old,decision:null})
  expect(ledger.reserve('independent-31',input).decision).toBeNull()
  account.capacity='exhausted'
  expect(ledger.reserve('exhausted',input).decision?.excluded[0].reasons).toContain('account capacity is exhausted')
  account.capacity='available';account.authenticated=false
  expect(ledger.reserve('unauthenticated',input).decision?.excluded[0].reasons).toContain('account is not authenticated')
  account.authenticated=true;account.observedAt=new Date(Date.parse(input.request.now)-input.request.maxUsageAgeSeconds*1000).toISOString()
  expect(ledger.reserve('stale',input).decision?.excluded[0].reasons).toContain('usage observation is stale or invalid')
  account.observedAt=input.request.now;account.windows.forEach(w=>w.remaining=0)
  expect(ledger.reserve('empty',input).decision?.excluded[0].reasons.some(r=>r.includes('insufficient unreserved quota'))).toBe(true)
  account.windows.forEach(w=>w.remaining=80);account.billing='metered'
  expect(ledger.reserve('paid',input).decision?.excluded[0].reasons).toContain('configured metered choice requires a cash budget')
  input.request.subscriptionConcurrency='typo' as any
  expect(()=>ledger.reserve('invalid',input)).toThrow('Invalid subscription concurrency policy')
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('unlimited subscription concurrency preserves calibrated quota reservations and explicit stop controls',()=>{
 const root=mkdtempSync(join(tmpdir(),'route-unlimited-calibrated-'))
 try{
  const input=structuredClone(fixture) as PlannerInput,route=input.routes[0],account=input.accounts.find(a=>a.id===route.accountID)!
  input.request.allowedRouteIDs=[route.id];input.request.explicitRouteID=route.id;input.request.reserveFraction=0;input.request.subscriptionConcurrency='unlimited';account.billing='subscription'
  for(const w of account.windows)w.remaining=route.quotaPerTask[w.id]
  const ledger=new RouteReservations(join(root,'reservations.json'))
  expect(ledger.reserve('first',input).reservation).not.toBeNull()
  ledger.settle('first',{state:'unknown'})
  expect(ledger.reserve('second',input).decision?.excluded[0].reasons.some(r=>r.includes('insufficient unreserved quota'))).toBe(true)
  route.quotaPerTask={};route.admission='configured-choice';route.evidence=[];account.windows.forEach(w=>w.remaining=80)
  const now=Date.parse(input.request.now)
  account.pacing={state:'ready',desiredConcurrency:1,updatedAt:now,deadlineAt:now+60000,reason:'Scoped pacing'}
  expect(ledger.reserve('concurrent',input).reservation).not.toBeNull()
  account.pacing.deadlineAt=now-1
  expect(ledger.reserve('past-advisory-deadline',input).reservation).not.toBeNull()
  account.pacing.state='stopped';account.pacing.reason='User stopped this burn target'
  expect(ledger.reserve('stopped',input).decision?.excluded[0].reasons).toContain('Burn pacing stopped: User stopped this burn target')
 }finally{rmSync(root,{recursive:true,force:true})}
})
