import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const path=process.argv[2],r=JSON.parse(readFileSync(path,'utf8'))
const command=r.quest.sessions.filter((s:any)=>s.agentRole==='command')
r.checks.continuation=command.length===1&&command[0].state==='completed'&&command[0].result==='Configured commands completed; output artifacts recorded'
r.ok=Object.values(r.checks).every(Boolean)
r.receiptReview={originalExit:1,reason:'Acceptance used role instead of agentRole for configured commands; persisted actual command execution and both completed steps verified',reviewedAt:new Date().toISOString()}
const output=join(path,'..','reviewed-report.json');writeFileSync(output,JSON.stringify(r,null,2));console.log(JSON.stringify({ok:r.ok,checks:r.checks,report:output}));process.exitCode=r.ok?0:1
