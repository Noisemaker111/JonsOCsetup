import {expect,test} from "bun:test"
import {evaluateTrials,type Trial} from "../bench/evaluation"
import type {RequestRecord} from "../usage/telemetry"
const trial=(id:string,accepted:boolean):Trial=>({id,taskID:"task",routeID:"route",startedAt:0,completedAt:5000,sessionIDs:[id],accepted,verification:accepted?[{command:"bun test",exitCode:0,artifact:"result.txt"}]:[],phases:[{kind:"review",milliseconds:1000},{kind:"retry",milliseconds:500}]})
const request=(id:string):RequestRecord=>({id,sessionID:id,kind:"primary",route:{providerID:"p",modelID:"m"},startedAt:100,completedAt:2000,state:"completed",tokens:{input:100,cacheRead:0,cacheWrite:0,output:20,reasoning:5}})
test("accepted-result cost includes failures, linked workers and deterministic review/retry overhead",()=>{
 const worker={...request("worker"),parentID:"one"},result=evaluateTrials([trial("one",true),trial("two",false)],[request("one"),worker,request("two")])
 expect(result.routes[0].millisecondsPerAcceptedResult).toBe(10000);expect(result.routes[0].overhead.review).toBe(2000);expect(result.trials[0].telemetry.requests).toBe(2);expect(result.routes[0].apiEquivalent.unknown.unavailableRequests).toBe(3);expect(result.routes[0].actualCharges).toEqual({})
})
test("unverified success and duplicate session attribution are rejected",()=>{
 expect(()=>evaluateTrials([{...trial("one",true),verification:[]}],[])).toThrow("verification")
 expect(()=>evaluateTrials([trial("one",true),{...trial("two",false),sessionIDs:["one"]}],[])).toThrow("multiple trials")
 const r=evaluateTrials([trial("one",false)],[]);expect(r.routes[0].millisecondsPerAcceptedResult).toBeNull();expect(r.trials[0].measurementComplete).toBe(false)
})

test("a descendant cannot be counted in both a parent trial and a worker trial",()=>{
 expect(()=>evaluateTrials([trial("one",true),trial("worker",true)],[request("one"),{...request("worker"),parentID:"one"}])).toThrow("overlaps multiple trials")
})

test("an end timestamp alone cannot establish complete benchmark measurement",()=>{
 const rows=[{...request("one"),state:"running" as const},{...request("one"),tokens:{...request("one").tokens,input:null}},{...request("one"),completedAt:6000}]
 for(const row of rows){const result=evaluateTrials([trial("one",true)],[row]);expect(result.trials[0].measurementComplete).toBe(false);expect(result.trials[0].measurementIssues.length).toBeGreaterThan(0)}
})
