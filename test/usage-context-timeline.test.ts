import {test,expect} from "bun:test"
import {contextEvent} from "../usage/context-events"
import {usageTimeline,timelineLines} from "../usage/timeline"
const request=(id:string,at:number,tokens:number,kind="primary"):any=>({id,sessionID:"s",accountID:"a",startedAt:at,completedAt:at+1,kind,state:"completed",route:{providerID:"p",modelID:id},context:{tokens,source:"provider",at},tokens:{input:tokens,cacheRead:0,cacheWrite:0,output:10,reasoning:0}})
test("native compaction events identify activation separately from generation and show measured context after",()=>{
 const records=[request("before",100,1000),request("summary",200,900,"compaction"),request("after",400,100)]
 expect(usageTimeline(records,[]).compactions).toHaveLength(0)
 const events:any[]=[{id:"start",sessionID:"s",at:190,type:"started",receipt:"receipt"},{id:"end",sessionID:"s",at:300,type:"ended"}]
 const timeline=usageTimeline(records,[...events,events[0]])
 expect(timeline.compactions).toHaveLength(1);expect(timeline.compactions[0]).toMatchObject({state:"active",receipt:"receipt",beforeTokens:1000,afterTokens:100});expect(timeline.points[2].modelChanged).toBe(true);expect(timeline.points[2].cumulativeKnownTokens).toBe(2030)
 expect(timelineLines(timeline).some(line=>line.includes("compaction active"))).toBe(true)
})
test("failed compaction and malformed events never claim context activation",()=>{
 expect(contextEvent({type:"started",id:"x",created:1,data:{sessionID:"s"}})).toBeUndefined()
 const failed=contextEvent({type:"session.compaction.failed",id:"x",created:200,data:{sessionID:"s",error:{message:"provider rejected apiKey=private-value"}}})!
 expect(failed.error).not.toContain("private-value");expect(usageTimeline([request("before",100,1000)],[failed]).compactions[0]).toMatchObject({state:"failed",afterTokens:null})
})
test("account history is labeled total account activity rather than assigned to the selected conversation",()=>{
 const timeline=usageTimeline([request("before",100,1000)],[],{sessionID:"s"},[{id:"o",at:150,accountID:"a",windowID:"weekly",usedPoints:20,resetAt:1000} as any,{id:"foreign",at:150,accountID:"other",windowID:"weekly",usedPoints:90} as any]);expect(timeline.quotaPoints).toHaveLength(1);expect(timelineLines(timeline).some(line=>line.includes("20% used (all activity)"))).toBe(true)
})
