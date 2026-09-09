import {verifyGiverBinding} from './user-giver'
import {runtimeQueuePath,devQueueGeneration} from './runtime-queues'
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {acquireLock} from './locking'
import {verifySourceBinding} from './project'
import type {QuestStore} from './store'
import type {StartRun,QuestContext} from './api'
import type {QuestHost} from './runtime'

type Notice={questID:string;runID:string;context:QuestContext;agent?:string;model?:unknown;state:'waiting'|'sending'|'accepted'|'unknown';error?:string}
/** Direct Quest runs have a return address even when no project_route was used. */
export class QuestWorkerReturns {
 constructor(readonly store:QuestStore,readonly host:QuestHost,readonly generation=devQueueGeneration()){}
 private directory(){return runtimeQueuePath(this.store.runtime,'worker-returns',this.generation)}
 private save(row:Notice){const path=join(this.directory(),row.runID+'.json');mkdirSync(this.directory(),{recursive:true});const tmp=path+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(row));renameSync(tmp,path)}
 async watch(input:Parameters<StartRun>[0]){
  const parent=await this.host.get({sessionID:input.context.sessionID}),session=parent?.data??parent
  const lock=acquireLock(this.store.runtime,'worker-return-'+input.runID)
  try{if(existsSync(join(this.directory(),input.runID+'.json')))return;this.save({questID:input.quest.id,runID:input.runID,context:input.context,agent:session?.agent,model:session?.model,state:'waiting'})}finally{lock.release()}
 }
 async tick(){
  if(!existsSync(this.directory()))return
  for(const name of readdirSync(this.directory()).filter(n=>/^[a-f0-9]{26}\.json$/.test(n))){
   let lock;try{lock=acquireLock(this.store.runtime,'worker-return-'+name.slice(0,-5),{timeoutMs:0})}catch{continue}
   try{
    const row:Notice=JSON.parse(readFileSync(join(this.directory(),name),'utf8'));if(row.state!=='waiting')continue
    const q=this.store.read(row.questID),run=q?.sessions.find(s=>s.runID===row.runID)
    if(!q||!run||!['completed','failed','cancelled'].includes(run.state))continue
    const parent=await this.host.get({sessionID:row.context.sessionID}),session=parent?.data??parent
    try{verifyGiverBinding(this.store,row.context,session)}catch(error){row.error=String(error);this.save(row);continue}
    if(session?.agent!==row.agent||JSON.stringify(session?.model)!==JSON.stringify(row.model)){row.error='Giver model or agent changed; return retained for inspection';this.save(row);continue}
    row.state='sending';this.save(row)
    const steps=q.stages.filter(s=>run.deliverables.includes(s.id)).map(s=>({id:s.id,title:s.title,state:s.status,note:s.note?.slice(0,1500)}))
    try{
     await this.host.prompt({sessionID:row.context.sessionID,id:'msg_questreturn'+row.runID,text:'Automatic Quest worker update for '+q.title+'.\n'+JSON.stringify({state:run.state,workerSessionID:run.sessionID??run.openCodeSessionId,result:run.result,steps})+'\nInspect the saved Quest and actual evidence. A terminal turn alone is not completion. Report blockers or the verified deliverable; continue only already-authorized pending work. An active continuation owns queued steps; do not launch duplicates.',metadata:{questWorkerReturn:true,questID:q.id,runID:row.runID}})
     row.state='accepted'
    }catch(error){row.state='unknown';row.error=String(error)}
    this.save(row)
   }finally{lock.release()}
  }
 }
}
