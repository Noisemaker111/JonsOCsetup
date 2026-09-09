import {workspaceSettings} from "./workspace-settings"
import { readFileSync,writeFileSync,mkdirSync,renameSync } from 'node:fs'
import { join } from 'node:path'
import { QuestWorkspaces } from './workspaces'
import { projectIdentity } from './project'
const [runtime, directory, policyFile] = process.argv.slice(2)
const project=projectIdentity(directory)
let result:any
try {
 const policy = JSON.parse(readFileSync(policyFile, 'utf8'))
 result=workspaceSettings().workspaceMode==="shared"?{state:"disabled",reason:"Shared checkout mode"}:new QuestWorkspaces(runtime).prepare({directory:project.root,bootstrap:policy.bootstrapByProject?.[project.id]})
} catch (error) { result={state:'failed',reason:String(error)};process.exitCode=1 }
mkdirSync(runtime,{recursive:true})
const file=join(runtime,'preparation-status-'+project.id+'.json'),temporary=file+'.'+process.pid+'.tmp'
writeFileSync(temporary,JSON.stringify({...result,observedAt:new Date().toISOString()}));renameSync(temporary,file)
console.log(JSON.stringify(result))
