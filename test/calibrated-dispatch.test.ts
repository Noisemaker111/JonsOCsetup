import {test,expect} from "bun:test"
import {calibratedRoutes} from "../models/calibrated-dispatch"
import {routeKey} from "../usage/calibration"
const route:any={id:"r",accountID:"a",providerID:"p",modelID:"m",harness:"native",reasoning:"high",serviceTier:"default",quotaPerTask:{weekly:1}}
const tokens={input:100,cacheRead:0,cacheWrite:0,output:10,reasoning:0}
const fit:any={version:"synthetic",accountID:"a",windowID:"weekly",regime:"plan",routeKey:routeKey({route:{providerID:"p",modelID:"m",reasoning:"high",variant:"high",harness:"native"}} as any),trainedAt:900,weights:[0.01,0,0,0.1],state:"validated",identifiable:true,validation:{upperErrorPoints:0.2}}
test("dispatch reserves the calibrated upper bound without weakening configured reserves",()=>{const policy={maxAgeMilliseconds:1000,tokensByRoute:{r:tokens}};const selected=calibratedRoutes([route],[fit],{a:"plan"},policy,1000)[0];expect(selected.quotaPerTask.weekly).toBeCloseTo(2.2);expect(route.quotaPerTask.weekly).toBe(1);expect(calibratedRoutes([{...route,quotaPerTask:{weekly:3}}],[fit],{a:"plan"},policy,1000)[0].quotaPerTask.weekly).toBe(3)})
test("stale, drifted, mismatched routes and account plans cannot supply a calibrated forecast",()=>{const policy={maxAgeMilliseconds:1000,tokensByRoute:{r:tokens}};for(const bad of [{...fit,state:"drift"},{...fit,trainedAt:1},{...fit,regime:"other"},{...fit,routeKey:"other"}])expect(calibratedRoutes([route],[bad],{a:"plan"},policy,2000)[0].quotaPerTask.weekly).toBe(1)})
