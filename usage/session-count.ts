import { aggregateTelemetry, type RequestRecord } from "./telemetry"
/** Session totals and the context at one request are distinct quantities. */
export function sessionTokenLine(records:RequestRecord[],sessionID:string) {
 const a=aggregateTelemetry(records,{sessionID}),t=a.tokens.knownTotals,output=a.tokens.outputIncludingReasoning
 const n=(v:number|null)=>(v??0).toLocaleString("en-US")
 const pending=a.requestHistory.filter(r=>r.state==="running").length
 if(!a.requests)return "Session tokens: awaiting first provider counters"
 return `Session: ${n(t.input)} uncached · ${n(t.cacheRead)} cached · ${n(output.knownTotal)} out${pending?` · ${pending} pending`:""}${Object.keys(a.tokens.missingRequests).length?" · partial counters":""}`
}
