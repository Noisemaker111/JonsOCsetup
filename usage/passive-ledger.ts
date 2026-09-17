import {updateBurnControls} from "./burn-control"
import {readHostCounters} from "./host-counters"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { TELEMETRY_FILE, readRequestsSince, type TelemetryCursor } from "./telemetry-store"
import { harvestCodexUsage, saveRolloutCursors, restoreRolloutCursors, type SavedRolloutCursor } from "./codex-harvest"
import { readAccountUsage, ACCOUNT_USAGE_FILE } from "./account-api"
import { readQuotaObservations } from "./calibration-store"
import type { Observation } from "./calibration"
import type { RequestRecord, TelemetryFilter, Tokens } from "./telemetry"
import type { AccountSnapshot } from "./account-types"

export const PASSIVE_LEDGER_FILE = process.env.OPENCODE_PASSIVE_LEDGER_FILE ?? TELEMETRY_FILE + ".ledger.sqlite"
export type LedgerRow = { id:string; source:"opencode"|"codex"|"opencode-host"; sessionID:string; parentID?:string|null; questID?:string; accountID?:string; regime?:string; at:number; recordedAt?:number; startedAt:number; completedAt?:number; firstVisibleAt?:number; lastOutputAt?:number; route:RequestRecord["route"]; kind:string; state:string; tokens:Tokens; outputTotal?:number; context?:RequestRecord["context"] }
export type CollectorReceipt = { at:number; from:number; scannedFiles:number; readFiles:number; unchangedFiles?:number; newRequests?:number; newHostRows?:number; newCodexRows?:number; writtenRows?:number; reconciledRequests:number; rejectedCounters:number; repeatedCounters:number; malformedLines:number; diagnostics:string[];hostScanAt?:number|null;parserVersion?:number;calibrationDiagnostics?:string[] }
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex")
const UPSERT="INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account=excluded.account,at=excluded.at,body=excluded.body WHERE coalesce(json_extract(excluded.body,'$.recordedAt'),excluded.at)>=coalesce(json_extract(records.body,'$.recordedAt'),records.at) AND NOT(json_extract(records.body,'$.state')!='running' AND json_extract(excluded.body,'$.state')='running')"
function open(file:string) {
 mkdirSync(dirname(file),{recursive:true})
 const db=new Database(file,{create:true});db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;")
 db.exec(`CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,source TEXT,session TEXT,parent TEXT,account TEXT,at INTEGER,body TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS records_time ON records(at); CREATE INDEX IF NOT EXISTS records_session ON records(session);
 CREATE TABLE IF NOT EXISTS gaps(id TEXT PRIMARY KEY,at INTEGER,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS quota(id TEXT PRIMARY KEY,at INTEGER,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,body TEXT NOT NULL);`)
 return db
}
export function persistLedger(input:{rows:LedgerRow[];observations:Observation[];resolvedCounters?:{sessionID:string;at:number}[];gaps?:{sessionID:string;at:number;reason:string;reportedLastTotal:number|null}[];receipt:CollectorReceipt;cursors?:{telemetry:TelemetryCursor|null;rollouts:Record<string,SavedRolloutCursor>}},file=PASSIVE_LEDGER_FILE) {
 const db=open(file)
 try {db.transaction(()=>{
  const put=db.query(UPSERT)
  for(const row of input.rows) put.run(row.id,row.source,row.sessionID,row.parentID??null,row.accountID??null,row.at,JSON.stringify(row))
  const gap=db.query("INSERT OR IGNORE INTO gaps VALUES(?,?,?)")
  for(const g of input.gaps??[])gap.run(hash(g),g.at,JSON.stringify(g))
  const resolveGap=db.query("UPDATE gaps SET body=json_set(body,'$.resolved',1,'$.resolution','Unchanged valid cumulative counters: no additional token movement') WHERE at=? AND json_extract(body,'$.sessionID')=? AND json_extract(body,'$.reason')='Last-request components do not reconcile to its total'")
  for(const r of input.resolvedCounters??[])resolveGap.run(r.at,r.sessionID)
  const quota=db.query("INSERT OR IGNORE INTO quota VALUES(?,?,?)")
  for(const o of input.observations)quota.run(o.id,o.at,JSON.stringify(o))
  db.query("INSERT OR IGNORE INTO meta VALUES('coverageFrom',?)").run(JSON.stringify(input.receipt.from))
  const meta=db.query("INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body")
  meta.run("receipt",JSON.stringify(input.receipt))
  if(input.cursors){meta.run("telemetryCursor",JSON.stringify(input.cursors.telemetry));meta.run("rolloutCursors",JSON.stringify(input.cursors.rollouts))}
 })()}finally{db.close()}
}
export function ledgerRows(records:RequestRecord[]):LedgerRow[] {
 return records.map(r=>({id:"opencode:"+r.id,source:"opencode",sessionID:r.sessionID,parentID:r.parentID,questID:r.questID,accountID:r.accountID,regime:r.accountRegime,at:r.completedAt??r.startedAt,recordedAt:r.recordedAt??r.completedAt??r.startedAt,startedAt:r.startedAt,completedAt:r.completedAt,firstVisibleAt:r.firstVisibleAt,lastOutputAt:r.lastOutputAt,route:r.route,kind:r.kind,state:r.state,tokens:r.tokens,outputTotal:r.outputTotal,context:r.context}))
}
/** Event-driven native counters are durable immediately; the periodic scan backfills missed events. */
export function recordLedgerRequest(record:RequestRecord,file=PASSIVE_LEDGER_FILE) {
 const db=open(file),row=ledgerRows([record])[0]
 try{db.query(UPSERT).run(row.id,row.source,row.sessionID,row.parentID??null,row.accountID??null,row.at,JSON.stringify(row))}finally{db.close()}
}
export type LedgerFilter=TelemetryFilter&{source?:LedgerRow["source"]}
function conditions(options:LedgerFilter,db:Database){
 const from=options.from??0,to=options.to??Date.now()
 const clauses=["at>=?","at<=?"],params:(string|number)[]=[from,to]
 if(options.source){clauses.push("source=?");params.push(options.source)}
 if(options.accountID){clauses.push("account=?");params.push(options.accountID)}
 if(options.questID){clauses.push("json_extract(body,'$.questID')=?");params.push(options.questID)}
 if(options.sessionID){
  if(options.includeWorkers){clauses.push("session IN (WITH RECURSIVE family(id) AS (SELECT ? UNION SELECT r.session FROM records r JOIN family f ON r.parent=f.id) SELECT id FROM family)");params.push(options.sessionID)}
  else{clauses.push("session=?");params.push(options.sessionID)}
 }
 void db
 return {where:clauses.join(" AND "),params}
}
function readonlyDatabase(file:string){const db=new Database(file,{readonly:true});db.exec("PRAGMA busy_timeout=1000");return db}
export function readLedger(options:TelemetryFilter={},file=PASSIVE_LEDGER_FILE) {
 if(!existsSync(file))return {rows:[] as LedgerRow[],observations:[] as Observation[],receipt:null as CollectorReceipt|null,coverageFrom:null as number|null,resolvedGaps:0,gaps:[] as {sessionID:string;at:number;reason:string;reportedLastTotal:number|null}[],diagnostics:["Passive collector has not recorded a sample"]}
 const db=readonlyDatabase(file)
 try {
  const from=options.from??0,to=options.to??Date.now()
  const {where,params}=conditions(options,db)
  const rows=(db.query("SELECT body FROM records WHERE "+where+" ORDER BY at,id").all(...params) as {body:string}[]).map(r=>JSON.parse(r.body) as LedgerRow)
  const meta=(key:string)=>{const r=db.query("SELECT body FROM meta WHERE key=?").get(key) as {body:string}|null;return r?JSON.parse(r.body):null}
  const resolvedGaps=(db.query("SELECT count(*) count FROM gaps WHERE json_extract(body,'$.resolved')=1").get() as {count:number}).count
  return {rows,resolvedGaps,observations:(db.query("SELECT body FROM quota WHERE at>=? AND at<=? ORDER BY at").all(from,to) as {body:string}[]).map(r=>JSON.parse(r.body) as Observation),gaps:(db.query("SELECT body FROM gaps WHERE at>=? AND at<=? AND coalesce(json_extract(body,'$.resolved'),0)=0 ORDER BY at").all(from,to) as {body:string}[]).map(r=>JSON.parse(r.body) as {sessionID:string;at:number;reason:string;reportedLastTotal:number|null}),receipt:meta("receipt") as CollectorReceipt|null,coverageFrom:meta("coverageFrom") as number|null,diagnostics:[] as string[]}
 }finally{db.close()}
}

