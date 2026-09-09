/** Private offline report. --watch refreshes numeric evidence and rebuilds the report every 30 seconds. */
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {readLedger,collectPassive} from '../usage/passive-ledger'
import {readAccountUsage} from '../usage/account-api'
import {sessionBurn} from '../usage/session-burn'
const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1]},out=resolve(value('--out')??'run/session-burn-report'),watch=args.includes('--watch')
for(let i=0;i<args.length;i++){if(['--out','--ledger','--accounts'].includes(args[i])){if(!args[++i]||args[i].startsWith('--'))throw Error('Missing option value')}else if(args[i]!=='--watch')throw Error('Unknown option')}
mkdirSync(out,{recursive:true})
const template=readFileSync(join(import.meta.dir,'../usage/session-burn-chart.html'),'utf8')
do{if(watch&&!value('--ledger'))await collectPassive();const now=Date.now(),ledger=readLedger({from:now-7*86400000},value('--ledger')),accounts=readAccountUsage(value('--accounts')),report=sessionBurn(accounts.accounts,ledger.observations,ledger.rows,now,{from:ledger.coverageFrom,gaps:ledger.gaps,diagnostics:ledger.receipt?.calibrationDiagnostics??ledger.receipt?.diagnostics,observedAt:ledger.receipt?.at})
 const json=JSON.stringify(report),html=template.replace('<!--SESSION_BURN_DATA-->',json.replaceAll('<','\\u003c')).replace('<title>',(watch?'<meta http-equiv="refresh" content="30">':'')+'<title>')
 for(const[name,body]of [['session-burn.json',json],['session-burn.html',html]]){const file=join(out,name),temp=file+'.'+process.pid+'.tmp';writeFileSync(temp,body,{mode:0o600});renameSync(temp,file)}
 console.log(JSON.stringify({at:now,out,pools:report.pools.map(p=>({provider:p.provider,label:p.label,sessions:p.sessions.length,accuracy:p.accuracy,reason:p.model.reason}))}));if(watch)await new Promise(r=>setTimeout(r,30000))
}while(watch)
