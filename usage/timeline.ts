import {aggregateTelemetry,type RequestRecord,type TelemetryFilter} from "./telemetry"
import type {Observation} from "./calibration"
import type {ContextEvent} from "./context-events"
/** One time axis; raw tokens, accumulated usage and observed compaction are separate series. */
export function usageTimeline(records:RequestRecord[],events:ContextEvent[],filter:TelemetryFilter={},observations:Observation[]=[]){
 const summary=aggregateTelemetry(records,filter),ids=new Set(summary.requestHistory.map(r=>r.id)),rows=[...new Map(records.filter(r=>ids.has(r.id)).map(r=>[r.id,r])).values()].sort((a,b)=>a.startedAt-b.startedAt),sessions=new Set(rows.map(r=>r.sessionID));if(filter.sessionID)sessions.add(filter.sessionID)
 const selected=[...new Map(events.map(e=>[e.id,e])).values()].filter(e=>sessions.has(e.sessionID)&&(filter.from===undefined||e.at>=filter.from)&&(filter.to===undefined||e.at<=filter.to)).sort((a,b)=>a.at-b.at)
 const compactions:{id:string;sessionID:string;receipt?:string;startedAt:number;endedAt?:number;state:"started"|"active"|"failed";reason?:string;error?:string;beforeTokens:number|null;afterTokens:number|null}[]=[]
 for(const e of selected){let c=[...compactions].reverse().find(c=>c.sessionID===e.sessionID&&c.state==="started");if(e.type==="started"||!c){c={id:e.id,sessionID:e.sessionID,receipt:e.receipt,startedAt:e.at,state:"started",reason:e.reason,beforeTokens:null,afterTokens:null};compactions.push(c)}if(e.type!=="started"){c.state=e.type==="ended"?"active":"failed";c.endedAt=e.at;c.error=e.error}}
 for(const c of compactions){const context=rows.filter(r=>r.sessionID===c.sessionID&&r.context&&["primary","chat"].includes(r.kind));c.beforeTokens=context.filter(r=>r.startedAt<c.startedAt).at(-1)?.context?.tokens??null;c.afterTokens=c.state==="active"?context.find(r=>r.startedAt>=(c.endedAt??Infinity))?.context?.tokens??null:null}
 let cumulative=0;const modelBySession=new Map<string,string>();const points=rows.map(r=>{const known=Object.values(r.tokens).reduce((n,v)=>n+(v??0),0)+((r.tokens.output===null&&r.tokens.reasoning===null)?r.outputTotal??0:0);cumulative+=known;const model=r.route.providerID+"/"+r.route.modelID+(r.route.variant?"#"+r.route.variant:"");const previous=modelBySession.get(r.sessionID);modelBySession.set(r.sessionID,model);return {at:r.startedAt,requestID:r.id,sessionID:r.sessionID,contextTokens:r.context?.tokens??null,requestKnownTokens:known,cumulativeKnownTokens:cumulative,partial:Object.values(r.tokens).some(v=>v===null),model,modelChanged:previous!==undefined&&previous!==model,kind:r.kind}})
 const accountIDs=new Set(rows.map(r=>r.accountID).filter(Boolean));if(filter.accountID)accountIDs.add(filter.accountID)
 const quotaPoints=[...new Map(observations.map(o=>[o.id,o])).values()].filter(o=>accountIDs.has(o.accountID)&&o.at>=(filter.from??rows[0]?.startedAt??Infinity)&&o.at<=(filter.to??Date.now())).map(o=>({at:o.at,accountID:o.accountID,windowID:o.windowID,usedPoints:o.usedPoints,resetAt:o.resetAt,provenance:"observed-all-account-activity" as const}))
 return {points,compactions,quotaPoints,from:points[0]?.at??null,to:points.at(-1)?.at??null}
}

export function timelineLines(timeline:ReturnType<typeof usageTimeline>){
 const n=(v:number|null)=>v===null?"?":v.toLocaleString("en-US")
 const rows=timeline.points.map(p=>({at:p.at,text:new Date(p.at).toISOString().slice(11,19)+"  ctx "+n(p.contextTokens)+"  req "+n(p.requestKnownTokens)+"  sum "+n(p.cumulativeKnownTokens)+(p.partial?" partial":"")+"  "+(p.modelChanged?"model → ":"")+p.model}))
 for(const c of timeline.compactions)rows.push({at:c.endedAt??c.startedAt,text:new Date(c.endedAt??c.startedAt).toISOString().slice(11,19)+"  compaction "+c.state+"  "+n(c.beforeTokens)+" → "+n(c.afterTokens)+(c.error?" · "+c.error:"")})
 for(const q of timeline.quotaPoints)rows.push({at:q.at,text:new Date(q.at).toISOString().slice(11,19)+"  account "+q.accountID.slice(-6)+" "+q.windowID+" "+q.usedPoints+"% used (all activity)"})
 return rows.sort((a,b)=>a.at-b.at).map(r=>r.text)
}
