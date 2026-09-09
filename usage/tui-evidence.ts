import type {UsageExperience} from './experience'
export const evidenceNumber=(n:number|null|undefined)=>n==null?'unknown':new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(n)
export function evidenceTime(at:number|null,zone:string){return at===null?'unknown':new Intl.DateTimeFormat('en',{timeZone:zone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'}).format(at)}
/** Dots are actual observations placed on elapsed time; never join gaps or reset epochs. */
export function quotaPlot(data:UsageExperience,width:number):string[]{
 const points=data.timeline?.items??[],columns=Math.max(12,Math.min(90,Math.floor(width)-8)),height=5
 if(!points.length)return ['No observations in this reset period.']
 const first=points[0].at,last=points.at(-1)!.at,grid=Array.from({length:height},()=>Array(columns).fill(' '))
 for(const p of points){const x=last===first?0:Math.round((p.at-first)/(last-first)*(columns-1)),y=Math.round((100-p.usedPoints)/100*(height-1));grid[y][x]='•'}
 return grid.map((row,i)=>String(100-i*25).padStart(3)+' │'+row.join('')).concat(['    └'+'─'.repeat(columns),evidenceTime(first,data.timeZone)+' → '+evidenceTime(last,data.timeZone),'Used points (0–100) · actual observations · no interpolation'])
}
export function evidenceSummary(data:UsageExperience):string[]{
 const q=data.observedQuota,d=data.decision,h=data.history,a=data.activity,n=evidenceNumber,t=(at:number|null)=>evidenceTime(at,data.timeZone)
 return [n(q.remainingPoints)+' points remaining · '+n(q.usedPoints)+' used of 100',
 'Observed '+t(q.observedAt)+' · '+q.state,
 'Resets '+t(q.resetAt),
 'Account-wide meter; not attributed to this conversation.',
 h.selectedSamples+' observations in this reset period · '+h.gapCount+' gaps over 5 min',
 ...(h.largestGap?['Largest gap: '+n(h.largestGap.milliseconds/3600000)+' hours; timing within it is unknown.']:[]),
 a.terminalRequests+' terminal / '+a.runningRequests+' running request records · '+a.source,
 a.excludedUnboundSourceRecords+' records excluded: no account binding.',
 ...paceSummary(d.measuredQuotaRate.pointsPerMinute,d.policyTarget?.requiredPointsPerMinute??null),
 'Requested workers: '+d.desiredSlots+' · next: '+d.nextAction,
 'Running worker ownership is not observed here; requested is not admitted.',
 'Schedule forecast unavailable: '+data.expectedActivity.reason,
 'Tokens and quota points are different units; capture sources can overlap.']
}

export function paceSummary(observed:number|null,required:number|null):string[]{
 if(observed===null||required===null)return ['Pace vs plan: still measuring. The plan adjusts worker concurrency.']
 if(required===0)return [observed>0?'Over planned allocation · concurrency adjusts; the plan does not block work.':'Planned allocation reached · the plan does not block work.']
 const percent=observed/required*100
 return ['Pace vs plan: '+evidenceNumber(percent)+'%'+(percent>100?' · over target':'')+' · concurrency adjusts; the plan does not block work.']
}
