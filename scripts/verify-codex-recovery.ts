import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {QuestStore} from '../quest/store'
import {coordination} from '../quest/coordination'
const candidate=resolve(process.argv[2]??'.candidates/quest-ownership-recovery')
const root=mkdtempSync(join(tmpdir(),'ownership-host-')),repo=join(root,'repo');mkdirSync(repo)
const git=(...args:string[])=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
git('init');writeFileSync(join(repo,'result.txt'),'committed');git('add','result.txt');git('commit','-m','fixture');writeFileSync(join(repo,'result.txt'),'owner dirty work')
const store=new QuestStore(root),owner={directory:repo,sessionID:'protected-owner',host:'opencode'}
coordination(store,owner)({action:'join',title:'Protected live fixture owner',scopes:['.']})
const originalOwner=coordination(store,owner)({action:'status'}).participants.find((p:any)=>p.sessionID===owner.sessionID)
const ownerProcess=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'})
const hook=(event:string,tool_input:any,tool_use_id='pending-original')=>{
 const r=spawnSync('bun',[join(candidate,'scripts','hook.js')],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,OPENCODE_QUEST_ROOT:root},input:JSON.stringify({session_id:'recovery-caller',cwd:repo,hook_event_name:event,tool_name:'Bash',tool_input,tool_use_id})})
 if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout)
}
try{
 const original={command:"$ErrorActionPreference='Stop'; Set-Content -LiteralPath result.txt -Value 'task recovered'; (Get-Location).Path; Get-Content result.txt"}
 const pre=hook('PreToolUse',original)
 if(pre.hookSpecificOutput?.permissionDecision!=='allow')throw Error(JSON.stringify(pre))
 const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-Command',pre.hookSpecificOutput.updatedInput.command],{cwd:repo,windowsHide:true,encoding:'utf8',timeout:120000})
 if(r.status!==0)throw Error('Recovered command failed: '+r.stdout+' '+r.stderr)
 const status=coordination(store,owner)({action:'status'}),task=status.participants.find((p:any)=>p.sessionID==='recovery-caller')
 if(!task||task.checkout===repo)throw Error('No isolated task binding')
 if(!r.stdout.includes('task recovered')||!r.stdout.toLowerCase().includes(task.checkout.toLowerCase()))throw Error('Original command result/cwd not observed')
 const attack={command:"$ErrorActionPreference='Stop'; try { [System.IO.File]::WriteAllText('"+join(repo,'result.txt').replaceAll("'","''")+"','stolen'); exit 19 } catch { Write-Output 'owner-write-denied' }"}
 const blocked=hook('PreToolUse',attack,'protected-write-probe')
 const denied=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-Command',blocked.hookSpecificOutput.updatedInput.command],{cwd:repo,windowsHide:true,encoding:'utf8',timeout:120000})
 if(denied.status!==0||!denied.stdout.includes('owner-write-denied'))throw Error('Sandbox did not protect original owner: '+denied.stdout+' '+denied.stderr)
 const unchanged=readFileSync(join(repo,'result.txt'),'utf8')==='owner dirty work'&&JSON.stringify(coordination(store,owner)({action:'status'}).participants.find((p:any)=>p.sessionID===owner.sessionID))===JSON.stringify(originalOwner)
 process.kill(ownerProcess.pid!,0)
 if(!unchanged)throw Error('Owner changed')
 const report={fixture:root,originalOperationRetried:true,modelCalls:0,hook:'candidate packaged PreToolUse',executor:'installed Codex app-server command/exec with workspaceWrite restricted to recovered checkout',recoveredDirectory:task.checkout,stdout:r.stdout,ownerWriteDenied:true,ownerRecordUnchanged:true,ownerDirtyWorkPreserved:true,ownerProcessStillRunning:true}
 mkdirSync('.visual-e2e/ownership-recovery',{recursive:true});writeFileSync('.visual-e2e/ownership-recovery/candidate-host.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}finally{ownerProcess.kill()}
