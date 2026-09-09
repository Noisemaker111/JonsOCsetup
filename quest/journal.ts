import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { createHash } from "node:crypto"
import { acquireLock } from "./locking"
import { dirname, join } from "node:path"
import { validEvent } from "./events"
import type { QuestEvent } from "./types"

export function journalPath(runtimeRoot: string, questID: string): string { return join(runtimeRoot, "journals", `${questID}.jsonl`) }
export function appendEvent(runtimeRoot: string, event: QuestEvent): void {
  if (!validEvent(event)) throw new Error("Invalid Quest event: a complete event envelope and object payload are required. Journal preserved.")
  const path = journalPath(runtimeRoot, event.questID); mkdirSync(dirname(path), { recursive: true })
  let separator=""
  if(existsSync(path)){const prior=readFileSync(path,"utf8");if(prior&&!prior.endsWith("\n")){try{const tail=JSON.parse(prior.slice(prior.lastIndexOf("\n")+1));if(!validEvent(tail))throw Error("invalid")}catch{throw new Error("Interrupted Quest journal append; preserve and repair the final line before writing "+path)}separator="\n"}}
  appendFileSync(path, `${separator}${JSON.stringify(event)}\n`, "utf8")
  const fd = openSync(path, "r+"); try { fsyncSync(fd) } finally { closeSync(fd) }
}
export function readEvents(runtimeRoot: string, questID: string): QuestEvent[] {
  const path = journalPath(runtimeRoot, questID); if (!existsSync(path)) return []
  const bytes=readFileSync(path),text=bytes.toString("utf8"),lines=text.split(/\r?\n/),events:QuestEvent[]=[]
  const recoveryFile=path+".recovery.json"
  const recovery=existsSync(recoveryFile)?JSON.parse(readFileSync(recoveryFile,"utf8")):undefined
  if(recovery && (recovery.schema!==1 || !Number.isSafeInteger(recovery.bytes) || recovery.bytes<1 || recovery.bytes>bytes.length || sha(bytes.subarray(0,recovery.bytes))!==recovery.sha256))throw new Error("Quest journal recovery evidence does not match; journal preserved")
  for(const [index,line]of lines.entries()){
    if(!line.trim())continue
    let event:unknown
    try{event=JSON.parse(line)}catch{
      if(index===lines.length-1&&!text.endsWith("\n"))break // An interrupted append has no complete event to replay.
      throw new Error("Unreadable Quest journal line "+(index+1)+" in "+path+"; preserve and repair the journal before writing this Quest")
    }
    if(recovery && index+1===recovery.line && !validEvent(event) && sha(Buffer.from(line))===recovery.lineSha256)continue
    if(!validEvent(event))throw new Error("Invalid Quest event at line "+(index+1)+" in "+path+"; a complete event envelope and object payload are required. Journal preserved.")
    events.push(event)
  }
  return events
}

const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex")
/** Explicitly discard only an incomplete final claim, preserving the original journal. */
export function recoverIncompleteClaim(runtimeRoot:string,questID:string,input:{expectedSha256:string;reason:string;apply?:boolean}) {
 if(!/^[0-9a-hjkmnp-tv-z]{26}$/.test(questID))throw Error("Invalid Quest ID")
 if(!input.reason?.trim())throw Error("Recovery reason required")
 const lock=acquireLock(runtimeRoot,questID)
 try {
  const path=journalPath(runtimeRoot,questID),bytes=readFileSync(path),digest=sha(bytes)
  if(digest!==input.expectedSha256)throw Error("Quest journal changed since inspection")
  if(existsSync(path+".recovery.json"))throw Error("Quest already has a recovery receipt; inspect it")
  const text=bytes.toString("utf8"),lines=text.trimEnd().split(/\r?\n/)
  const events=lines.map(line=>JSON.parse(line)),last=events.at(-1)
  if(!text.endsWith("\n") || events.slice(0,-1).some(e=>!validEvent(e)) || !last || last.type!=="session-claimed" || Object.hasOwn(last,"payload") || !validEvent({...last,payload:{}}) || last.questID!==questID)throw Error("Recovery supports only a complete final session-claimed envelope missing payload")
  const receipt={schema:1,questID,line:lines.length,bytes:bytes.length,sha256:digest,lineSha256:sha(Buffer.from(lines.at(-1)!)),eventID:last.eventID,action:"discard-incomplete-claim",reason:input.reason,at:new Date().toISOString()}
  if(input.apply){
   const backup=path+"."+digest+".preserved";if(!existsSync(backup))writeFileSync(backup,bytes,{flag:"wx"})
   if(sha(readFileSync(backup))!==digest)throw Error("Recovery backup mismatch")
   const temporary=path+".recovery."+process.pid+".tmp";writeFileSync(temporary,JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});renameSync(temporary,path+".recovery.json")
  }
  return {...receipt,applied:input.apply===true}
 }finally{lock.release()}
}
