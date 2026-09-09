import {updateBurnControls} from "./burn-control"
import {readHostCounters} from "./host-counters"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { TELEMETRY_FILE, readRequests } from "./telemetry-store"
import { harvestCodexUsage } from "./codex-harvest"
import { getAccountUsage, readAccountUsage, ACCOUNT_USAGE_FILE } from "./account-api"
import { readQuotaObservations } from "./calibration-store"
import type { Observation } from "./calibration"
import type { RequestRecord, TelemetryFilter, Tokens } from "./telemetry"
import type { AccountSnapshot } from "./account-types"

export const PASSIVE_LEDGER_FILE = process.env.OPENCODE_PASSIVE_LEDGER_FILE ?? TELEMETRY_FILE + ".ledger.sqlite"
export type LedgerRow = { id:string; source:"opencode"|"codex"|"opencode-host"; sessionID:string; parentID?:string|null; accountID?:string; regime?:string; at:number; recordedAt?:number; startedAt:number; route:RequestRecord["route"]; kind:string; state:string; tokens:Tokens; outputTotal?:number }
export type CollectorReceipt = { at:number; from:number; scannedFiles:number; readFiles:number; reconciledRequests:number; rejectedCounters:number; repeatedCounters:number; malformedLines:number; diagnostics:string[];hostScanAt?:number|null;parserVersion?:number;calibrationDiagnostics?:string[] }
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex")
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
export function persistLedger(input:{rows:LedgerRow[];observations:Observation[];resolvedCounters?:{sessionID:string;at:number}[];gaps?:{sessionID:string;at:number;reason:string;reportedLastTotal:number|null}[];receipt:CollectorReceipt},file=PASSIVE_LEDGER_FILE) {
 const db=open(file)
 try {db.transaction(()=>{
  const put=db.query("INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account=excluded.account,at=excluded.at,body=excluded.body WHERE coalesce(json_extract(excluded.body,'$.recordedAt'),excluded.at)>=coalesce(json_extract(records.body,'$.recordedAt'),records.at) AND NOT(json_extract(records.body,'$.state')!='running' AND json_extract(excluded.body,'$.state')='running')")
  for(const row of input.rows) put.run(row.id,row.source,row.sessionID,row.parentID??null,row.accountID??null,row.at,JSON.stringify(row))
  const gap=db.query("INSERT OR IGNORE INTO gaps VALUES(?,?,?)")
  for(const g of input.gaps??[])gap.run(hash(g),g.at,JSON.stringify(g))
  const resolveGap=db.query("UPDATE gaps SET body=json_set(body,'$.resolved',1,'$.resolution','Unchanged valid cumulative counters: no additional token movement') WHERE at=? AND json_extract(body,'$.sessionID')=? AND json_extract(body,'$.reason')='Last-request components do not reconcile to its total'")
  for(const r of input.resolvedCounters??[])resolveGap.run(r.at,r.sessionID)
  const quota=db.query("INSERT OR IGNORE INTO quota VALUES(?,?,?)")
  for(const o of input.observations)quota.run(o.id,o.at,JSON.stringify(o))
  db.query("INSERT OR IGNORE INTO meta VALUES('coverageFrom',?)").run(JSON.stringify(input.receipt.from))
  db.query("INSERT INTO meta VALUES('receipt',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body").run(JSON.stringify(input.receipt))
 })()}finally{db.close()}
}
export function ledgerRows(records:RequestRecord[]):LedgerRow[] {
 return records.map(r=>({id:"opencode:"+r.id,source:"opencode",sessionID:r.sessionID,parentID:r.parentID,accountID:r.accountID,regime:r.accountRegime,at:r.completedAt??r.startedAt,recordedAt:r.recordedAt??r.completedAt??r.startedAt,startedAt:r.startedAt,route:r.route,kind:r.kind,state:r.state,tokens:r.tokens,outputTotal:r.outputTotal}))
}
/** Event-driven native counters are durable immediately; the periodic scan backfills missed events. */
export function recordLedgerRequest(record:RequestRecord,file=PASSIVE_LEDGER_FILE) {
 const db=open(file),row=ledgerRows([record])[0]
 try{db.query("INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account=excluded.account,at=excluded.at,body=excluded.body WHERE coalesce(json_extract(excluded.body,'$.recordedAt'),excluded.at)>=coalesce(json_extract(records.body,'$.recordedAt'),records.at) AND NOT(json_extract(records.body,'$.state')!='running' AND json_extract(excluded.body,'$.state')='running')").run(row.id,row.source,row.sessionID,row.parentID??null,row.accountID??null,row.at,JSON.stringify(row))}finally{db.close()}
}
export function readLedger(options:TelemetryFilter={},file=PASSIVE_LEDGER_FILE) {
 if(!existsSync(file))return {rows:[] as LedgerRow[],observations:[] as Observation[],receipt:null as CollectorReceipt|null,coverageFrom:null as number|null,resolvedGaps:0,gaps:[] as {sessionID:string;at:number;reason:string;reportedLastTotal:number|null}[],diagnostics:["Passive collector has not recorded a sample"]}
 const db=new Database(file,{readonly:true});db.exec("PRAGMA busy_timeout=1000")
 try {
  const from=options.from??0,to=options.to??Date.now()
  const conditions=["at>=?","at<=?"],params:(string|number)[]=[from,to]
  if(options.accountID){conditions.push("account=?");params.push(options.accountID)}
  if(options.sessionID){
   if(options.includeWorkers){conditions.push("session IN (WITH RECURSIVE family(id) AS (SELECT ? UNION SELECT r.session FROM records r JOIN family f ON r.parent=f.id) SELECT id FROM family)");params.push(options.sessionID)}
   else{conditions.push("session=?");params.push(options.sessionID)}
  }
  const rows=(db.query("SELECT body FROM records WHERE "+conditions.join(" AND ")+" ORDER BY at,id").all(...params) as {body:string}[]).map(r=>JSON.parse(r.body) as LedgerRow)
  const meta=(key:string)=>{const r=db.query("SELECT body FROM meta WHERE key=?").get(key) as {body:string}|null;return r?JSON.parse(r.body):null}
  const resolvedGaps=(db.query("SELECT count(*) count FROM gaps WHERE json_extract(body,'$.resolved')=1").get() as {count:number}).count
  return {rows,resolvedGaps,observations:(db.query("SELECT body FROM quota WHERE at>=? AND at<=? ORDER BY at").all(from,to) as {body:string}[]).map(r=>JSON.parse(r.body) as Observation),gaps:(db.query("SELECT body FROM gaps WHERE at>=? AND at<=? AND coalesce(json_extract(body,'$.resolved'),0)=0 ORDER BY at").all(from,to) as {body:string}[]).map(r=>JSON.parse(r.body) as {sessionID:string;at:number;reason:string;reportedLastTotal:number|null}),receipt:meta("receipt") as CollectorReceipt|null,coverageFrom:meta("coverageFrom") as number|null,diagnostics:[] as string[]}
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
/** Every host can call this; a SQLite lease elects one scanner for each 30-second sample. */
export async function collectPassive(options:{file?:string;root?:string;hostDB?:string;now?:number;accounts?:AccountSnapshot;records?:RequestRecord[];observations?:Observation[];force?:boolean}={}) {
 const file=options.file??PASSIVE_LEDGER_FILE,now=options.now??Date.now(),db=open(file)
 const owner=randomUUID()
 let previous:number|null=null,hostPrevious:number|null=null,parserVersion=0,claimed=false
 try {db.transaction(()=>{
  const get=(key:string)=>{const r=db.query("SELECT body FROM meta WHERE key=?").get(key) as {body:string}|null;return r?JSON.parse(r.body):null}
  previous=get("receipt")?.at??null;hostPrevious=get("receipt")?.hostScanAt??null;parserVersion=get("receipt")?.parserVersion??0
  if((get("lease")?.until??0)>now||(!options.force&&previous!==null&&now-previous<30000))return
  db.query("INSERT INTO meta VALUES('lease',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body").run(JSON.stringify({owner,until:now+120000}));claimed=true
 })()}finally{db.close()}
 if(!claimed)return {collected:false}
 try {
  const from=Math.max(0,now-7*86400000,previous===null||parserVersion<2?0:previous-5*60000)
  const harvest=harvestCodexUsage({root:options.root,from,now}),stored=options.records?{records:options.records,diagnostics:[]}:readRequests()
  // Quota refresh shares the existing account cache and provider backoff across processes.
  await (options.accounts?Promise.resolve(options.accounts):getAccountUsage())
  const observations=options.observations??readQuotaObservations(ACCOUNT_USAGE_FILE+".observations").observations
  const nativeHost=readHostCounters({file:options.hostDB,from:Math.max(0,now-7*86400000,hostPrevious===null?0:hostPrevious-5*60000),to:now})
  const rows=[...ledgerRows(stored.records),...nativeHost.rows]
  for(const s of harvest.sessions)for(const p of s.points)rows.push({id:"codex:"+hash([s.id,p.at,p.model,p.tokens]),source:"codex",sessionID:s.id,parentID:s.parentID,at:p.at,startedAt:p.at,route:{providerID:"openai",modelID:p.model,reasoning:p.reasoning??undefined,harness:"codex"},kind:s.source,state:"completed",tokens:p.tokens})
  const receipt={at:now,from,parserVersion:2,hostScanAt:nativeHost.available?now:hostPrevious,scannedFiles:harvest.scannedFiles,readFiles:harvest.readFiles,...harvest.coverage,calibrationDiagnostics:[...harvest.diagnostics,...stored.diagnostics,...(harvest.coverage.malformedLines?["Malformed rollout lines leave calibration coverage incomplete"]:[])],diagnostics:[...(previous!==null&&now-previous>7*86400000?["Collector outage exceeds seven-day backfill; earlier activity may be missing"]:[]),...harvest.diagnostics,...stored.diagnostics,...nativeHost.diagnostics,...(harvest.coverage.malformedLines?["Malformed rollout lines leave collection coverage incomplete"]:[])]}
  persistLedger({rows,observations,receipt,resolvedCounters:harvest.sessions.flatMap(s=>s.resolvedCounterAt.map(at=>({at,sessionID:s.id}))),gaps:harvest.sessions.flatMap(s=>s.gaps.map(g=>({...g,sessionID:s.id})))},file)
  return {collected:true,receipt}
 } finally {
  const release=open(file);try{release.query("DELETE FROM meta WHERE key='lease' AND json_extract(body,'$.owner')=?").run(owner)}finally{release.close()}
 }
}
const KEY=Symbol.for("opencode.usage.passive-ledger")
export function startPassiveUsage() {
 const state=globalThis as any;if(state[KEY])return state[KEY].stop
 const tick=()=>void collectPassive().then(()=>updateBurnControls(readAccountUsage().accounts,readQuotaObservations(ACCOUNT_USAGE_FILE+".observations").observations)).catch(error=>console.error("[usage] passive collection failed",error instanceof Error?error.message:"unknown"))
 const timer=setInterval(tick,30000);timer.unref?.();const stop=()=>{clearInterval(timer);delete state[KEY]};state[KEY]={stop};tick();return stop
}

/** Numeric direct-session lookup for passive workflow capture; avoids loading global quota history per worker. */
export function readSessionLedgerRows(sessionID:string,from:number,to:number,file=PASSIVE_LEDGER_FILE):LedgerRow[]{
 if(!sessionID||!Number.isFinite(from)||!Number.isFinite(to)||to<from)throw Error("Invalid session ledger query")
 if(!existsSync(file))return []
 const db=new Database(file,{readonly:true});db.exec("PRAGMA busy_timeout=1000")
 try{return (db.query("SELECT body FROM records WHERE session=? AND source='opencode' AND at>=? AND at<=? ORDER BY at,id").all(sessionID,from,to) as {body:string}[]).map(r=>JSON.parse(r.body) as LedgerRow)}finally{db.close()}
}
