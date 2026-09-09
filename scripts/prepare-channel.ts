/** Prepare a quarantined channel release with a real configured model, not a synthetic provider. */
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {reviewedAgentConfig} from './runtime-contract.mjs'
import {stageCandidate,freePort} from './plugin-deploy'
import {runArgv,hostExecutable} from '../project-router/host'
const root=resolve(import.meta.dir,'..'),at=process.argv.indexOf('--model'),model=process.argv[at+1]
if(at<0||!model)throw Error('Exact model required')
const candidate=stageCandidate(root),source=JSON.parse(readFileSync(join(candidate,'.deployment-source.json'),'utf8')),generation='gen-'+source.commit.slice(0,12)
mkdirSync(join(root,'generations'),{recursive:true});const selected=join(root,'generations',generation);renameSync(candidate,selected)
const proof=join(root,'run','channel-prepare');mkdirSync(proof,{recursive:true})
const receipt=join(proof,'loads.jsonl'),marker='CHANNEL_REAL_MODEL_READY'
const env={...process.env,OPENCODE_CONFIG_CONTENT:reviewedAgentConfig(root,generation),OPENCODE_PLUGIN_GENERATION:generation,OPENCODE_RUNTIME_RECEIPT:receipt,CLAUDE_CODE_BRIDGE_PORT:String(await freePort())}
const outcome=await runArgv(hostExecutable(),['run','--standalone','--auto','--agent','general','-m',model,`Reply exactly ${marker}. Do not call tools, create Quests or change files.`],{cwd:root,env,timeout:120000,maxBytes:12000})
const loads=readFileSync(receipt,'utf8').trim().split('\n').map(x=>JSON.parse(x))
const ok=outcome.code===0&&outcome.stdout.includes(marker)&&loads.some(x=>x.component==='server'&&x.sourceCommit===source.commit)
const evidence={ok,sourceCommit:source.commit,model,outcome,loads,realProvider:true}
writeFileSync(join(proof,'report.json'),JSON.stringify(evidence,null,2))
if(!ok)throw Error('Real model preparation failed: '+join(proof,'report.json'))
writeFileSync(join(root,'plugin-activation.json'),JSON.stringify({schema:2,activeGeneration:generation,lastKnownGood:generation,updated:new Date().toISOString(),evidence},null,2))
console.log(JSON.stringify({prepared:true,sourceCommit:source.commit,generation,model,report:join(proof,'report.json')}))
