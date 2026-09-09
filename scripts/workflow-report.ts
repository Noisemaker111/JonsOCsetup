/** Export actual persisted workflow measurements; never generates benchmark observations. */
import {writeFileSync,mkdirSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {reportWorkflowOutcomes,renderWorkflowReport,TELEMETRY_FILE} from '../usage/telemetry-api'
const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]}
const file=value('--file')??process.env.OPENCODE_WORKFLOW_OUTCOMES_FILE??TELEMETRY_FILE+'.workflows.json',out=value('--out')
if(!out)throw Error('Provide --out for the private HTML report; optional --file, --project, --days 7|28')
const days=Number(value('--days')??28);if(days!==7&&days!==28)throw Error('--days must be 7 or 28')
const report=reportWorkflowOutcomes(file,{days,projectID:value('--project')}),path=resolve(out);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,renderWorkflowReport(report));writeFileSync(path+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({path,runs:report.runs.length,days,note:'Actual persisted measurements only; empty means no observed workflow data.'}))
