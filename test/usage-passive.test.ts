import {Database} from "bun:sqlite"
import {readHostCounters} from "../usage/host-counters"
import {installUsageContext} from "../usage/context-summary"
import {test,expect} from "bun:test"
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,rmSync,utimesSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {collectPassive,persistLedger,readLedger,summarizeLedger,type LedgerRow,type CollectorReceipt} from "../usage/passive-ledger"
import {setUsageTarget,readUsageTargets} from "../usage/usage-target"
import {learnEmpiricalModel,measuredIntervals,type MeasuredInterval} from "../usage/empirical-usage"
import {resetPlan} from "../usage/reset-planner"
import {accountRegime} from "../usage/calibration-store"
import {observedResponse} from "../usage/request-collector"
import {sessionTokenLine} from "../usage/session-count"
import type {AccountUsage} from "../usage/account-types"
import type {RequestRecord} from "../usage/telemetry"
const now=2000000000000,reset=now+4*3600000
const a=():AccountUsage=>({id:"a",provider:"openai",identity:"account",connections:[],plan:{name:"Pro",rateLimitTier:null,multiplier:null,provenance:"provider-observed",observedAt:null},windows:[{id:"weekly",label:"7d",scope:"shared",durationSeconds:604800,usedPercent:40,remainingPercent:60,resetAt:new Date(reset).toISOString(),observedAt:new Date(now).toISOString(),state:"available"}],extraUsage:{enabled:null},state:"available",observedAt:new Date(now).toISOString(),attemptedAt:null,nextAttemptAt:null,failures:0,error:null})
const record=(id="r",sessionID="s"):LedgerRow=>({id,source:"codex",sessionID,at:now-1000,startedAt:now-2000,route:{providerID:"openai",modelID:"gpt-6-astra"},kind:"cli",state:"completed",tokens:{input:100,cacheRead:900,cacheWrite:0,output:20,reasoning:5}})
const receipt:CollectorReceipt={at:now,from:now-10000,scannedFiles:1,readFiles:1,reconciledRequests:1,rejectedCounters:0,repeatedCounters:0,malformedLines:0,diagnostics:[]}
const scratch=()=>mkdtempSync(join(tmpdir(),"passive-usage-"))
test("durable accounting survives reload, deduplicates replay, and keeps child and guardian counts",()=>{
 const dir=scratch(),file=join(dir,"ledger.sqlite")
 try{const rows=[record(),{...record("child","c"),parentID:"s"},{...record("g","g"),kind:"guardian",parentID:"s"}]
  persistLedger({rows,observations:[],receipt},file);persistLedger({rows,observations:[],receipt},file)
  expect(summarizeLedger(readLedger({sessionID:"s",to:now},file).rows).totals.input).toBe(100)
  const summary=summarizeLedger(readLedger({sessionID:"s",includeWorkers:true,to:now},file).rows)
  expect(summary.requests).toBe(3);expect(summary.outputIncludingReasoning).toBe(75);expect(summary.totals.cacheRead).toBe(2700)
  persistLedger({rows:[{...rows[0],tokens:{...rows[0].tokens,input:120}}],observations:[],receipt:{...receipt,at:now+1000,from:now}},file)
  expect(summarizeLedger(readLedger({to:now+1000},file).rows).totals.input).toBe(320);expect(readLedger({to:now+1000},file).coverageFrom).toBe(now-10000)
  persistLedger({rows:[],observations:[],receipt,gaps:[{sessionID:"s",at:now-500,reason:"Last-request components do not reconcile to its total",reportedLastTotal:9999}]},file)
  persistLedger({rows:[],observations:[],receipt,resolvedCounters:[{sessionID:"s",at:now-500}]},file)
  expect(readLedger({to:now+1000},file).gaps).toHaveLength(0);expect(readLedger({to:now+1000},file).resolvedGaps).toBe(1)
  persistLedger({rows:[{...rows[0],state:"running",recordedAt:now+5000,tokens:{...rows[0].tokens,input:null}}],observations:[],receipt},file)
  expect(summarizeLedger(readLedger({to:now+1000},file).rows).totals.input).toBe(320)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test("passive collector coalesces concurrent scans and resumes without duplicating tokens",async()=>{
 const dir=scratch(),file=join(dir,"ledger.sqlite"),root=join(dir,"rollouts");mkdirSync(root)
 try{
 const line=(at:number,type:string,payload:any)=>JSON.stringify({timestamp:new Date(at).toISOString(),type,payload})
 const tokens={input_tokens:100,cached_input_tokens:70,cache_write_input_tokens:0,output_tokens:10,reasoning_output_tokens:2,total_tokens:110}
 writeFileSync(join(root,"one.jsonl"),[line(now-5000,"session_meta",{id:"s",source:"cli"}),line(now-4000,"turn_context",{model:"gpt-6-astra"}),line(now-2000,"event_msg",{type:"token_count",info:{total_token_usage:tokens,last_token_usage:tokens}})].join("\n"))
 utimesSync(join(root,"one.jsonl"),new Date(now),new Date(now))
 const options={file,root,now,records:[],observations:[],accounts:{schema:1 as const,updatedAt:new Date(now).toISOString(),accounts:[],diagnostics:[]}}
 const results=await Promise.all([collectPassive(options),collectPassive(options)])
 expect(results.filter(r=>r.collected)).toHaveLength(1)
 appendFileSync(join(root,"one.jsonl"),"\n"+line(now+10000,"event_msg",{type:"token_count",info:{total_token_usage:Object.fromEntries(Object.entries(tokens).map(([k,v])=>[k,v*2])),last_token_usage:tokens}}))
 utimesSync(join(root,"one.jsonl"),new Date(now+31000),new Date(now+31000))
 await collectPassive({...options,now:now+31000})
 expect(summarizeLedger(readLedger({to:now+31000},file).rows).totals.input).toBe(60)
 expect(readLedger({to:now+31000},file).receipt?.at).toBe(now+31000)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test("saved deadlines reload and pacing respects the earlier deadline or reset",()=>{
 const dir=scratch(),file=join(dir,"targets.json")
 try{setUsageTarget("a",now+3600000,10,file,now);expect(readUsageTargets(file)[0].reservePoints).toBe(10)
 const observations=[{id:"b",accountID:"a",windowID:"weekly",regime:accountRegime(a()),at:now-600000,usedPoints:35,resetAt:reset,precisionPoints:null,reportingDelayMilliseconds:null},{id:"e",accountID:"a",windowID:"weekly",regime:accountRegime(a()),at:now,usedPoints:40,resetAt:reset,precisionPoints:null,reportingDelayMilliseconds:null}]
 const p=resetPlan([a()],observations,now,10,readUsageTargets(file)[0].deadlineAt)[0]
 expect(p.requiredPointsPerMinute).toBeCloseTo(50/60);expect(p.forecast?.projectedExhaustionAt).toBe(now+120*60000)
 const crossed=resetPlan([a()],observations,now,0,reset+60000)[0];expect(crossed.targetAt).toBe(reset);expect(crossed.deadlineCrossesReset).toBe(true)
 setUsageTarget("a",null,0,file,now);expect(readUsageTargets(file)).toEqual([])
 expect(()=>setUsageTarget("a",now-1,0,file,now)).toThrow()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test("observed quota/token intervals retain unbound attribution and separate account regimes",()=>{
 const account=a(),regime=accountRegime(account),observations=[0,1,2].map(i=>({id:String(i),accountID:"a",windowID:"weekly",regime,at:now-600000+i*300000,usedPoints:10+i*2.05,resetAt:reset,precisionPoints:null,reportingDelayMilliseconds:null}))
 const intervals=measuredIntervals([account],observations,[record()])
 expect(intervals).toHaveLength(2);expect(intervals[1].usedPoints).toBeCloseTo(2.05);expect(intervals[1].tokens).toEqual([100,900,0,25]);expect(intervals[1].unboundRequests).toBe(1)
 expect(intervals[1].limitations.join(" ")).toContain("inferred")
 expect(measuredIntervals([{...account,plan:{...account.plan,name:"Plus"}}],observations,[record()])).toEqual([])
 const two=measuredIntervals([account,{...account,id:"b"}],observations,[record()]);expect(two.every(i=>i.requests===0)).toBe(true)
})
const sample=(i:number,values:number[]):MeasuredInterval=>({accountID:"a",regime:"r",windowID:"w",resetAt:now+1e9,from:now+i*300000,to:now+(i+1)*300000,usedPoints:values[0]*.000002+values[1]*.0000002,precisionPoints:null,reportingDelayMilliseconds:null,requests:1,missingRequests:0,unboundRequests:1,features:{route:values},tokens:values,basis:"coincident-observations",limitations:[]})
test("empirical model learns varying token mixes, checks later error, and rejects unidentifiable coefficients",()=>{
 const examples=Array.from({length:18},(_,i)=>sample(i,[100000+(i%3)*40000,200000+(i%5)*90000,0,0]))
 const fitted=learnEmpiricalModel(examples)
 expect(fitted.state).toBe("provisional");expect(fitted.coefficients?.[0].pointsPerMillionTokens).toBeCloseTo(2,2);expect(fitted.coefficients?.[1].pointsPerMillionTokens).toBeCloseTo(.2,2)
 expect(fitted.validation?.meanAbsoluteErrorPoints).toBeLessThan(.001)
 const flat=learnEmpiricalModel(examples.map((s,i)=>sample(i,[100000*(i+1),900000*(i+1),0,0])))
 expect(flat.state).toBe("collecting");expect(flat.reason).toContain("correlated")
 expect(learnEmpiricalModel(examples.map((s,i)=>({...s,usedPoints:s.usedPoints+(i>14?20:0)}))).state).toBe("collecting")
})
test("SSE final unterminated and multiline usage survives byte-for-byte with exact session totals",async()=>{
 const base:RequestRecord={id:"r",sessionID:"s",route:{providerID:"test",modelID:"m"},kind:"chat",startedAt:now,state:"running",tokens:{input:null,output:null,reasoning:null,cacheRead:null,cacheWrite:null}}
 const raw='data: {"usage":\ndata: {"prompt_tokens":100,"completion_tokens":20}}'
 let saved=base;const response=observedResponse(new Response(raw,{headers:{"content-type":"text/event-stream"}}),base,r=>saved=structuredClone(r))
 expect(await response.text()).toBe(raw);expect(saved.tokens.input).toBe(100);expect(sessionTokenLine([saved],"s")).toContain("100 uncached");expect(sessionTokenLine([saved],"s")).toContain("20 out")
})

test("prompt feedback is a bounded system part and never an untyped string",async()=>{
 let hook:Function|undefined
 await installUsageContext({session:{hook:(name:string,fn:Function)=>{expect(name).toBe("context");hook=fn}}})
 const event={sessionID:"isolated-session",system:[] as any[]};hook!(event)
 expect(event.system[0].type).toBe("text");expect(event.system[0].text.length).toBeLessThanOrEqual(1400);expect(event.system[0].text).toContain("usage_status")
})

test("forecast scenarios use distinct recent slopes and never cross the pool reset",()=>{
 const account=a(),regime=accountRegime(account)
 const points=[[30,10],[15,20],[5,25],[0,40]].map(([minutes,usedPoints])=>({id:String(minutes),accountID:"a",windowID:"weekly",regime,at:now-minutes*60000,usedPoints,resetAt:reset,precisionPoints:null,reportingDelayMilliseconds:null}))
 const p=resetPlan([account],points,now)[0]
 expect(p.forecast?.earliestExhaustionAt).toBe(now+20*60000);expect(p.forecast?.latestExhaustionAt).toBe(now+60*60000)
 const capped=a();capped.windows[0].usedPercent=100;const capPoints=points.map(o=>({...o,usedPoints:100}));expect(resetPlan([capped],capPoints,now)[0].forecast?.projectedExhaustionAt).toBe(now)
})

test("native host backfill reads current schema counters without transcript content",async()=>{
 const dir=scratch(),file=join(dir,"host.db"),db=new Database(file)
 try{db.exec("CREATE TABLE session_v2(id TEXT,parent_id TEXT,time_created INTEGER); CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,time_updated INTEGER,data TEXT)")
 db.query("INSERT INTO session_v2 VALUES(?,?,?)").run("s",null,now-200)
 db.query("INSERT INTO session_message VALUES(?,?,?,?,?)").run("m","s","assistant",now,JSON.stringify({content:"PRIVATE TRANSCRIPT",providerState:"PRIVATE STATE",model:{id:"model",providerID:"provider"},time:{created:now-100,completed:now},tokens:{input:100,output:20,reasoning:5,cache:{read:900,write:0}}}))
 const result=readHostCounters({file,from:now-1000,to:now})
 expect(result.rows).toHaveLength(1);expect(result.rows[0].tokens).toEqual({input:100,output:20,reasoning:5,cacheRead:900,cacheWrite:0});expect(JSON.stringify(result)).not.toContain("PRIVATE")
 db.query("UPDATE session_message SET data=json_remove(data,'$.tokens.reasoning')").run();const partial=readHostCounters({file,from:now-1000,to:now});expect(partial.available).toBe(true);expect(partial.rows[0].tokens.reasoning).toBeNull();expect(partial.rows[0].tokens.input).toBe(100)
 const emptyRoot=join(dir,"empty-rollouts");mkdirSync(emptyRoot)
 const collected=await collectPassive({file:join(dir,"ledger.sqlite"),hostDB:file,root:emptyRoot,now,records:[],observations:[],accounts:{schema:1,updatedAt:new Date(now).toISOString(),accounts:[],diagnostics:[]}})
 expect(collected.receipt?.diagnostics).toContain("1 host messages have partial numeric counters");expect(collected.receipt?.calibrationDiagnostics).toEqual([])
 db.query("UPDATE session_v2 SET time_created=?").run(now+1);expect(readHostCounters({file,from:now-1000,to:now}).rows).toEqual([])
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
