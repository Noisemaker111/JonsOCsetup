import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from "node:fs"
import {join,dirname} from "node:path"
import {acquireLock} from "../quest/locking"
import {ContextCheckpoints,decideContext,type ContextForecast,type ContextPolicy,type RecoverableContext} from "./context-manager"
import {readRequests,aggregateTelemetry,type RequestRecord} from "../usage/telemetry-api"
type State={revision:number;seen:string[];inputs:{id:string;text:string}[];pending:string[];active:boolean;decision?:ReturnType<typeof decideContext>;forecast?:Omit<ContextForecast,"currentTokens">;checkpointID?:string;choice?:"retain"|"compact";compaction?:{receipt:string;startedAt:number;endedAt?:number;outcome?:"active"|"failed"};error?:string}
type Compact=(input:{sessionID:string;checkpointID:string})=>Promise<{receipt:string}>
/** Native events own revisions and pending-work accounting. Model estimates never overwrite those facts. */
export class AdaptiveContextRuntime {
 readonly checkpoints:ContextCheckpoints
 constructor(readonly directory:string,readonly options:{records?:()=>RequestRecord[];policy:()=>ContextPolicy|undefined;compact?:Compact;headroom?:()=>{output:number;tools:number}|undefined;pendingWorkers?:(sessionID:string)=>number;routeLimit?:(sessionID:string)=>Promise<number|undefined>}){this.checkpoints=new ContextCheckpoints(join(directory,"checkpoints"))}
 private file(sessionID:string){if(!/^[a-zA-Z0-9_-]{1,150}$/.test(sessionID))throw Error("Invalid context session identity");return join(this.directory,sessionID+".runtime.json")}
 state(sessionID:string):State{const file=this.file(sessionID);return existsSync(file)?JSON.parse(readFileSync(file,"utf8")):{revision:0,seen:[],inputs:[],pending:[],active:false}}
 private change(sessionID:string,change:(state:State)=>void){const file=this.file(sessionID),lock=acquireLock(dirname(file),"context-runtime-"+sessionID);try{const state=this.state(sessionID);change(state);mkdirSync(dirname(file),{recursive:true});const tmp=file+"."+process.pid+".tmp";writeFileSync(tmp,JSON.stringify(state),{mode:0o600});renameSync(tmp,file);return state}finally{lock.release()}}
 reconcile(sessionID:string){const state=this.state(sessionID),checkpoint=this.checkpoints.read(sessionID).find(c=>c.id===state.checkpointID);if(!checkpoint||!state.compaction?.outcome||checkpoint.hostReceipt!==state.compaction.receipt)return;const current=aggregateTelemetry(this.options.records?.()??readRequests().records,{sessionID}).context.current;const after=current&&current.at>=(state.compaction.endedAt??Infinity)?current.tokens:undefined;if(checkpoint.state==="requested")this.checkpoints.confirm(sessionID,checkpoint.id,{currentRevision:state.revision,hostReceipt:state.compaction.receipt,success:state.compaction.outcome==="active",afterTokens:after});else if(checkpoint.state==="active"&&after!==undefined)this.checkpoints.measureAfter(sessionID,checkpoint.id,after)}
 inspect(sessionID:string){this.reconcile(sessionID);const state=this.state(sessionID);return {revision:state.revision,pendingTools:state.pending.length,pendingWorkers:this.options.pendingWorkers?.(sessionID)??0,active:state.active,checkpoint:this.checkpoints.read(sessionID).at(-1)??null,automatic:this.options.policy()?.automatic??false,adapterAvailable:!!this.options.compact,forecast:state.forecast??null,decision:state.decision??null,error:state.error??null}}
 prepare(sessionID:string,context:Omit<RecoverableContext,"revision">,forecast:Omit<ContextForecast,"currentTokens">,reason:string){
  this.reconcile(sessionID)
  const state=this.state(sessionID),previous=this.checkpoints.read(sessionID).at(-1)
  if(previous?.state==="requested")throw Error("Compaction outcome is still pending; reconcile it before replacing the checkpoint. New corrections remain retained.")
  const latest=aggregateTelemetry(this.options.records?.()??readRequests().records,{sessionID}).context.current
  // Keep the latest occurrence in chronological order so repeated corrections can supersede intervening ones.
  const retained=(items:string[])=>items.filter((item,index)=>items.lastIndexOf(item)===index)
  const checkpoint=this.checkpoints.prepare(sessionID,{...context,revision:state.revision,
   corrections:retained([...(previous?.context.corrections??[]),...context.corrections,...state.inputs.map(i=>i.text)]),
   permissions:retained([...(previous?.context.permissions??[]),...context.permissions]),
   historyReferences:retained([...(previous?.context.historyReferences??[]),...context.historyReferences,...state.inputs.map(i=>"session:"+sessionID+"/inbox:"+i.id)])
  },reason,latest?.tokens)
  this.change(sessionID,s=>{s.checkpointID=checkpoint.id;s.forecast=forecast;s.inputs=s.inputs.filter(i=>!state.inputs.some(old=>old.id===i.id));s.choice=undefined;s.error=undefined})
  return checkpoint
 }
 async choose(sessionID:string,choice:"retain"|"compact"){if(choice==="compact"&&!this.options.compact)throw Error("The host plugin interface does not expose compaction admission. Checkpoint retained; native /compact remains available.");this.change(sessionID,s=>{s.choice=choice});return this.inspect(sessionID)}
 tool(sessionID:string,id:string,pending:boolean){this.change(sessionID,s=>{s.pending=pending?[...new Set([...s.pending,id])]:s.pending.filter(x=>x!==id)})}
 async event(event:any){if(!["session.inbox.enqueued","session.instructions.updated","session.execution.started","session.execution.succeeded","session.execution.failed","session.execution.interrupted","session.compaction.started","session.compaction.ended","session.compaction.failed"].includes(event?.type))return;const sessionID=event?.data?.sessionID;if(!sessionID||!event.id)return;const prior=this.state(sessionID);if(prior.seen.includes(event.id))return
  let processed=false;const state=this.change(sessionID,s=>{if(s.seen.includes(event.id))return;processed=true;s.seen.push(event.id);const data=event.data
   if(event.type==="session.inbox.enqueued"&&data.item?.type==="user"){s.revision++;s.inputs.push({id:data.inboxID,text:String(data.item.payload?.text??"")})}
   if(event.type==="session.instructions.updated"){s.revision++;s.inputs.push({id:event.id,text:data.text??JSON.stringify(data.delta)})}
   if(event.type==="session.execution.started")s.active=true
   if(["session.execution.succeeded","session.execution.failed","session.execution.interrupted"].includes(event.type))s.active=false
   if(event.type==="session.compaction.started"&&data.inputID)s.compaction={receipt:data.inputID,startedAt:typeof event.created==="number"?event.created:Date.parse(event.created)}
   if(event.type==="session.compaction.ended"&&s.compaction){s.compaction.outcome="active";s.compaction.endedAt=typeof event.created==="number"?event.created:Date.parse(event.created)}
   if(event.type==="session.compaction.failed"&&s.compaction&&(!data.inputID||data.inputID===s.compaction.receipt)&&!s.compaction.outcome)s.compaction.outcome="failed"
  })
  if(!processed)return
  const checkpoint=this.checkpoints.read(sessionID).find(c=>c.id===state.checkpointID)
  if(event.type==="session.compaction.started"&&checkpoint?.state==="prepared"&&state.revision===checkpoint.context.revision&&state.compaction)await this.checkpoints.request(checkpoint,state.revision,async()=>({receipt:state.compaction!.receipt}))
  if(state.compaction?.outcome&&checkpoint?.state==="requested"&&checkpoint.hostReceipt===state.compaction.receipt)this.checkpoints.confirm(sessionID,checkpoint.id,{currentRevision:state.revision,hostReceipt:state.compaction.receipt,success:state.compaction.outcome==="active"})
  if(event.type==="session.execution.succeeded")await this.boundary(sessionID)
 }
 async boundary(sessionID:string){
  if(!this.options.policy()||!this.state(sessionID).checkpointID)return
  // Route lookup can yield to new instructions, tools, execution or user choices.
  // Read every boundary fact afterwards; never admit from the pre-await snapshot.
  const verifiedRouteLimit=await this.options.routeLimit?.(sessionID)
  this.reconcile(sessionID);const state=this.state(sessionID),policy=this.options.policy(),checkpoint=this.checkpoints.read(sessionID).find(c=>c.id===state.checkpointID);if(!policy||!checkpoint||checkpoint.state!=="prepared"||!state.forecast)return
  const current=aggregateTelemetry(this.options.records?.()??readRequests().records,{sessionID}).context.current;if(!current){this.change(sessionID,s=>{s.error="Current context measurement unavailable; history retained"});return}
  const headroom=this.options.headroom?.();if(!headroom||![headroom.output,headroom.tools].every(v=>Number.isFinite(v)&&v>=0)){this.change(sessionID,s=>{s.error="Configure required output and tool headroom before adaptive compaction"});return}
  const lastActive=this.checkpoints.read(sessionID).filter(c=>c.state==="active").at(-1)
  const decision=decideContext({...state.forecast,currentTokens:current.tokens},{safe:!state.active,pendingTools:state.pending.length,pendingWorkerResults:this.options.pendingWorkers?.(sessionID)??0,revision:state.revision,checkpointRevision:checkpoint.context.revision,newlyAddedTokens:lastActive?.afterTokens===undefined&&lastActive?0:Math.max(0,current.tokens-(lastActive?.afterTokens??0)),userChoice:state.choice,verifiedRouteLimit,requiredOutputTokens:headroom.output,toolHeadroomTokens:headroom.tools},policy)
  this.change(sessionID,s=>{s.decision=decision})
  if(decision.action==="compact")try{await this.checkpoints.request(checkpoint,state.revision,this.options.compact)}catch(error){this.change(sessionID,s=>{s.error=error instanceof Error?error.message:"Compaction failed"})}
  return decision
 }
 checkpointText(sessionID:string){this.reconcile(sessionID);const checkpoint=this.checkpoints.read(sessionID).at(-1);return checkpoint?"Recoverable task checkpoint (later user instructions take precedence):\n"+JSON.stringify(checkpoint.context):undefined}
}
