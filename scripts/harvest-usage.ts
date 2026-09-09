import {mkdirSync,readFileSync,writeFileSync} from "node:fs"
import {join,resolve} from "node:path"
import {harvestCodexUsage,sumHarvest} from "../usage/codex-harvest"
import {getAccountUsage,ACCOUNT_USAGE_FILE} from "../usage/account-api"
import {readQuotaObservations} from "../usage/calibration-store"
const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1]}
const output=resolve(value("--out")??"run/usage-evidence"),from=value("--from")?Date.parse(value("--from")!):Date.now()-4*3600000
mkdirSync(output,{recursive:true})
const accountFile=join(output,"account-usage.json")
const accounts=await getAccountUsage({file:accountFile,refresh:true}),now=Date.now(),harvest=harvestCodexUsage({from,now})
const official=[...readQuotaObservations(ACCOUNT_USAGE_FILE+".observations").observations,...readQuotaObservations(accountFile+".observations").observations]
const openai=accounts.accounts.filter(a=>a.provider==="openai")
// Never combine accounts or independent quota pools into one chart line.
const account=openai.length===1?openai[0]:undefined,windows=account?.windows.filter(w=>w.scope==="shared"&&w.usedPercent!==null)??[]
const window=windows.sort((a,b)=>(a.durationSeconds??Infinity)-(b.durationSeconds??Infinity))[0]
const quota=account&&window?[...new Map(official.filter(o=>o.accountID===account.id&&o.windowID===window.id&&o.at>=from&&o.at<=now&&o.resetAt===Date.parse(window.resetAt??"")).map(o=>[o.id,o])).values()].sort((a,b)=>a.at-b.at).map(o=>({at:o.at,usedPercent:o.usedPoints})):[]
const families=harvest.families.filter(f=>f.astraSessions>0).map((f,i)=>({...f,label:"Astra "+(i+1),points:harvest.sessions.filter(s=>f.sessionIDs.includes(s.id)).flatMap(s=>s.points.filter(p=>p.model==="gpt-6-astra")).sort((a,b)=>a.at-b.at)}))
const chart={from,to:harvest.to,requests:harvest.coverage.reconciledRequests,sessions:harvest.sessions.length,repeated:harvest.coverage.repeatedCounters,rejected:harvest.coverage.rejectedCounters,quota,families,guardians:sumHarvest(harvest.sessions.filter(s=>s.source==="guardian").flatMap(s=>s.points))}
const template=readFileSync(join(import.meta.dir,"../usage/harvest-chart.html"),"utf8")
writeFileSync(join(output,"usage-evidence.json"),JSON.stringify({harvest,chart,accountScope:{accountID:account?.id,windowID:window?.id,resetAt:window?.resetAt}},null,2))
writeFileSync(join(output,"astra-evidence.html"),template.replace('<!--HARVEST_DATA-->',JSON.stringify(chart).replaceAll('<','\\u003c')))
const astra=sumHarvest(harvest.sessions.flatMap(s=>s.points.filter(p=>p.model==="gpt-6-astra")))
console.log(JSON.stringify({output,from,to:now,families:families.length,sessions:harvest.sessions.length,coverage:harvest.coverage,astra,guardians:chart.guardians,quota:{points:quota.length,first:quota[0],last:quota.at(-1)},diagnostics:harvest.diagnostics},null,2))
