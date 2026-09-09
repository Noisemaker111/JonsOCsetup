/** Exercise cross-channel writes with real Git, Quest stores and dirty owned files. */
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {QuestStore} from '../quest/store'
import {QuestWorkspaces} from '../quest/workspaces'
import {projectIdentity} from '../quest/project'
const root=resolve(import.meta.dir,'..'),dir=join(root,'.visual-e2e','channel-boundary-'+Date.now()),projectDir=join(dir,'project')
mkdirSync(projectDir,{recursive:true});writeFileSync(join(projectDir,'owned.txt'),'committed\n')
for(const args of [['init'],['add','owned.txt'],['commit','-m','Channel ownership acceptance']]){const p=Bun.spawnSync(['git','-C',projectDir,...args],{windowsHide:true,stdout:'pipe',stderr:'pipe'});if(p.exitCode)throw Error(p.stderr.toString())}
const project=projectIdentity(projectDir),stable=new QuestStore(join(dir,'stable')),dev=new QuestStore(join(dir,'dev'))
const q=stable.create({id:'01j00000000000000000000881',title:'Preserve stable dirty work',objective:'Ownership boundary acceptance',project,stages:[]})
const prior=process.env.OPENCODE_RELEASE_CHANNEL;delete process.env.OPENCODE_RELEASE_CHANNEL
const owner=new QuestWorkspaces(stable.runtime).createShared({runID:'stable-owner',questID:q.id,directory:projectDir,project,files:['owned.txt'],store:stable})
writeFileSync(join(projectDir,'owned.txt'),'stable owner dirty work\n')
function digest(path:string):string{const h=createHash('sha256');for(const e of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){h.update(e.name);h.update(e.isDirectory()?digest(join(path,e.name)):readFileSync(join(path,e.name)))}return h.digest('hex')}
const before=digest(stable.runtime);let rejection=''
try{process.env.OPENCODE_RELEASE_CHANNEL='dev';new QuestWorkspaces(dev.runtime).createShared({runID:'dev-contender',questID:q.id,directory:projectDir,project,files:['owned.txt'],store:dev})}catch(error){rejection=String(error)}finally{if(prior===undefined)delete process.env.OPENCODE_RELEASE_CHANNEL;else process.env.OPENCODE_RELEASE_CHANNEL=prior}
const checks={stableOwnerEstablished:owner.mode==='shared',devRejected:rejection.includes('must use isolated worktrees'),dirtyPreserved:readFileSync(join(projectDir,'owned.txt'),'utf8')==='stable owner dirty work\n',ownershipAndJournalsPreserved:digest(stable.runtime)===before}
const report={ok:Object.values(checks).every(Boolean),checks,rejection,dir};writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exit(report.ok?0:1)
