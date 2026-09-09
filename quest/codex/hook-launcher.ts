/** Kept inline in the hook command so even an unreadable plugin file is reported.
 * The child inherits the host sandbox. This launcher grants no filesystem access.
 */
export function hookLauncherMain() {
 const {readFileSync}=require('node:fs'),{join}=require('node:path'),{spawnSync}=require('node:child_process')
 let input:any={}
 const emit=(value:any)=>process.stdout.write(JSON.stringify(value)+'\n')
 const clean=(value:unknown)=>String(value??'').replace(/\x1b\[[0-9;]*m/g,'').replace(/(Bearer\s+)[^\s"']+/gi,'$1[redacted]').replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]').slice(0,2000)
 try {
  const raw=readFileSync(0,'utf8');input=JSON.parse(raw)
  if(!process.env.PLUGIN_ROOT)throw Error('PLUGIN_ROOT is missing')
  const child=spawnSync('bun',[join(process.env.PLUGIN_ROOT,'scripts','hook.js')],{input:raw,encoding:'utf8',windowsHide:true,timeout:input.hook_event_name==='SessionEnd'?2000:20000,maxBuffer:1024*1024})
  if(child.error||child.status!==0)throw Error('Hook process '+(child.error?.code??('exited '+child.status))+': '+clean(child.stderr||child.error?.message||child.signal||'no stderr'))
  let result:any
  try{result=JSON.parse(child.stdout)}catch{throw Error('Hook returned invalid JSON; '+clean(child.stderr||'no stderr'))}
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Hook returned a non-object response')
  emit(result)
 }catch(error){
  const event=input?.hook_event_name,message='Quest '+(event??'hook')+' failed: '+clean(error instanceof Error?error.message:error)+'. Hook bookkeeping is incomplete; do not infer hook success from the tool result.'
  // A protocol-level block preserves the failure AND gives the UI/model its reason.
  // Raw nonzero exits are hidden from model context by Codex 0.153.4.
  if(event==='PreToolUse')emit({hookSpecificOutput:{hookEventName:event,permissionDecision:'deny',permissionDecisionReason:message,additionalContext:message}})
  else if(event==='PostToolUse')emit({hookSpecificOutput:{hookEventName:event,additionalContext:message}})
  else emit({decision:'block',reason:message,...(event?{hookSpecificOutput:{hookEventName:event,additionalContext:message}}:{})})
 }
}
export const hookLauncherCommand=()=>`node -e "eval(Buffer.from('${Buffer.from('('+hookLauncherMain.toString()+')()').toString('base64')}','base64').toString())"`
