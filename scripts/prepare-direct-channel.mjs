/** Prepare channel environment only. Never own or proxy a terminal. */
import {readFileSync,writeFileSync,mkdirSync,readdirSync,symlinkSync,copyFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
const channel=process.argv[2]
if(!['dev','stable'].includes(channel))throw Error('Choose dev or stable')
const repository=join(homedir(),'.config','opencode'),registry=join(repository,'.channels')
const read=path=>JSON.parse(readFileSync(path,'utf8'))
const dev=read(join(registry,'dev.json')),root=channel==='dev'?dev.root:repository
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
const plan={channel,host:inspectHostExecutable(),generation,sourceCommit:pointer.evidence.sourceCommit,env}
writeFileSync(join(control,'launch.json'),JSON.stringify(plan,null,2))
console.log(JSON.stringify(plan))
