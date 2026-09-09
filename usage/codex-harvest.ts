import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

export type HarvestTokens = { input: number; cacheRead: number; cacheWrite: number; output: number; reasoning: number }
export type HarvestPoint = { at: number; model: string; reasoning: string | null; tokens: HarvestTokens }
export type HarvestQuota = { at: number; limitID: string; window: string; minutes: number | null; resetAt: number | null; usedPercent: number }
export type HarvestSession = { id: string; parentID: string | null; forkedFromID: string | null; source: string; startedAt: number; points: HarvestPoint[]; quota: HarvestQuota[]; repeatedCounters: number; rejectedCounters: number; inheritedRecords: number; malformedLines: number; resolvedCounterAt:number[]; gaps: {at:number;reason:string;reportedLastTotal:number|null}[] }
const keys = ["input_tokens","cached_input_tokens","cache_write_input_tokens","output_tokens","reasoning_output_tokens"] as const
const counter = (v: any): number[] | null => {
  if (!v || keys.some(k => !Number.isSafeInteger(v[k]) || v[k] < 0) || v.cached_input_tokens+v.cache_write_input_tokens>v.input_tokens || v.reasoning_output_tokens>v.output_tokens || v.total_tokens!==v.input_tokens+v.output_tokens) return null
  return keys.map(k=>v[k])
}
/** Keeps numeric counters only. The FIRST session_meta owns a forked rollout. */
export function parseCodexUsage(lines: Iterable<string>): HarvestSession | null {
  let session: HarvestSession | null = null, model = "unknown", reasoning: string | null = null, prior: number[] | null = null
  for (const line of lines) {
    if (!line.trim()) continue
    let row: any
    try { row=JSON.parse(line) } catch { if(session) session.malformedLines++; continue }
    const p=row?.payload, at=Date.parse(row?.timestamp)
    if (!p || !Number.isFinite(at)) continue
    if (row.type==="session_meta") {
      if (!session && typeof p.id==="string") session={id:p.id,parentID:typeof p.parent_thread_id==="string"?p.parent_thread_id:null,forkedFromID:typeof p.forked_from_id==="string"?p.forked_from_id:null,source:typeof p.source==="string"?p.source:p.source?.subagent?.other==="guardian"?"guardian":"subagent",startedAt:at,points:[],quota:[],repeatedCounters:0,rejectedCounters:0,inheritedRecords:0,malformedLines:0,resolvedCounterAt:[],gaps:[]}
      continue
    }
    if (!session) continue
    if (at<session.startedAt) {session.inheritedRecords++;continue}
    if (row.type==="turn_context") {model=typeof p.model==="string"?p.model:"unknown";reasoning=typeof p.effort==="string"?p.effort:null;continue}
    if (row.type!=="event_msg" || p.type!=="token_count") continue
    const limits=p.rate_limits
    if (limits) for(const window of ["primary","secondary"]) {
      const w=limits[window]
      if(w && Number.isFinite(w.used_percent) && w.used_percent>=0 && w.used_percent<=100) session.quota.push({at,limitID:typeof limits.limit_id==="string"?limits.limit_id:"unknown",window,minutes:Number.isFinite(w.window_minutes)?w.window_minutes:null,resetAt:Number.isFinite(w.resets_at)?w.resets_at*1000:null,usedPercent:w.used_percent})
    }
    if (!p.info) continue
    const total=counter(p.info.total_token_usage),last=counter(p.info.last_token_usage)
    if (total && prior && total.every((v,i)=>v===prior![i])) {session.repeatedCounters++;if(!last)session.resolvedCounterAt.push(at);continue}
    if (!total || !last) {session.rejectedCounters++;session.gaps.push({at,reason:!total?"Cumulative components are inconsistent or missing":"Last-request components do not reconcile to its total",reportedLastTotal:Number.isSafeInteger(p.info.last_token_usage?.total_tokens)?p.info.last_token_usage.total_tokens:null});continue}
    const delta=total.map((v,i)=>v-(prior?.[i]??0))
    const reconciled=delta.every((v,i)=>v===last[i])
    prior=total
    // A counter reset, missing interval, or inherited baseline is never silently added.
    if (!reconciled) {session.rejectedCounters++;session.gaps.push({at,reason:"Cumulative movement does not match the last request",reportedLastTotal:p.info.last_token_usage.total_tokens});continue}
    session.points.push({at,model,reasoning,tokens:{input:last[0]-last[1]-last[2],cacheRead:last[1],cacheWrite:last[2],output:last[3]-last[4],reasoning:last[4]}})
  }
  return session
}
export function sumHarvest(points: HarvestPoint[]): HarvestTokens {
  return points.reduce((a,p)=>({input:a.input+p.tokens.input,cacheRead:a.cacheRead+p.tokens.cacheRead,cacheWrite:a.cacheWrite+p.tokens.cacheWrite,output:a.output+p.tokens.output,reasoning:a.reasoning+p.tokens.reasoning}),{input:0,cacheRead:0,cacheWrite:0,output:0,reasoning:0})
}
/** Read-only, on demand. No transcript content, credentials, or inferred account IDs leave this adapter. */
export function harvestCodexUsage(options: {root?:string;from?:number;to?:number;now?:number} = {}) {
  const now=options.now??Date.now(),from=options.from??now-4*3600000,to=options.to??now
  if (![from,to,now].every(Number.isFinite) || from>to || to>now || to-from>7*86400000) throw new Error("Harvest needs a past time range of at most seven days")
  const root=options.root??join(process.env.CODEX_HOME??join(homedir(),".codex"),"sessions"),diagnostics:string[]=[],files:{path:string;mtime:number;size:number}[]=[]
  let scanned=0,limited=false
  function walk(dir:string) {
    for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>b.name.localeCompare(a.name))) {
      if(scanned>=20000){limited=true;return}
      const path=join(dir,entry.name)
      if(entry.isDirectory()) walk(path)
      else if(entry.isFile() && entry.name.endsWith(".jsonl")){scanned++;const s=statSync(path);if(s.mtimeMs>=from) files.push({path,mtime:s.mtimeMs,size:s.size})}
    }
  }
  if(existsSync(root))try{walk(root)}catch{diagnostics.push("Some rollout directories could not be read")}
  else diagnostics.push("Codex rollout directory is unavailable")
  if(limited)diagnostics.push("Rollout inventory stopped at 20000 files; coverage is incomplete")
  files.sort((a,b)=>b.mtime-a.mtime)
  if(files.length>500)diagnostics.push("More than 500 recent rollouts; coverage is incomplete")
  const byID=new Map<string,HarvestSession>()
  let bytes=0,readFiles=0
  for(const file of files.slice(0,500)) {
    if(file.size>64*1024*1024 || bytes+file.size>256*1024*1024){diagnostics.push("Rollout byte limit reached; coverage is incomplete");continue}
    bytes+=file.size
    try {
      const contents=readFileSync(file.path,"utf8");readFiles++;const s=parseCodexUsage(contents.split("\n"));if(!s)continue
      s.gaps=s.gaps.filter(g=>g.at>=from&&g.at<=to);s.points=s.points.filter(p=>p.at>=from&&p.at<=to);s.quota=s.quota.filter(p=>p.at>=from&&p.at<=to)
      if(!s.points.length&&!s.quota.length&&!s.gaps.length&&!s.resolvedCounterAt.length)continue
      const previous=byID.get(s.id)
      if(previous){diagnostics.push("Duplicate rollout identity; retaining the snapshot with more measured points");if(previous.points.length>=s.points.length)continue}
      byID.set(s.id,s)
    }catch{diagnostics.push("A rollout could not be read")}
  }
  const sessions=[...byID.values()].sort((a,b)=>a.startedAt-b.startedAt).map(s=>({...s,totals:sumHarvest(s.points),requests:s.points.length,lastObservedAt:s.points.at(-1)?.at??null}))
  const families=new Map<string,typeof sessions>()
  for(const session of sessions){let rootID=session.id,parent=session.parentID;const seen=new Set([rootID]);while(parent&&!seen.has(parent)){seen.add(parent);rootID=parent;parent=byID.get(parent)?.parentID??null}const family=families.get(rootID)??[];family.push(session);families.set(rootID,family)}
  return {source:"codex-rollout-counters" as const,from,to,observedAt:now,scannedFiles:scanned,readFiles,diagnostics,sessions,
    families:[...families].map(([id,rows])=>({id,sessionIDs:rows.map(s=>s.id),astraSessions:rows.filter(s=>s.points.some(p=>p.model==="gpt-6-astra")).length,astra:sumHarvest(rows.flatMap(s=>s.points.filter(p=>p.model==="gpt-6-astra"))),guardians:sumHarvest(rows.filter(s=>s.source==="guardian").flatMap(s=>s.points)),requests:rows.reduce((n,s)=>n+s.requests,0)})),
    coverage:{malformedLines:sessions.reduce((n,s)=>n+s.malformedLines,0),reconciledRequests:sessions.reduce((n,s)=>n+s.requests,0),repeatedCounters:sessions.reduce((n,s)=>n+s.repeatedCounters,0),rejectedCounters:sessions.reduce((n,s)=>n+s.rejectedCounters,0),accountAttribution:"Rollouts do not identify the account. Quota samples are observations, not per-session charges.",scope:"Locally readable Codex rollouts only; other devices, web activity and unrecorded requests may be missing."}}
}
