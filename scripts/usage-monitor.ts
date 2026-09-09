/** Read-only activity monitor; private evidence stays in the specified output directory. */
import {mkdirSync,writeFileSync,renameSync} from "node:fs"
import {resolve,join} from "node:path"
import {collectPassive,readLedger,summarizeLedger} from "../usage/passive-ledger"
import {getAccountUsage,ACCOUNT_USAGE_FILE} from "../usage/account-api"
import {readQuotaObservations} from "../usage/calibration-store"
import {measuredIntervals,empiricalModels} from "../usage/empirical-usage"
import {resetPlan} from "../usage/reset-planner"
const args=process.argv.slice(2)
let output=resolve("run/passive-usage"),samples=1,watch=false,deadlineAt:number|undefined
for(let i=0;i<args.length;i++){
 const arg=args[i]
 if(arg==="--watch")watch=true
 else if(arg==="--out"&&args[i+1])output=resolve(args[++i])
 else if(arg==="--samples"&&args[i+1])samples=Number(args[++i])
 else if(arg==="--deadline"&&args[i+1])deadlineAt=Date.parse(args[++i])
 else throw Error("Usage: bun scripts/usage-monitor.ts [--out directory] [--samples positive-integer | --watch] [--deadline ISO-time]")
}
if(!Number.isInteger(samples)||samples<1||samples>10000||deadlineAt!==undefined&&(!Number.isFinite(deadlineAt)||deadlineAt<=Date.now()))throw Error("Invalid sample count or future deadline")
mkdirSync(output,{recursive:true})
const file=join(output,"ledger.sqlite"),accountFile=join(output,"accounts.json")
for(let iteration=0;watch||iteration<samples;iteration++){
 const start=performance.now(),accounts=await getAccountUsage({file:accountFile,refresh:true}),now=Date.now()
 const observations=[...readQuotaObservations(ACCOUNT_USAGE_FILE+".observations").observations,...readQuotaObservations(accountFile+".observations").observations]
 await collectPassive({file,accounts,observations})
 const ledger=readLedger({from:now-7*86400000},file),summary=summarizeLedger(ledger.rows),intervals=measuredIntervals(accounts.accounts,ledger.observations,ledger.rows,{from:ledger.coverageFrom,gaps:ledger.gaps,diagnostics:ledger.receipt?.calibrationDiagnostics??ledger.receipt?.diagnostics})
 const report={observedAt:now,summary,receipt:ledger.receipt,gaps:ledger.gaps,resolvedGaps:ledger.resolvedGaps,intervals,models:empiricalModels(intervals),planning:resetPlan(accounts.accounts,observations,now,0,deadlineAt&&deadlineAt>now?deadlineAt:undefined),elapsedMilliseconds:Math.round(performance.now()-start)}
 const temp=join(output,"accounting.json.tmp");writeFileSync(temp,JSON.stringify(report,null,2),{mode:0o600});renameSync(temp,join(output,"accounting.json"))
 console.log(JSON.stringify({sample:iteration+1,at:new Date(now).toISOString(),counterRecords:summary.requests,sessions:summary.sessionCount,sources:summary.sources,gaps:ledger.gaps.length,models:report.models.map(m=>({state:m.state,reason:m.reason,intervals:m.intervals,completeIntervals:m.completeIntervals})),elapsedMilliseconds:report.elapsedMilliseconds}))
 if(watch||iteration+1<samples)await new Promise(r=>setTimeout(r,30000))
}
