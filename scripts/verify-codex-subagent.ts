/** Exercise a packaged hook with a protected owner, native spawn, and a child write. */
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {QuestStore} from '../quest/store'
import {coordination} from '../quest/coordination'
const bundle=resolve(process.argv[2]),before=process.argv.includes('--expect-blocked')
const root=mkdtempSync(join(tmpdir(),'codex-spawn-admission-')),repo=join(root,'repo');mkdirSync(repo)
const git=(...args:string[])=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr)}
git('init');writeFileSync(join(repo,'result.txt'),'protected source');git('add','result.txt');git('commit','-m','fixture')
const store=new QuestStore(root),owner={directory:repo,sessionID:'active-owner',host:'codex'}
coordination(store,owner)({action:'join',title:'Protected owner',scopes:['.']})
const ownerBefore=JSON.stringify(coordination(store,owner)({action:'status'}).participants)
const invoke=(session:string,tool:string,input:any)=>{const r=spawnSync('bun',[bundle],{input:JSON.stringify({session_id:session,cwd:repo,hook_event_name:'PreToolUse',tool_name:tool,tool_input:input,tool_use_id:session+'-'+tool}),env:{...process.env,OPENCODE_QUEST_ROOT:root},encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout)}
const dispatch=invoke('parent','collaboration.spawn_agent',{task_name:'luna',model:'gpt-5.6-luna',message:'Perform isolated work'})
if(before){if(dispatch.hookSpecificOutput?.permissionDecision!=='deny')throw Error('Expected original defect');console.log(JSON.stringify({before:true,dispatch,root}));process.exit(0)}
if(dispatch.hookSpecificOutput?.permissionDecision==='deny')throw Error('Dispatch still blocked')
if(JSON.stringify(coordination(store,owner)({action:'status'}).participants)!==ownerBefore)throw Error('Dispatch changed checkout ownership')
const child=invoke('luna-child','Bash',{command:"Set-Content result.txt 'child result'; Get-Content result.txt"})
if(!child.hookSpecificOutput?.updatedInput?.command)throw Error('Child write was not isolated')
const result=spawnSync('powershell.exe',['-NoProfile','-Command',child.hookSpecificOutput.updatedInput.command],{cwd:repo,encoding:'utf8',windowsHide:true,timeout:120000})
if(result.status!==0||!result.stdout.includes('child result'))throw Error('Child execution failed: '+result.stdout+result.stderr)
if(readFileSync(join(repo,'result.txt'),'utf8')!=='protected source')throw Error('Owner source changed')
const original=coordination(store,owner)({action:'status'}).participants.find((p:any)=>p.sessionID==='active-owner')
if(JSON.stringify(original)!==JSON.stringify(JSON.parse(ownerBefore)[0]))throw Error('Owner record changed')
const unknown=invoke('unknown','mcp__unknown__spawn_agent',{})
if(unknown.hookSpecificOutput?.permissionDecision!=='deny')throw Error('Unknown tool incorrectly exempted')
const report={ok:true,bundle,root,dispatchAllowed:true,childWriteIsolated:true,ownerPreserved:true,unknownToolDenied:true,stdout:result.stdout}
writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