/**
 * The digest answers about one scope, so it asks SQLite for that scope's totals instead of loading
 * the ledger and adding up rows in JavaScript. The reply is the same size whether the scope holds
 * ten requests or ten thousand, which is the property the default answer needs.
 */
export type ScopeTotals={requests:number;runningRequests:number;sessions:number;firstAt:number|null;lastAt:number|null;totals:Tokens;missing:Record<keyof Tokens,number>;outputIncludingReasoning:number;missingOutputRequests:number;models:{modelID:string;providerID:string;requests:number}[]}
const TOKEN_KEYS=["input","cacheRead","cacheWrite","output","reasoning"] as const
export function ledgerScopeTotals(options:LedgerFilter={},file=PASSIVE_LEDGER_FILE):ScopeTotals|null {
 if(!existsSync(file))return null
 const db=readonlyDatabase(file)
 try {
  const {where,params}=conditions(options,db)
  const token=(key:string)=>`sum(CASE WHEN json_extract(body,'$.tokens.${key}') IS NULL THEN 0 ELSE json_extract(body,'$.tokens.${key}') END) ${key}, sum(json_extract(body,'$.tokens.${key}') IS NULL) missing_${key}`
  const row=db.query(`SELECT count(*) requests, sum(json_extract(body,'$.state')='running') running, count(DISTINCT session) sessions, min(at) firstAt, max(at) lastAt,
   sum(coalesce(json_extract(body,'$.outputTotal'),json_extract(body,'$.tokens.output')+json_extract(body,'$.tokens.reasoning'),0)) outputTotal,
   sum(coalesce(json_extract(body,'$.outputTotal'),json_extract(body,'$.tokens.output')+json_extract(body,'$.tokens.reasoning')) IS NULL) missingOutput,
   ${TOKEN_KEYS.map(token).join(", ")} FROM records WHERE `+where).get(...params) as any
  const models=db.query("SELECT json_extract(body,'$.route.modelID') modelID, json_extract(body,'$.route.providerID') providerID, count(*) requests FROM records WHERE "+where+" GROUP BY modelID,providerID ORDER BY requests DESC LIMIT 12").all(...params) as {modelID:string;providerID:string;requests:number}[]
  const totals={} as Tokens, missing={} as Record<keyof Tokens,number>
  for(const key of TOKEN_KEYS){totals[key]=row?.[key]??0;missing[key]=row?.["missing_"+key]??0}
  return {requests:row?.requests??0,runningRequests:row?.running??0,sessions:row?.sessions??0,firstAt:row?.firstAt??null,lastAt:row?.lastAt??null,totals,missing,outputIncludingReasoning:row?.outputTotal??0,missingOutputRequests:row?.missingOutput??0,models}
 }finally{db.close()}
}
/** The most recent measured context for a scope, without loading the scope's requests. */
export function ledgerLatestRequest(options:LedgerFilter={},file=PASSIVE_LEDGER_FILE):LedgerRow|null {
 if(!existsSync(file))return null
 const db=readonlyDatabase(file)
 try {
  const {where,params}=conditions(options,db)
  const row=db.query("SELECT body FROM records WHERE "+where+" AND source='opencode' ORDER BY at DESC,id LIMIT 1").get(...params) as {body:string}|null
  return row?JSON.parse(row.body) as LedgerRow:null
 }finally{db.close()}
}
export function ledgerLatestContext(options:LedgerFilter={},file=PASSIVE_LEDGER_FILE):(NonNullable<RequestRecord["context"]>&{sessionID:string})|null {
 if(!existsSync(file))return null
 const db=readonlyDatabase(file)
 try {
  const {where,params}=conditions(options,db)
  const row=db.query("SELECT body FROM records WHERE "+where+" AND json_extract(body,'$.context.tokens') IS NOT NULL AND json_extract(body,'$.kind') IN ('primary','chat') ORDER BY at DESC,id LIMIT 1").get(...params) as {body:string}|null
  if(!row)return null
  const value=JSON.parse(row.body) as LedgerRow
  return value.context?{...value.context,sessionID:value.sessionID}:null
 }finally{db.close()}
}
/** One page of requests, newest first: what the caller asked for and nothing behind it. */
export function ledgerRequestPage(options:LedgerFilter&{offset:number;limit:number},file=PASSIVE_LEDGER_FILE) {
 if(!existsSync(file))return {rows:[] as LedgerRow[],total:0,nextOffset:null as number|null}
 const db=readonlyDatabase(file)
 try {
  const {where,params}=conditions(options,db)
  const total=(db.query("SELECT count(*) count FROM records WHERE "+where).get(...params) as {count:number}).count
  const rows=(db.query("SELECT body FROM records WHERE "+where+" ORDER BY at DESC,id LIMIT ? OFFSET ?").all(...params,options.limit,options.offset) as {body:string}[]).map(r=>JSON.parse(r.body) as LedgerRow)
  return {rows,total,nextOffset:options.offset+options.limit<total?options.offset+options.limit:null}
 }finally{db.close()}
}
/** One page of per-session accounting, ordered by most recent activity. */
export function ledgerSessionPage(options:LedgerFilter&{offset:number;limit:number},file=PASSIVE_LEDGER_FILE) {
 if(!existsSync(file))return {sessions:[] as any[],total:0,nextOffset:null as number|null}
 const db=readonlyDatabase(file)
 try {
  const {where,params}=conditions(options,db)
  const total=(db.query("SELECT count(DISTINCT source||':'||session) count FROM records WHERE "+where).get(...params) as {count:number}).count
  const token=(key:string)=>`sum(CASE WHEN json_extract(body,'$.tokens.${key}') IS NULL THEN 0 ELSE json_extract(body,'$.tokens.${key}') END) ${key}`
  const sessions=db.query(`SELECT json_extract(body,'$.source') source, session sessionID, count(*) requests,
   sum(json_extract(body,'$.state')='running') runningRequests, max(at) lastAt, min(at) firstAt,
   sum(coalesce(json_extract(body,'$.outputTotal'),json_extract(body,'$.tokens.output')+json_extract(body,'$.tokens.reasoning'),0)) outputIncludingReasoning,
   ${TOKEN_KEYS.map(token).join(", ")} FROM records WHERE `+where+" GROUP BY source,session ORDER BY lastAt DESC LIMIT ? OFFSET ?").all(...params,options.limit,options.offset) as any[]
  return {sessions:sessions.map(s=>({source:s.source,sessionID:s.sessionID,requests:s.requests,runningRequests:s.runningRequests,firstAt:s.firstAt,lastAt:s.lastAt,outputIncludingReasoning:s.outputIncludingReasoning,totals:Object.fromEntries(TOKEN_KEYS.map(k=>[k,s[k]]))})),total,nextOffset:options.offset+options.limit<total?options.offset+options.limit:null}
 }finally{db.close()}
}
/** Collector coverage, without reading a single request row. */
export function ledgerCoverage(file=PASSIVE_LEDGER_FILE) {
 if(!existsSync(file))return {receipt:null as CollectorReceipt|null,coverageFrom:null as number|null,openGaps:0,resolvedGaps:0,records:0,observations:0}
 const db=readonlyDatabase(file)
 try {
  const meta=(key:string)=>{const r=db.query("SELECT body FROM meta WHERE key=?").get(key) as {body:string}|null;return r?JSON.parse(r.body):null}
  const count=(sql:string)=>(db.query(sql).get() as {count:number}).count
  return {receipt:meta("receipt") as CollectorReceipt|null,coverageFrom:meta("coverageFrom") as number|null,
   openGaps:count("SELECT count(*) count FROM gaps WHERE coalesce(json_extract(body,'$.resolved'),0)=0"),
   resolvedGaps:count("SELECT count(*) count FROM gaps WHERE json_extract(body,'$.resolved')=1"),
   records:count("SELECT count(*) count FROM records"),observations:count("SELECT count(*) count FROM quota")}
 }finally{db.close()}
}
export function summarizeLedger(rows:LedgerRow[]) {
 const groups=new Map<string,LedgerRow[]>();for(const r of rows){const k=r.source+":"+r.sessionID;const group=groups.get(k)??[];group.push(r);groups.set(k,group)}
 const summary=(records:LedgerRow[])=>{
  const totals={input:0,cacheRead:0,cacheWrite:0,output:0,reasoning:0},missing={input:0,cacheRead:0,cacheWrite:0,output:0,reasoning:0};let combinedOutput=0,missingOutput=0
  for(const r of records){for(const k of Object.keys(totals) as (keyof Tokens)[]){const v=r.tokens[k];if(v===null)missing[k]++;else totals[k]+=v}const o=r.outputTotal??(r.tokens.output!==null&&r.tokens.reasoning!==null?r.tokens.output+r.tokens.reasoning:null);if(o===null)missingOutput++;else combinedOutput+=o}
  return {requests:records.length,runningRequests:records.filter(r=>r.state==="running").length,totals,missing,outputIncludingReasoning:combinedOutput,missingOutputRequests:missingOutput}
 }
 return {...summary(rows),sessionCount:new Set(rows.map(r=>(r.source==="codex"?"codex:":"opencode:")+r.sessionID)).size,basis:"recorded-source-counters" as const,crossSourceOverlap:"Unknown: Native host, HTTP and Codex captures may overlap; source totals are not verified unique billable tokens.",sources:(["opencode","codex","opencode-host"] as const).map(source=>({source,...summary(rows.filter(r=>r.source===source))})),sessions:[...groups.values()].map(g=>({source:g[0].source,sessionID:g[0].sessionID,parentID:g[0].parentID,models:[...new Set(g.map(r=>r.route.modelID))],...summary(g),lastAt:Math.max(...g.map(r=>r.at))}))}
}
/**
 * Every host can call this; a SQLite lease elects one scanner for each 30-second sample.
 *
 * A tick reads only what moved since the last receipt: the bytes appended to the request log, the
 * rollouts whose size or modification time changed, and the host messages recorded since the last
 * host scan. It writes only the rows those bytes produced. A tick that finds nothing new opens the
 * database, stats the rollout directory and writes a receipt, and that is the whole cost.
 */
