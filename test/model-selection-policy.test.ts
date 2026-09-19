/**
 * @core-prevents a prohibited reasoning effort reappearing through a route alias, a saved worker selector, or the final serialized native request
 * @core-observed The saved Luna-medium ban was unenforced: two runtime verification drivers hardcoded it and a curated Luna route omitted effort (2026-09-12).
 */
import {test,expect} from 'bun:test'
import {join} from 'node:path'
import {assertConfiguredSelection,assertRequestSelection,configuredAccess} from '../models/access-policy'
import {resolveDispatchSelector,type DispatchPolicy} from '../models/dispatch-planner'
import {resolveGoalRoute} from '../quest/goal-route'
import type {AccountSnapshot} from '../usage/account-types'
process.env.OPENCODE_ACCESS_POLICY=join(import.meta.dir,'../models/access-policy.json')
const policy=configuredAccess()
const luna={providerID:'openai',id:'gpt-5.6-luna'}
const request=(body:unknown)=>new Request('https://chatgpt.com/backend-api/codex/responses',{method:'POST',body:JSON.stringify(body)})

test('goal choices use connected accounts and preserve an ephemeral account/service pin on resume',()=>{
 const saved={request:{allowedRouteIDs:[]},routes:[]} as unknown as DispatchPolicy
 const account={id:'configured-account',provider:'openai',connections:[{routeProviders:['cliproxyapi']}]}
 const snapshot={accounts:[account]} as unknown as AccountSnapshot
 const selector='cliproxyapi/gpt-5.6-luna#max'
 const route=resolveGoalRoute(saved,snapshot,selector)
 expect(route.accountID).toBe(account.id)
 expect(route.reasoning).toBe('max')
 expect(resolveGoalRoute(saved,snapshot,'route:'+route.routeID,route)).toEqual(route)
 expect(()=>resolveGoalRoute(saved,{...snapshot,accounts:[{...account,id:'replacement-account'}]} as AccountSnapshot,'route:'+route.routeID,route)).toThrow('account/service route changed')
 expect(()=>resolveGoalRoute(saved,{...snapshot,accounts:[account,{...account,id:'another-account'}]} as AccountSnapshot,selector)).toThrow('Select an exact authorized route')
 expect(()=>resolveGoalRoute(saved,snapshot,'cliproxyapi/gpt-5.6-luna#medium')).toThrow('Select an exact authorized route')
 expect(()=>resolveGoalRoute(saved,snapshot,'route:'+route.routeID,{...route,serviceTier:'different-tier'})).toThrow('account/service route changed')
})
test('the user effort ban covers aliases and old configured selectors while preserving Astra medium',()=>{
 for(const model of [{...luna,variant:'medium'},{...luna,reasoning:'unknown'},{...luna,id:'gpt-5.6-luna-medium-fast',variant:'max'},{...luna}])expect(()=>assertConfiguredSelection(model,policy)).toThrow()
 expect(()=>assertConfiguredSelection({...luna,variant:'max'},policy)).not.toThrow()
 expect(()=>assertConfiguredSelection({providerID:'openai',id:'gpt-6-astra',reasoning:'medium'},policy)).not.toThrow()
 const route={id:'old-luna',providerID:'openai',modelID:luna.id,reasoning:'medium'}
 const saved={request:{allowedRouteIDs:[route.id]},routes:[route]} as DispatchPolicy
 for(const selector of ['route:old-luna','openai/gpt-5.6-luna#medium']){
  const result=resolveDispatchSelector(saved,selector)
  expect(result.code).toBe('MODEL_SELECTION_PROHIBITED');expect(result.route).toBeUndefined();expect(result.candidates).toEqual([])
 }
})
test('the outgoing payload cannot replace an allowed selection with medium or an implicit default',async()=>{
 const selected={...luna,variant:'max'}
 for(const body of [{model:luna.id,reasoning:{effort:'medium'}},{model:luna.id,reasoning_effort:'medium'},{model:luna.id}])await expect(assertRequestSelection(selected,request(body),policy)).rejects.toThrow()
 const req=request({model:luna.id,reasoning:{effort:'max'}})
 await assertRequestSelection(selected,req,policy)
 expect((await req.json()).reasoning.effort).toBe('max')
 await expect(assertRequestSelection({providerID:'openai',id:'gpt-6-astra',variant:'medium'},request({model:luna.id,reasoning_effort:'medium'}),policy)).rejects.toThrow()
})
