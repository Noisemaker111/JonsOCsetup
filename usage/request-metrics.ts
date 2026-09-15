import { aggregateTelemetry, requestTiming, valueRequest, type RequestRecord } from "./telemetry"
/** One accounting calculation for per-task and per-model reports. Attempts and failures are retained. */
export function requestMetrics(records: RequestRecord[]) {
 const rows=[...new Map(records.map(r=>[r.id,r])).values()],totals=aggregateTelemetry(rows)
 const settled=rows.filter(r=>r.state!=="running")
 const timed=settled.flatMap(r=>{const t=requestTiming(r);return t.elapsedMilliseconds!==null&&t.elapsedMilliseconds>0&&r.outputTotal!==undefined?[{milliseconds:t.elapsedMilliseconds,tokens:r.outputTotal}]:t.elapsedMilliseconds!==null&&t.elapsedMilliseconds>0&&r.tokens.output!==null&&r.tokens.reasoning!==null?[{milliseconds:t.elapsedMilliseconds,tokens:r.tokens.output+r.tokens.reasoning}]:[]})
 const streamed=settled.flatMap(r=>{const t=requestTiming(r);return t.visibleOutputTokensPerSecond!==null&&t.generationMilliseconds!==null&&r.tokens.output!==null?[{milliseconds:t.generationMilliseconds,tokens:r.tokens.output}]:[]})
 const currencies=[...new Set(rows.flatMap(r=>[r.price?.currency,r.actualCharge?.currency].filter((v):v is string=>!!v)))]
 const cost=currencies.map(currency=>{
  const actual=rows.filter(r=>r.actualCharge?.currency===currency&&Number.isFinite(r.actualCharge.value)&&r.actualCharge.value>=0)
  const quoted=rows.map(r=>valueRequest(r)).filter(v=>v.complete&&v.currency===currency&&v.value!==null)
  const knownActual=actual.reduce((n,r)=>n+r.actualCharge!.value,0),knownEstimate=quoted.reduce((n,r)=>n+r.value!,0)
  return {currency,actualCharge:rows.length&&actual.length===rows.length&&settled.length===rows.length?knownActual:null,knownActualSubtotal:knownActual,actualMissingRequests:rows.length-actual.length,estimatedCost:rows.length&&quoted.length===rows.length&&settled.length===rows.length?knownEstimate:null,knownEstimateSubtotal:knownEstimate,estimateMissingRequests:rows.length-quoted.length}
 })
 const ratio=(items:{tokens:number;milliseconds:number}[])=>items.length?items.reduce((n,r)=>n+r.tokens,0)/(items.reduce((n,r)=>n+r.milliseconds,0)/1000):null
 return {requests:rows.length,settledRequests:settled.length,tokens:totals.tokens,timing:totals.timing,cost,
  speed:{outputIncludingReasoningPerSecond:ratio(timed),timedRequests:timed.length,visibleOutputTokensPerSecond:ratio(streamed),streamedRequests:streamed.length},
  note:"Cost includes observed retries and failures. Estimates use each request's saved price schedule, not actual charges. End-to-end output rate includes request latency; visible streaming rate excludes pre-output wait. Missing samples are not zero."}
}
