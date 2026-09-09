/** Offline replay only. Input contains recorded intervals and explicit coverage evidence. No provider calls. */
import { readFileSync } from "node:fs"
import { calibrateObservedHistory } from "../usage/calibration-pipeline"
import { pairInterval,fitCalibration } from "../usage/calibration"
import { readRequests } from "../usage/telemetry-store"
import { saveCalibration } from "../usage/calibration-store"
const file=process.argv[2]
if(!file)throw new Error("Usage: bun scripts/calibrate-usage.ts <replay.json> [--save]")
const replay=JSON.parse(readFileSync(file,"utf8")),history=replay.requests?{records:replay.requests,diagnostics:[]}:readRequests(replay.requestFile)
if(history.diagnostics.length)throw Error(history.diagnostics.join("; "))
const records=history.records
if(replay.observations){
 const result=calibrateObservedHistory({...replay,requests:records})
 if(process.argv.includes("--save"))for(const calibration of result.calibrations)saveCalibration(calibration,replay.outputFile)
 console.log(JSON.stringify(result,null,2))
}else{
const paired=replay.intervals.map((i:any)=>({...pairInterval(i.before,i.after,records,i.coverage),split:i.split}))
const samples=(split:string)=>paired.filter((p:any)=>p.split===split&&p.sample).map((p:any)=>p.sample)
const calibration=fitCalibration(samples("training"),samples("held-out"),replay.options)
if(process.argv.includes("--save"))saveCalibration(calibration,replay.outputFile)
console.log(JSON.stringify({calibration,rejected:paired.filter((p:any)=>!p.sample).map((p:any)=>p.reason)},null,2))

}
