import * as pty from 'node-pty'
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
const root=process.cwd(),fixture=join(root,'.visual-e2e','workspace-mode-ui-'+Date.now());mkdirSync(fixture,{recursive:true})
const file=join(fixture,'settings.json'),receipt=join(fixture,'loads.jsonl'),globalFile=join(root,'quest-settings.json'),before=readFileSync(globalFile,'utf8')
writeFileSync(file,JSON.stringify({version:1,workspaceMode:'worktree'}))
const env={...process.env,OPENCODE_QUEST_SETTINGS:file,OPENCODE_RUNTIME_RECEIPT:receipt}
for(const key of ['OPENCODE_PLUGIN_GENERATION','OPENCODE_RUNTIME_CONTROL','OPENCODE_RUNTIME_TOKEN','OPENCODE_CONFIG_DIR'])delete env[key]
const term=pty.spawn('pwsh.exe',['-NoProfile','-Command','opencode2 --standalone'],{cwd:fixture,env,cols:130,rows:42})
let output='',exited=false;term.onData(x=>output+=x);term.onExit(()=>exited=true)
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await sleep(200)}throw Error('UI condition timed out')}
let ok=false,error
try {
 await until(()=>existsSync(receipt)&&readFileSync(receipt,'utf8').includes('server'))
 await until(()=>output.includes('Quest-Giver'));await sleep(2000)
 term.write('/quest-workspace');await sleep(600);term.write('\r')
 await until(()=>output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x07]*\x07/g,'').includes('Shared project checkout'))
 await sleep(1000);term.write('\x1b[B');await sleep(1000);term.write('\r')
 await until(()=>JSON.parse(readFileSync(file,'utf8')).workspaceMode==='shared')
 if(readFileSync(globalFile,'utf8')!==before)throw Error('Global user setting changed during isolated test')
 ok=true
} catch(e){error=String(e)} finally {
 term.write('\x03');for(let i=0;i<20&&!exited;i++)await sleep(300);if(!exited)term.kill()
 writeFileSync(join(fixture,'terminal.txt'),output)
}
const report={ok,error,fixture,exited,command:'opencode2 --standalone',action:'/quest-workspace -> Shared project checkout',settings:JSON.parse(readFileSync(file,'utf8')),globalSettingPreserved:readFileSync(globalFile,'utf8')===before,loads:existsSync(receipt)?readFileSync(receipt,'utf8').trim().split('\n').map(JSON.parse):[]}
writeFileSync(join(fixture,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exit(ok?0:1)