export async function collectPassive(options:{file?:string;root?:string;hostDB?:string;now?:number;accounts?:AccountSnapshot;records?:RequestRecord[];observations?:Observation[];force?:boolean}={}) {
 const file=options.file??PASSIVE_LEDGER_FILE,now=options.now??Date.now(),db=open(file)
 const owner=randomUUID()
 let previous:number|null=null,hostPrevious:number|null=null,parserVersion=0,claimed=false
 let telemetryCursor:TelemetryCursor|null=null,rolloutCursors:Record<string,SavedRolloutCursor>|null=null
 try {db.transaction(()=>{
  const get=(key:string)=>{const r=db.query("SELECT body FROM meta WHERE key=?").get(key) as {body:string}|null;return r?JSON.parse(r.body):null}
  previous=get("receipt")?.at??null;hostPrevious=get("receipt")?.hostScanAt??null;parserVersion=get("receipt")?.parserVersion??0
  if((get("lease")?.until??0)>now||(!options.force&&previous!==null&&now-previous<30000))return
  telemetryCursor=get("telemetryCursor");rolloutCursors=get("rolloutCursors")
  db.query("INSERT INTO meta VALUES('lease',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body").run(JSON.stringify({owner,until:now+120000}));claimed=true
 })()}finally{db.close()}
 if(!claimed)return {collected:false}
 try {
  const resumable=parserVersion>=4
  const from=Math.max(0,now-7*86400000,previous===null||!resumable?0:previous-5*60000)
  if(resumable)restoreRolloutCursors(rolloutCursors)
  const harvest=await harvestCodexUsage({root:options.root,from,now,changedOnly:resumable})
  // The request log only grows, so a tick parses the bytes appended since the last receipt.
  const stored=options.records?{records:options.records,diagnostics:[],cursor:telemetryCursor,restarted:false}:readRequestsSince(resumable?telemetryCursor:null)
  // Quota observations belong to the refresh owner; the collector reads the shared cache.
  const accounts=options.accounts??readAccountUsage()
  const observations=options.observations??readQuotaObservations(ACCOUNT_USAGE_FILE+".observations",{from:Math.max(0,now-7*86400000,previous===null?0:previous-5*60000)}).observations
  const hostFrom=Math.max(0,now-7*86400000,hostPrevious===null||!resumable?0:hostPrevious-5*60000)
  const nativeHost=readHostCounters({file:options.hostDB,from:hostFrom,to:now})
  const codexRows:LedgerRow[]=[]
  for(const s of harvest.sessions)for(const p of s.points)codexRows.push({id:"codex:"+hash([s.id,p.at,p.model,p.tokens]),source:"codex",sessionID:s.id,parentID:s.parentID,at:p.at,startedAt:p.at,route:{providerID:"openai",modelID:p.model,reasoning:p.reasoning??undefined,harness:"codex"},kind:s.source,state:"completed",tokens:p.tokens})
  const rows=[...ledgerRows(stored.records),...nativeHost.rows,...codexRows]
  const receipt:CollectorReceipt={at:now,from,parserVersion:4,hostScanAt:nativeHost.available?now:hostPrevious,scannedFiles:harvest.scannedFiles,readFiles:harvest.readFiles,unchangedFiles:harvest.unchangedFiles,
   newRequests:stored.records.length,newHostRows:nativeHost.rows.length,newCodexRows:codexRows.length,writtenRows:rows.length,...harvest.coverage,
   calibrationDiagnostics:[...harvest.diagnostics,...stored.diagnostics,...(harvest.coverage.malformedLines?["Malformed rollout lines leave calibration coverage incomplete"]:[])],
   diagnostics:[...(previous!==null&&now-previous>7*86400000?["Collector outage exceeds seven-day backfill; earlier activity may be missing"]:[]),...((stored as any).restarted&&previous!==null?["Request log was replaced; the collector re-read it from the start"]:[]),...harvest.diagnostics,...stored.diagnostics,...nativeHost.diagnostics,...(harvest.coverage.malformedLines?["Malformed rollout lines leave collection coverage incomplete"]:[])]}
  persistLedger({rows,observations,receipt,resolvedCounters:harvest.sessions.flatMap(s=>s.resolvedCounterAt.map(at=>({at,sessionID:s.id}))),gaps:harvest.sessions.flatMap(s=>s.gaps.map(g=>({...g,sessionID:s.id}))),cursors:{telemetry:(stored as any).cursor??null,rollouts:saveRolloutCursors()}},file)
  void accounts
  return {collected:true,receipt}
 } finally {
  const release=open(file);try{release.query("DELETE FROM meta WHERE key='lease' AND json_extract(body,'$.owner')=?").run(owner)}finally{release.close()}
 }
}
const KEY=Symbol.for("opencode.usage.passive-ledger")
export function startPassiveUsage() {
 const state=globalThis as any;if(state[KEY])return state[KEY].stop
 const tick=()=>void collectPassive().then(()=>updateBurnControls(readAccountUsage().accounts,readQuotaObservations(ACCOUNT_USAGE_FILE+".observations",{from:Date.now()-7*86400000}).observations)).catch(error=>console.error("[usage] passive collection failed",error instanceof Error?error.message:"unknown"))
 const timer=setInterval(tick,30000);timer.unref?.();const stop=()=>{clearInterval(timer);delete state[KEY]};state[KEY]={stop};tick();return stop
}

/** Numeric direct-session lookup for passive workflow capture; avoids loading global quota history per worker. */
export function readSessionLedgerRows(sessionID:string,from:number,to:number,file=PASSIVE_LEDGER_FILE):LedgerRow[]{
 if(!sessionID||!Number.isFinite(from)||!Number.isFinite(to)||to<from)throw Error("Invalid session ledger query")
 if(!existsSync(file))return []
 const db=readonlyDatabase(file)
 try{return (db.query("SELECT body FROM records WHERE session=? AND source='opencode' AND at>=? AND at<=? ORDER BY at,id").all(sessionID,from,to) as {body:string}[]).map(r=>JSON.parse(r.body) as LedgerRow)}finally{db.close()}
}
