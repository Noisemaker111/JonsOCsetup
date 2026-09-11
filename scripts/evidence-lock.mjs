/**
 * A mutual-exclusion lock that can be told apart from a lock that outlived its process.
 *
 * The lock is a directory because an exclusive create is the one thing every filesystem agrees on,
 * and it carries owner.json so a lock that is working can be told apart from one that is stranded.
 * A bare directory records nothing: a run killed mid-operation leaves it behind and every later
 * attempt fails while nothing on the machine can ever remove it, which is a strand, not a wait.
 * Reclaim is therefore evidence-driven -- the owning process is provably gone, or the hold is past
 * a ceiling no real pass approaches -- never a shortened timeout, and never silent: it prints what
 * it took and why, and keeps the record it removed under the caller's evidence directory.
 *
 * The opposite mistake is the one an mtime alone makes. `Date.now()-mtime>120000 && rm` takes the
 * lock from a promotion that is still copying trees and validating a host, with nothing recorded
 * and nobody told. An age is not evidence of death; the owner's absence from the process table is.
 */
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,statSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {hostname,homedir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {running} from './process-evidence.mjs'

/** A hold younger than this is never judged: a reclaim decision must never land on a claim being made right now. */
export const SETTLE=30_000
/** Longest plausible hold. A lease write is one small file; a retirement pass or a promotion is work measured in seconds. */
export const CEILING=15*60_000
const ATTEMPTS=4,PAUSE=250
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const atomic=(p,v)=>{mkdirSync(dirname(p),{recursive:true});const t=p+'.'+process.pid+'.tmp';writeFileSync(t,JSON.stringify(v,null,2)+'\n');renameSync(t,p)}
const sleep=ms=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}
export const ago=ms=>ms<1000?`${ms}ms`:ms<60_000?`${Math.round(ms/1000)}s`:ms<3_600_000?`${Math.round(ms/60_000)}m`:`${(ms/3_600_000).toFixed(1)}h`
/** Where every reclaim on this machine is recorded, whatever took it, so one directory answers "what removed my lock". */
export const reclaimEvidence=()=>join(homedir(),'.config','opencode','.channels','lock-reclaims')

const settled=lock=>lock.settle??SETTLE
const ceilingOf=lock=>lock.ceiling??CEILING

function heldBy(lock){
 let at;try{at=statSync(lock.path).mtimeMs}catch{return undefined}
 let record;try{record=read(join(lock.path,'owner.json'))}catch{}
 const started=record?.startedAt?Date.parse(record.startedAt):NaN
 return {record,age:Math.max(0,Date.now()-(Number.isFinite(started)?started:at))}
}
export const describe=holder=>(holder.record?`a ${holder.record.operation} taken by pid ${holder.record.pid} on ${holder.record.host} at ${holder.record.startedAt}`:'an operation that recorded no owner')+` (${ago(holder.age)} ago)`

function staleReason(lock,holder){
 if(holder.age<settled(lock))return undefined
 const record=holder.record
 if(record&&!running(record.pid))return `the ${record.operation} that took it in pid ${record.pid} at ${record.startedAt} (${ago(holder.age)} ago) is no longer running`
 if(holder.age<ceilingOf(lock))return undefined
 return record
  ?`pid ${record.pid} still exists but has held it for ${ago(holder.age)}, past the ${ago(ceilingOf(lock))} ceiling for ${lock.subject} ${record.operation}, so it is wedged or that pid was reused`
  :`it records no owner at all and is ${ago(holder.age)} old, past the ${ago(ceilingOf(lock))} ceiling for ${lock.subject} operation`
}

function reclaim(lock,holder,reason,operation){
 const moved=`${lock.path}.reclaimed-${randomUUID()}`
 try{renameSync(lock.path,moved)}catch{return false} // another process reclaimed it first
 let taken;try{taken=read(join(moved,'owner.json'))}catch{}
 if(JSON.stringify(taken??null)!==JSON.stringify(holder.record??null)){
  // The lock changed hands between reading it and moving it; the holder we judged is not the one we took.
  try{renameSync(moved,lock.path);return false}catch(error){throw Error(`Reclaimed ${lock.path} after it changed hands and could not restore it; inspect ${moved} before continuing: ${error}`)}
 }
 const evidence=join(lock.evidence??reclaimEvidence(),`${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}.json`)
 atomic(evidence,{lock:lock.path,subject:lock.subject,reason,heldFor:ago(holder.age),owner:taken??null,reclaimedBy:{pid:process.pid,operation,host:hostname()},at:new Date().toISOString()})
 rmSync(moved,{recursive:true,force:true})
 process.stderr.write(`[${lock.label}] Reclaimed ${lock.path}: ${reason}. Removed ${describe(holder)}; saved it to ${evidence}.\n`)
 return true
}

function claim(lock,operation){
 mkdirSync(dirname(lock.path),{recursive:true})
 try{mkdirSync(lock.path)}catch{return undefined}
 const token=randomUUID()
 try{writeFileSync(join(lock.path,'owner.json'),JSON.stringify({token,operation,pid:process.pid,host:hostname(),startedAt:new Date().toISOString()},null,2)+'\n')}
 catch(error){rmSync(lock.path,{recursive:true,force:true});throw error}
 return token
}

function release(lock,token){
 if(!existsSync(lock.path))return
 let owner;try{owner=read(join(lock.path,'owner.json'))}catch{}
 if(owner&&owner.token!==token){process.stderr.write(`[${lock.label}] Left ${lock.path} alone: it now holds ${describe({record:owner,age:0})}, not this operation.\n`);return}
 try{rmSync(lock.path,{recursive:true,force:true})}catch(error){process.stderr.write(`[${lock.label}] Could not remove ${lock.path}: ${error}\n`)}
}

/**
 * One acquisition attempt: the token, or how long to wait before trying again. Split out so the
 * blocking and awaiting callers share the identical decision and only differ in how they pause.
 */
function attempt(lock,operation,round){
 const token=claim(lock,operation)
 if(token!==undefined)return {token}
 const holder=heldBy(lock)
 if(!holder){ // released while we looked; claim again
  if(round>=ATTEMPTS)throw Error(`${lock.activity} is in progress; retry shortly`)
  return {wait:0}
 }
 const reason=staleReason(lock,holder)
 if(reason&&reclaim(lock,holder,reason,operation))return {wait:0}
 if(round>=ATTEMPTS)throw Error(`${lock.activity} is in progress; retry shortly. The lock holds ${describe(holder)}. A later attempt reclaims it once that process is gone or the hold passes ${ago(ceilingOf(lock))}.`)
 return {wait:reason?0:PAUSE}
}

export function withLock(lock,operation,run){
 for(let round=0;;round++){
  const step=attempt(lock,operation,round)
  if(step.token!==undefined){try{return run()}finally{release(lock,step.token)}}
  if(step.wait)sleep(step.wait)
 }
}

export async function withLockAsync(lock,operation,run){
 for(let round=0;;round++){
  const step=attempt(lock,operation,round)
  if(step.token!==undefined){try{return await run()}finally{release(lock,step.token)}}
  if(step.wait)await new Promise(done=>setTimeout(done,step.wait))
 }
}
