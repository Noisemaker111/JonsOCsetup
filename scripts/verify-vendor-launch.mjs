import * as pty from 'node-pty'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const root = process.cwd(), fixture=join(root,'.visual-e2e',`vendor-launch-${Date.now()}`)
mkdirSync(fixture,{recursive:true})
const receipt=join(fixture,'loads.jsonl'), env={...process.env,OPENCODE_RUNTIME_RECEIPT:receipt}
for(const key of ['OPENCODE_PLUGIN_GENERATION','OPENCODE_RUNTIME_CONTROL','OPENCODE_RUNTIME_TOKEN','OPENCODE_CONFIG_DIR']) delete env[key]
const term=pty.spawn('pwsh.exe',['-NoProfile','-Command','opencode2 --standalone'],{cwd:fixture,env,cols:120,rows:40})
let output='',exited=false,code
term.onData(x=>output+=x);term.onExit(x=>{exited=true;code=x.exitCode})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
let loads=[],ok=false
try {
 for(let i=0;i<60;i++) {
  await sleep(1000)
  if(existsSync(receipt)) loads=readFileSync(receipt,'utf8').trim().split('\n').map(JSON.parse)
  if(['server','tui:usage','tui:quests'].every(c=>loads.some(l=>l.component===c))){ok=true;break}
  if(exited) break
 }
} finally {
 term.write('\x03')
 for(let i=0;i<20&&!exited;i++) await sleep(500)
 if(!exited) term.kill()
}
writeFileSync(join(fixture,'terminal.txt'),output)
const report={ok,fixture,command:'opencode2 --standalone',reason:'Standalone isolates the test from existing services; no managed wrapper or generation/config override.',loads,exited,code}
writeFileSync(join(fixture,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exit(ok&&exited?0:1)
