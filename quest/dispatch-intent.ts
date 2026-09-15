import {mkdirSync,readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync} from 'node:fs'
import {join} from 'node:path'
import {hostname} from 'node:os'

type Intent={version:1;runID:string;host:string;pid:number;phase:'preflight'|'creating'|'created'|'prompting'|'command';sessionID?:string;at:string}
const path=(runtime:string,runID:string)=>{
 if(!/^[a-f0-9]{26}$/.test(runID))throw Error('Invalid dispatch identity')
 return join(runtime,'dispatch-intents',runID+'.json')
}
/** The record precedes every operation that can create or prompt a worker. */
export function beginDispatchIntent(runtime:string,runID:string){
 const file=path(runtime,runID)
 let record:Intent={version:1,runID,host:hostname(),pid:process.pid,phase:'preflight',at:new Date().toISOString()}
 mkdirSync(join(runtime,'dispatch-intents'),{recursive:true})
 const save=()=>{const tmp=file+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(record));const fd=openSync(tmp,'r+');try{fsyncSync(fd)}finally{closeSync(fd)}renameSync(tmp,file)}
 save()
 return {advance(phase:Intent['phase'],sessionID?:string){record={...record,phase,...(sessionID?{sessionID}:{}),at:new Date().toISOString()};save()}}
}

/** Only an absent local owner before worker creation proves an unstarted run. */
export function interruptedPreflight(runtime:string,runID:string):string|undefined{
 let record:Intent
 try{record=JSON.parse(readFileSync(path(runtime,runID),'utf8'))}catch{return}
 if(record.version!==1||record.runID!==runID||record.host!==hostname()||record.phase!=='preflight'||!Number.isSafeInteger(record.pid)||record.pid<1)return
 try{process.kill(record.pid,0);return}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')return}
 return `Dispatch owner ${record.pid} on ${record.host} exited during preflight, before any worker creation or command launch. Intent recorded at ${record.at}. Retained workspace and run evidence; retry this Quest after its preparation requirements are satisfied.`
}
