/** Keep account discovery usable in a model context; detailed telemetry stays queryable. */
export function compactUsageTool(snapshot:any,detail=false){
 const t=snapshot.telemetry
 return {...snapshot,accounts:snapshot.accounts.slice(0,30),telemetry:t?{filter:t.filter,planning:t.planning,latestRequest:t.latestRequest,requests:t.requests,tokens:t.tokens,timing:t.timing,context:t.context?.current,diagnostics:t.diagnostics?.slice(0,10),...(detail?{requestHistory:t.requestHistory?.slice(0,100),nextOffset:t.nextOffset}: {detail:'Use sessionID plus from/to and offset/limit for bounded request history'})}:undefined}
}
