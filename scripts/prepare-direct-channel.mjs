/** Prepare channel environment only. Never own or proxy a terminal. */
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync,symlinkSync,copyFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
const channel=process.argv[2]
if(!['dev','stable'].includes(channel))throw Error('Choose dev or stable')
const repository=join(homedir(),'.config','opencode'),registry=join(repository,'.channels')
const read=path=>JSON.parse(readFileSync(path,'utf8'))
const selectedPath=join(registry,'dev.json'),selectedDev=existsSync(selectedPath)?read(selectedPath):undefined
// Explicit candidate verification uses the ordinary native launcher and existing dev state.
// A candidate never depends on activation and never changes it: trying a branch must work with no
// selected dev release at all, and must leave the selected one exactly as it was.
const candidate=channel==='dev'?process.env.OPENCODE_DEV_CANDIDATE:undefined
const dev=candidate?read(join(candidate,'channel-release.json')):selectedDev
if(!dev)throw Error('No dev channel is activated; prepare and activate one, or try a ref with ocb')
if(candidate&&(dev.channel!=='dev'||dev.root!==candidate))throw Error('Invalid explicit dev candidate')
const root=channel==='dev'?dev.root:repository
const {useRelease}=await import(pathToFileURL(join(dev.root,'scripts/release-retirement.mjs')))
const ownerAt=process.argv.indexOf('--owner-pid'),ownerPID=Number(process.argv[ownerAt+1]);if(ownerAt<0||!Number.isSafeInteger(ownerPID)||ownerPID<1)throw Error('Direct launcher owner PID required')
const releaseLease=useRelease(root,ownerPID)
// Use the selected reviewed helper code, never dirty shared source.
const {generationRoot,reviewedAgentConfig}=await import(pathToFileURL(join(dev.root,'scripts/runtime-contract.mjs')))
const {inspectHostExecutable}=await import(pathToFileURL(join(dev.root,'project-router/executable.mjs')))
const JSON5=createRequire(join(dev.root,'package.json'))('json5')
const pointer=read(join(root,'plugin-activation.json')),generation=pointer.activeGeneration,selected=generationRoot(root,generation)
if(!pointer.evidence?.ok||read(join(selected,'.deployment-source.json')).commit!==pointer.evidence.sourceCommit)throw Error('Channel generation differs from verified source')
const control=join(root,'run','direct','launch-'+Date.now()+'-'+process.pid),config=join(control,'config')
mkdirSync(config,{recursive:true})
for(const entry of readdirSync(root,{withFileTypes:true})){
 if(['.git','.channels','.worktrees','.claude','test','run','.visual-e2e','.candidates','opencode.jsonc'].includes(entry.name))continue
 const from=join(root,entry.name),to=join(config,entry.name)
 if(entry.isDirectory()||entry.isSymbolicLink())symlinkSync(from,to,'junction');else copyFileSync(from,to)
}
const reviewed=JSON.parse(reviewedAgentConfig(root,generation))
if(channel==='dev')reviewed.agents[reviewed.default_agent]={...reviewed.agents[reviewed.default_agent],model:dev.model}
writeFileSync(join(config,'opencode.jsonc'),JSON.stringify({...JSON5.parse(readFileSync(join(selected,'opencode.jsonc'),'utf8')),...reviewed}))
const env={OPENCODE_CONFIG_DIR:config,OPENCODE_CONFIG_CONTENT:JSON.stringify(reviewed),OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_RELEASE_CHANNEL:channel,OPENCODE_PLUGIN_GENERATION:generation,OPENCODE_RUNTIME_RECEIPT:join(control,'loads.jsonl'),OPENCODE_RUNTIME_CONTROL:null,OPENCODE_RUNTIME_TOKEN:null}
if(channel==='dev'){
 const state=join(registry,'state','dev');mkdirSync(state,{recursive:true})
 Object.assign(env,{XDG_STATE_HOME:join(state,'xdg'),OPENCODE_DB:join(state,'host.db'),OPENCODE_QUEST_ROOT:join(state,'quests'),OPENCODE_ORCHESTRATION_LEDGER:join(state,'orchestration.jsonl'),OPENCODE_TELEMETRY_FILE:join(state,'requests.jsonl')})
}
const {readUserGiver}=await import(pathToFileURL(join(dev.root,'quest/giver-registry.mjs')))
const giver=readUserGiver(join(env.OPENCODE_QUEST_ROOT??homedir(),'.opencode','.quest-runtime'))
if(giver&&giver.state!=='bound')throw Error('Your giver creation is uncertain; inspect it before opening another conversation')
const banner={candidate:candidate??undefined,ref:dev.ref,resolvedRef:dev.resolved,subject:dev.subject,commit:dev.commit,model:channel==='dev'?dev.model:undefined,preparedAt:dev.preparedAt,activatedCommit:selectedDev?.commit,activatedRoot:selectedDev?.root}
const plan={channel,releaseLease,retirementScript:join(dev.root,'scripts/release-retirement.mjs'),host:inspectHostExecutable(),generation,sourceCommit:pointer.evidence.sourceCommit,banner,env,...(giver?.sessionID?{giverSessionID:giver.sessionID}:{})}
writeFileSync(join(control,'launch.json'),JSON.stringify(plan,null,2))
console.log(JSON.stringify(plan))
