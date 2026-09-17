import { ledgerScopeTotals } from "./passive-ledger"
/**
 * Session totals and the context at one request are distinct quantities.
 *
 * The composer redraws this every two seconds, so it asks the ledger for one session's totals
 * rather than parsing the whole request log to add up the rows belonging to that session.
 */
export function sessionTokenLine(sessionID:string) {
 const totals=ledgerScopeTotals({sessionID,source:"opencode"})
 if(!totals||!totals.requests)return "Session tokens: awaiting first provider counters"
 const n=(v:number|null|undefined)=>(v??0).toLocaleString("en-US")
 const partial=Object.values(totals.missing).some(count=>count>0)
 return `Session: ${n(totals.totals.input)} uncached · ${n(totals.totals.cacheRead)} cached · ${n(totals.outputIncludingReasoning)} out${totals.runningRequests?` · ${totals.runningRequests} pending`:""}${partial?" · partial counters":""}`
}
