import {createHash,randomUUID} from "node:crypto"
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,readdirSync,mkdtempSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {spawnSync} from "node:child_process"
import {coordination} from "../coordination"
import {QuestStore} from "../store"
import {questRoot} from "../root"
import {questsAPI,QuestError} from "../api"
import {projectIdentity} from "../project"
import {acquireLock} from "../locking"
import {sameDirectory,hasCheckout,checkoutIndependent,recoverWorkspace,validateRecoveryBinding,recoveryReadInput,recoveryCommand,recoveryPatch,type RecoveryBinding,type RecoveryOptions} from "./recovery-workspace"

export type HookInput={session_id:string;cwd:string;hook_event_name:string;tool_name?:string;tool_use_id?:string;tool_input?:any;tool_response?:any;transcript_path?:string;source?:string}
type Session={diagnostics?:Record<string,string>;recovery?:RecoveryBinding;directory:string;sessionID:string;questID?:string;pending:string[];calls?:Record<string,{tool:string;outer?:string;running?:boolean;fingerprint?:string;updatedInput?:any;recoveryTicket?:string}>;reconciled?:string[];baseline?:string;clean?:boolean;snapshotUnavailable?:string;ended?:boolean;detached?:boolean;transcript?:string;events:any[]}
const key=(v:string)=>createHash('sha256').update(v).digest('hex')
// This loader is carried in the hook's rewritten argv, not in the writable
// staged file. Execute the verified bytes in memory, avoiding a hash/exec reopen
// race. The installed runner is a self-contained Bun bundle (node:* imports only).
const recoveryLoader=String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function check(p){for(let a=path.resolve(p);;a=path.dirname(a)){if(fs.lstatSync(a).isSymbolicLink()||fs.realpathSync(a)!==a)throw Error('Recovery path contains a symlink/junction');if(path.dirname(a)===a)break}}
function read(p){
 p=path.resolve(p);
 check(p);const before=fs.lstatSync(p);
 if(!before.isFile()||before.nlink!==1||before.size>8*1024*1024)throw Error('Recovery file must be a bounded unlinked regular file');
 const fd=fs.openSync(p,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
 try{const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino)throw Error('Recovery file replaced');const bytes=Buffer.alloc(before.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)throw Error('Recovery file shortened');offset+=n}const after=fs.fstatSync(fd);check(p);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('Recovery file changed');return bytes}finally{fs.closeSync(fd)}
}
`
// Exported for exact-bundle boundary tests; source .ts execution retains its
// development imports. Production always stages the sibling installed .js.
export function stagedRecoveryCommand(runner:string,recovered:{command:string;ticket:string}){
 if(!runner.endsWith('.js'))return recovered
 const {read,check}=new Function('require',recoveryLoader+';return {read,check};')(require) as {read:(path:string)=>Buffer;check:(path:string)=>void}
 const bytes=read(runner),ticketBytes=read(recovered.ticket)
 check(tmpdir())
 const owned=mkdtempSync(join(tmpdir(),'quest-recovery-runner-')),staged=join(owned,'recovery-command.js')
 check(owned)
 writeFileSync(staged,bytes,{flag:'wx',mode:0o600})
 const hash=createHash('sha256').update(bytes).digest('hex'),ticketHash=createHash('sha256').update(ticketBytes).digest('hex')
 // Keep claim/result alongside the staged ticket: the ordinary sandbox cannot
 // necessarily read the canonical ledger either. Session state retains this path.
 const ticket=join(owned,recovered.ticket.split(/[\\/]/).at(-1)!)
 writeFileSync(ticket,ticketBytes,{flag:'wx',mode:0o600})
 const code=recoveryLoader+`const bytes=read(${JSON.stringify(staged)});if(crypto.createHash('sha256').update(bytes).digest('hex')!==${JSON.stringify(hash)})throw Error('Recovery helper digest mismatch');const runner=await import('data:text/javascript;base64,'+bytes.toString('base64'));await runner.runRecoveryTicket(${JSON.stringify(ticket)},${JSON.stringify(ticketHash)});`
 const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'"
 // Windows PowerShell 5 native argv drops embedded double quotes. Carry only
 // base64 plus a fixed decoder across that boundary (no shell interpolation).
 const launch="eval(Buffer.from('"+Buffer.from("(async()=>{const require=(await import('node:module')).createRequire(process.cwd()+'/quest-recovery-loader.js');"+code+'})().catch(error=>{console.error(error);process.exitCode=1})').toString('base64')+"','base64').toString())"
 return {command:'& '+quote(process.execPath)+' --eval '+quote(launch),ticket}
}
function boundRecoveryCommand(store:QuestStore,binding:RecoveryBinding,command:string,options:RecoveryOptions,workdir?:string){
 const runner=options.runner??join(import.meta.dir,import.meta.path.endsWith('.ts')?'recovery-command.ts':'recovery-command.js')
 return stagedRecoveryCommand(runner,recoveryCommand(store,binding,command,{...options,runner},workdir))
}
const git=(directory:string,args:string[])=>{const r=spawnSync('git',['-C',directory,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error('Cannot inspect checkout: '+r.stderr);return r.stdout}
const save=(file:string,value:unknown)=>{const tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(value));renameSync(tmp,file)}
const runtime=(store:QuestStore)=>{const dir=join(store.runtime,'codex');mkdirSync(dir,{recursive:true});return dir}
export function consumeTicket(store:QuestStore,ticket:unknown){
 if(typeof ticket!=='string'||! /^[a-f0-9-]{36}$/.test(ticket))throw new QuestError('HOOK_REQUIRED','Enable and trust the Quest plugin hooks, then use a fresh Codex session.')
 const file=join(runtime(store),'ticket-'+ticket+'.json');let row:any
 try{row=JSON.parse(readFileSync(file,'utf8'));unlinkSync(file)}catch{throw new QuestError('HOOK_REQUIRED','Quest host context is missing or already consumed. Retry the original Quest operation.')}
 if(Date.now()-row.at>60_000)throw new QuestError('HOOK_REQUIRED','Quest host context expired; retry the original operation.')
 return row as {directory:string;sessionID:string;at:number}
}
const resultObject=(value:any)=>{if(typeof value==='string'){try{return JSON.parse(value)}catch{return undefined}}return value}
// Failed dispatches do not receive PostToolUse on this host. Only terminal host
// records or a uniquely correlated process-creation failure resolve those entries.
const transcriptRows=(state:Session):any[]=>{try{return readFileSync(state.transcript!,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line))}catch{return []}}
function currentOuter(state:Session){
 const rows=transcriptRows(state),done=new Set(rows.filter(r=>r.type==='response_item'&&r.payload.type==='custom_tool_call_output').map(r=>r.payload.call_id))
 const open=rows.filter(r=>r.type==='response_item'&&r.payload.type==='custom_tool_call'&&!done.has(r.payload.call_id))
 return open.length===1?open[0].payload.call_id:undefined
}
function reconcileEnded(state:Session){
 const rows=transcriptRows(state)
 const trustedTranscript=rows.some(r=>r.type==='session_meta'&&r.payload.id===state.sessionID)
 state.pending=state.pending.filter(id=>{
  const call=state.calls?.[id];if(!call)return true
  if(call.recoveryTicket){if(!existsSync(call.recoveryTicket+'.claimed.result.json'))return true;(state.reconciled??=[]).push(id);return false}
  if(!trustedTranscript||call.running)return true
  const terminal=rows.some(r=>r.type==='event_msg'&&r.payload.type==='item_completed'&&r.payload.item?.id===id&&r.payload.item.type==='McpToolCall'&&['completed','failed'].includes(r.payload.item.status))
  const unique=call.tool==='Bash'&&call.outer&&Object.values(state.calls!).filter(c=>c.outer===call.outer).length===1
  const launchFailed=unique&&rows.some(r=>r.type==='response_item'&&r.payload.type==='custom_tool_call_output'&&r.payload.call_id===call.outer&&Array.isArray(r.payload.output)&&r.payload.output.some((c:any)=>c.type==='input_text'&&c.text.startsWith('Script failed\n'))&&r.payload.output.some((c:any)=>c.type==='input_text'&&/^Script error:\nexec_command failed: CreateProcess \{ message: /m.test(c.text)&&c.text.includes('Failed to create unified exec process:')))
  if(!terminal&&!launchFailed)return true
  ;(state.reconciled??=[]).push(id);return false
 })
}
function reconcilePriorSessions(store:QuestStore,directory:string,current:string){
 const dir=runtime(store)
 for(const name of readdirSync(dir).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)&&name!==key(current)+'.json')){
  const file=join(dir,name);let prior:Session
  try{prior=JSON.parse(readFileSync(file,'utf8'))}catch{continue}
  if(!prior.ended)continue
  try{if(!sameDirectory(prior.directory,directory))continue}catch{continue}
  const lock=acquireLock(store.runtime,'codex-'+key(prior.sessionID))
  try{
   prior=JSON.parse(readFileSync(file,'utf8'));if(!prior.ended)continue
   reconcileEnded(prior)
   if(!prior.pending.length&&!prior.detached)coordination(store,{directory:prior.recovery?.directory??prior.directory,sessionID:prior.sessionID,host:'codex'})({action:'release'})
   save(file,prior)
  }finally{lock.release()}
 }
}
export function codexHook(input:HookInput,store=new QuestStore(questRoot()),recoveryOptions:RecoveryOptions={}):any{
 if(!input.session_id||!input.cwd)throw new Error('Codex hook omitted session identity or cwd')
 const dir=runtime(store),file=join(dir,key(input.session_id)+'.json'),lock=acquireLock(store.runtime,'codex-'+key(input.session_id))
 try{
 const state:Session=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{directory:input.cwd,sessionID:input.session_id,pending:[],events:[]}
 if(!sameDirectory(state.directory,input.cwd))throw new Error('Session checkout changed; open a fresh session in the intended checkout')
 let directory=state.recovery?.directory??input.cwd
 let context={directory,sessionID:input.session_id,host:'codex'}
 const event=input.hook_event_name,questCall=/^mcp__.+__quest$/.test(input.tool_name??'')
 state.transcript??=input.transcript_path
 if(event==='SessionStart'){state.ended=false;save(file,state);reconcilePriorSessions(store,input.cwd,input.session_id);return {}}
 if(event==='PreToolUse'){
  if(questCall){
   const ticket=randomUUID();save(join(dir,'ticket-'+ticket+'.json'),{directory:input.cwd,sessionID:input.session_id,at:Date.now()});
   return {hookSpecificOutput:{hookEventName:event,permissionDecision:'allow',updatedInput:{...input.tool_input,_questTicket:ticket}}}
  }
   if(checkoutIndependent(input.tool_name??'',input.tool_input)){
    if(!state.recovery)return {}
    let updatedInput=recoveryReadInput(state.recovery,input.tool_name??'',input.tool_input)
    if(updatedInput&&input.tool_name==='Bash'){
     validateRecoveryBinding(state.recovery)
      const recovered=boundRecoveryCommand(store,state.recovery,updatedInput.command,{...recoveryOptions,needsEnvironment:false},updatedInput.workdir)
     updatedInput={...updatedInput,command:recovered.command}
    }
    if(updatedInput)return {hookSpecificOutput:{hookEventName:event,permissionDecision:'allow',updatedInput,additionalContext:'Task reads use recovered checkout '+state.recovery.directory}}
    // Literal external skill reads and web operations remain checkout independent.
    // Audit commands have an implicit cwd and must retain the task binding.
    return {}
   }
  if(!state.recovery&&!hasCheckout(input.cwd))return {}
  const fingerprint=key(JSON.stringify({tool:input.tool_name,input:input.tool_input}))
  const prior=input.tool_use_id&&state.calls?.[input.tool_use_id]
  if(prior?.updatedInput&&prior.fingerprint!==fingerprint)throw Error('Retried tool identity has different input; refusing to replay')
  // A stored binding is not proof that the current path still names our tree.
  // Check before joining so a replaced root cannot reserve another checkout.
  if(state.recovery)validateRecoveryBinding(state.recovery)
  const q=state.questID
  let title='Codex task in this checkout'
  if(q){try{title=store.read(q)?.title||title}catch(error){
   // Optional display metadata must not turn a preserved broken Quest into a
   // pre-tool failure loop. Ownership checks below remain mandatory.
   (state.diagnostics??={}).questRead=String(error).slice(0,1200)
  }}
  let ownership:any=coordination(store,context)({action:'join',title,scopes:['.']})
  if(!ownership.acquired){
   if(!['Bash','apply_patch'].includes(input.tool_name??''))return {hookSpecificOutput:{hookEventName:event,permissionDecision:'deny',permissionDecisionReason:'This tool cannot be rebound safely while another session owns the checkout. Shell and patch operations recover automatically; the existing owner remains protected.'}}
   // Bootstrap is runtime code, outside the blocked ordinary-tool path. Only
   // create our own worktree; never release or edit another participant.
   state.recovery=recoverWorkspace(store,input.cwd,input.session_id,recoveryOptions)
   directory=state.recovery.directory;context={...context,directory}
   ownership=coordination(store,context)({action:'join',title,scopes:['.']})
   if(!ownership.acquired)throw Error('The recovery worktree has another owner; preserving both reservations')
   save(file,state)
  }
  if(prior?.updatedInput){
   if(input.tool_name==='apply_patch'){
    if(!state.recovery)throw Error('Cached patch has no recovery binding; refusing to replay')
    // Recompute every header, including Move to, against the live filesystem.
    // Never return a cached absolute path before checking current junctions.
    const command=recoveryPatch(input.tool_input?.command,state.recovery)
    if(command!==prior.updatedInput.command)throw Error('Cached patch binding changed; refusing to replay')
   }
    return {hookSpecificOutput:{hookEventName:event,permissionDecision:'allow',updatedInput:prior.updatedInput,additionalContext:'Recovery binding: '+JSON.stringify(state.recovery)}}
  }
   let updatedInput:any,recoveryTicket:string|undefined
   if(state.recovery){
    if(input.tool_name==='Bash'){const command=boundRecoveryCommand(store,state.recovery,input.tool_input?.command,recoveryOptions,input.tool_input?.workdir);updatedInput={...input.tool_input,command:command.command};recoveryTicket=command.ticket}
   else if(input.tool_name==='apply_patch')updatedInput={...input.tool_input,command:recoveryPatch(input.tool_input?.command,state.recovery)}
   else return {hookSpecificOutput:{hookEventName:event,permissionDecision:'deny',permissionDecisionReason:'This persistent tool has no verified worktree binding. Use the recovered shell or patch tools; the original checkout remains protected.'}}
  }
   if(state.baseline===undefined){try{if(state.recovery){state.baseline=state.recovery.preparation?.tree??state.recovery.head;state.clean=false}else{state.baseline=git(directory,['rev-parse','HEAD']).trim();state.clean=git(directory,['status','--porcelain']).trim()===''}}catch(error){state.baseline='';state.clean=false;state.snapshotUnavailable=String(error)}}
  if(q)state.questID=q
  if(/spawn_agent|Agent/.test(input.tool_name??'')||/Start-Process|Start-Job|nohup|\bdisown\b/i.test(input.tool_input?.command??''))state.detached=true
  if(input.tool_use_id&&!state.pending.includes(input.tool_use_id)){state.pending.push(input.tool_use_id);(state.calls??={})[input.tool_use_id]={tool:input.tool_name??'',outer:currentOuter(state),fingerprint,updatedInput,recoveryTicket}}
  save(file,state)
   return updatedInput?{hookSpecificOutput:{hookEventName:event,permissionDecision:'allow',updatedInput,additionalContext:'Recovery binding: '+JSON.stringify(state.recovery)}}:{}
 }
 if(event==='PostToolUse'){
  if(questCall){
   // Inspecting another Quest must not silently adopt it as this task.
   if(input.tool_input?.action==='create'){
    const response=resultObject(input.tool_response)
    const value=response?.structuredContent??resultObject(response?.content?.find((x:any)=>x.type==='text')?.text)
    if(value?.id)state.questID=value.id
   }
   save(file,state);return {}
  }
  if(checkoutIndependent(input.tool_name??'',input.tool_input))return {}
  if(!state.recovery&&!hasCheckout(input.cwd))return {}

  // A running command has not finished. Keep its reservation if the host never sends completion.
  const response=resultObject(input.tool_response)
  const ticket=input.tool_use_id&&state.calls?.[input.tool_use_id]?.recoveryTicket
  const running=(!!ticket&&!existsSync(ticket+'.claimed.result.json'))||response?.session_id!==undefined||response?.sessionID!==undefined||/Process running with session ID|Process running with session id/.test(typeof input.tool_response==='string'?input.tool_response:'')
  if(input.tool_use_id&&state.calls?.[input.tool_use_id])state.calls[input.tool_use_id].running=running
  if(!running)state.pending=state.pending.filter(id=>id!==input.tool_use_id)
  state.events.push({tool:input.tool_name,input:input.tool_input,result:input.tool_response})
  // Persist the command's actual completion before optional artifact linking.
  // A corrupt or moved Quest must not leave a completed command pending forever.
  save(file,state)
  if(state.questID&&state.events.length){
   try {
   const report=join(dir,key(input.session_id)+'-checks.json');save(report,{baseline:state.baseline,initiallyClean:state.clean,events:state.events})
   const artifacts:any[]=[{name:'Codex recorded tool results',path:report}]
   if(state.clean){
    const patch=join(dir,key(input.session_id)+'-changes.patch');writeFileSync(patch,git(directory,['diff','--binary',state.baseline!]));artifacts.push({name:'Codex implementation patch',path:patch})
    const untracked=git(directory,['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean)
    const files=join(dir,key(input.session_id)+'-new-files.json');save(files,untracked.map(path=>({path,base64:readFileSync(join(directory,path)).toString('base64')})));artifacts.push({name:'Codex new files',path:files})
   }
   questsAPI(store,{project:projectIdentity(input.cwd),sessionID:'codex:'+input.session_id,requestID:randomUUID()},async()=>{throw new Error('No dispatch')}).update(state.questID,{artifacts})
   if(state.diagnostics)delete state.diagnostics.artifactLink
   }catch(error){
    const message=String(error).slice(0,1200),changed=state.diagnostics?.artifactLink!==message
    ;(state.diagnostics??={}).artifactLink=message
    save(file,state)
    return changed?{hookSpecificOutput:{hookEventName:event,additionalContext:'Quest evidence linking failed; tool completion is saved and the journal is preserved. '+message}}:{}
   }
  }
  save(file,state);return {}
 }
 if(event==='SessionEnd'){
  state.ended=true
  reconcileEnded(state)
  // Stop/interrupt, MCP exit and elapsed time are not session termination evidence.
  // Even SessionEnd cannot prove a background command stopped.
  if(!state.pending.length&&!state.detached)coordination(store,context)({action:'release'})
  save(file,state);return {}
 }
 return {}
 }finally{lock.release()}
}
