import {existsSync,readFileSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {acquireLock} from "../../quest/locking"
import {burnTargetKey} from "../../usage/burn-control"
const root=process.argv[2],target=JSON.parse(readFileSync(join(root,"target.json"),"utf8"))
const lock=acquireLock(root,"burn-control")
try{
 console.log("locked")
 while(!existsSync(join(root,"start")))await Bun.sleep(5)
 await Bun.sleep(25)
 const now=Date.now()
 writeFileSync(join(root,"controls.json"),JSON.stringify([{accountID:target.accountID,windowID:target.pacing.windowID,targetKey:burnTargetKey(target),deadlineAt:target.deadlineAt,state:"ready",desiredConcurrency:1,maxConcurrent:1,lastAdjustedAt:now,updatedAt:now,requiredPointsPerMinute:null,observedPointsPerMinute:null,reason:"Concurrent refresh"}]))
 await Bun.sleep(100)
}finally{lock.release()}
