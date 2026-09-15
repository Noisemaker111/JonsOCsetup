/**
 * What is actually running on this machine, for decisions that must not be guesses.
 *
 * Release and lock ownership were both decided from a single pid, and a single pid answers only
 * "is this exact number alive". It cannot answer the question that matters -- did the thing this
 * record was written for stop -- because a launcher spawns a host child, the child outlives a
 * killed launcher, and Windows hands the launcher's number to something unrelated soon after.
 * So ownership needs the process table: parents, image paths, command lines and start times.
 *
 * A snapshot is either taken or it is not. There is no partial answer and no assumed-empty
 * fallback: a caller that cannot list processes must refuse its decision and say so, because
 * "nothing matched" and "nothing was looked at" are the same shape and opposite meanings.
 */
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'

/** EPERM means the process exists and is not ours; ESRCH means it is provably gone. */
export const running=pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true}catch(error){return error.code==='EPERM'}}

/**
 * Control characters are stripped here, not in the caller. A command line is arbitrary user text:
 * something on this machine was running with a raw control byte in its arguments, ConvertTo-Json
 * emitted it unescaped, and the whole listing failed to parse -- which correctly refused every
 * release on the machine, for a reason that had nothing to do with any of them.
 */
const CLEAN=`-replace '[\\u0000-\\u001F\\u007F]',' '`
const WINDOWS_QUERY=`$ErrorActionPreference='Stop';$epoch=[datetime]'1970-01-01';@(Get-CimInstance Win32_Process|ForEach-Object{[pscustomobject]@{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;name=[string]$_.Name ${CLEAN};image=[string]$_.ExecutablePath ${CLEAN};command=[string]$_.CommandLine ${CLEAN};createdAt=$(if($_.CreationDate){[int64]($_.CreationDate.ToUniversalTime()-$epoch).TotalMilliseconds}else{0})}})|ConvertTo-Json -Compress -Depth 3`

function windows(){
 const shell=process.env.SystemRoot?join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'powershell.exe'
 const run=spawnSync(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',WINDOWS_QUERY],{encoding:'utf8',windowsHide:true,timeout:30_000,maxBuffer:64*1024*1024})
 if(run.error)throw Error(`${shell} could not run: ${run.error.message}`)
 if(run.status!==0)throw Error(`${shell} exited ${run.status}: ${(run.stderr||'').trim().slice(0,300)||'no diagnostic'}`)
 const parsed=JSON.parse(run.stdout)
 return Array.isArray(parsed)?parsed:[parsed]
}

function posix(){
 const run=spawnSync('ps',['-A','-o','pid=,ppid=,etimes=,comm=,args='],{encoding:'utf8',timeout:30_000,maxBuffer:64*1024*1024})
 if(run.error)throw Error(`ps could not run: ${run.error.message}`)
 if(run.status!==0)throw Error(`ps exited ${run.status}: ${(run.stderr||'').trim().slice(0,300)||'no diagnostic'}`)
 const now=Date.now()
 return run.stdout.split('\n').map(line=>{
  const parts=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line)
  if(!parts)return undefined
  return {pid:Number(parts[1]),ppid:Number(parts[2]),name:parts[4],image:parts[4],command:parts[5],createdAt:now-Number(parts[3])*1000}
 }).filter(Boolean)
}

/**
 * The running process table, or the reason there isn't one. Never throws: the caller's job is to
 * refuse on `unavailable`, and an exception here would instead look like a crashed cleanup pass.
 */
export function processSnapshot(){
 try{
  const processes=(process.platform==='win32'?windows():posix()).filter(entry=>Number.isSafeInteger(entry.pid)&&entry.pid>0)
  if(!processes.length)throw Error('the process listing came back empty, which no live machine produces')
  return {processes,at:Date.now()}
 }catch(error){return {unavailable:String(error?.message??error)}}
}
