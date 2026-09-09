import {expect,test} from "bun:test"
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {parseCodexUsage,harvestCodexUsage} from "../usage/codex-harvest"
const row=(at:number,type:string,payload:any)=>JSON.stringify({timestamp:new Date(at).toISOString(),type,payload})
const meta=(id="root",parent:string|null=null,at=1000)=>row(at,"session_meta",{id,parent_thread_id:parent,source:parent?{subagent:{other:"guardian"}}:"cli"})
const context=row(1001,"turn_context",{model:"gpt-6-astra",effort:"high",private:"SECRET PROMPT"})
const count=(input:number,cache:number,output:number,reasoning:number)=>({input_tokens:input,cached_input_tokens:cache,cache_write_input_tokens:0,output_tokens:output,reasoning_output_tokens:reasoning,total_tokens:input+output})
const event=(at:number,total:any,last=total)=>row(at,"event_msg",{type:"token_count",info:{total_token_usage:total,last_token_usage:last},rate_limits:{limit_id:"codex",primary:{used_percent:20,window_minutes:10080,resets_at:9999},credits:{balance:"PRIVATE"}}})
test("harvest reconciles cumulative counters, drops repeats and separates cache and reasoning",()=>{
 const a=count(100,80,20,5),b=count(300,240,50,15),s=parseCodexUsage([meta(),context,event(1100,a),event(1150,a),event(1200,b,count(200,160,30,10))])!
 expect(s.points.map(p=>p.tokens)).toEqual([{input:20,cacheRead:80,cacheWrite:0,output:15,reasoning:5},{input:40,cacheRead:160,cacheWrite:0,output:20,reasoning:10}])
 expect(s.repeatedCounters).toBe(1);expect(s.rejectedCounters).toBe(0);expect(s.quota[0].resetAt).toBe(9999000)
 expect(JSON.stringify(s)).not.toMatch(/SECRET|PRIVATE|balance/)
})
test("fork keeps first identity and rejects inherited history, missing deltas and resets",()=>{
 const s=parseCodexUsage([meta("child","root",2000),meta("root",null,1000),context,event(1100,count(100,80,20,5)),row(2001,"turn_context",{model:"gpt-6-astra"}),event(2100,count(100,80,20,5)),event(2200,count(500,400,100,20),count(100,80,20,5)),event(2300,count(10,0,1,0)),event(2400,count(20,0,2,0),count(10,0,1,0))])!
 expect(s.id).toBe("child");expect(s.parentID).toBe("root");expect(s.inheritedRecords).toBe(2);expect(s.rejectedCounters).toBe(2);expect(s.points).toHaveLength(2)
})
test("unknown components and malformed records remain explicit",()=>{
 const bad=count(100,120,20,5),s=parseCodexUsage([meta(),context,event(1100,bad),'{"unfinished":'])!
 expect(s.points).toHaveLength(0);expect(s.rejectedCounters).toBe(1);expect(s.malformedLines).toBe(1)
})
test("read-only harvest finds all families, excludes guardians from Astra and filters time",()=>{
 const root=mkdtempSync(join(tmpdir(),"usage-harvest-"))
 try{
  mkdirSync(join(root,"old"));const paths=[join(root,"old","one.jsonl"),join(root,"two.jsonl")]
  const text=[meta(),context,event(1100,count(100,80,20,5)),event(1200,count(200,160,40,10),count(100,80,20,5))].join("\n")
  writeFileSync(paths[0],text);writeFileSync(paths[1],[meta("guard","root"),row(1001,"turn_context",{model:"codex-auto-review"}),event(1100,count(100,0,20,5))].join("\n"))
  const h=harvestCodexUsage({root,from:1000,to:1300,now:1300})
  expect(h.readFiles).toBe(2);expect(h.coverage.malformedLines).toBe(0);expect(h.families).toHaveLength(1);expect(h.families[0].astra.input).toBe(40);expect(h.families[0].guardians.input).toBe(100);expect(h.sessions).toHaveLength(2)
  const narrowed=harvestCodexUsage({root,from:1150,to:1300,now:1300});expect(narrowed.coverage.reconciledRequests).toBe(1)
  expect(()=>harvestCodexUsage({root,from:0,to:8*86400000,now:8*86400000})).toThrow("seven days")
 }finally{rmSync(root,{recursive:true,force:true})}
})

test("unchanged cumulative totals resolve malformed last-request markers without adding tokens",()=>{
 const a=count(100,80,20,5),marker={...count(0,0,0,0),total_tokens:90000}
 const s=parseCodexUsage([meta(),context,event(1100,a),event(1200,a,marker),event(1300,count(200,160,40,10),a)])!
 expect(s.points).toHaveLength(2);expect(s.repeatedCounters).toBe(1);expect(s.rejectedCounters).toBe(0);expect(s.resolvedCounterAt).toEqual([1200])
})
