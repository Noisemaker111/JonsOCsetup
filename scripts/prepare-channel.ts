/** Prepare a quarantined channel release with a real configured model, not a synthetic provider. */
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {reviewedAgentConfig} from './runtime-contract.mjs'
import {stageCandidate,freePort} from './plugin-deploy'
import {ensureHostModelCatalog,git,judgePreparation,watchProviderSettlement} from './channel-prepare.mjs'
import {runArgv,hostExecutable} from '../project-router/host'
const root=resolve(import.meta.dir,'..'),at=process.argv.indexOf('--model'),model=process.argv[at+1]
if(at<0||!model)throw Error('Exact model required')
const sourceCommit=git(root,['rev-parse','HEAD'])
const modelCatalog=process.env.OPENCODE_MODEL_CATALOG_PREFLIGHT?JSON.parse(process.env.OPENCODE_MODEL_CATALOG_PREFLIGHT):await ensureHostModelCatalog({model,repository:root,commit:sourceCommit})
const candidate=stageCandidate(root),source=JSON.parse(readFileSync(join(candidate,'.deployment-source.json'),'utf8')),generation='gen-'+source.commit.slice(0,12)
mkdirSync(join(root,'generations'),{recursive:true});const selected=join(root,'generations',generation);renameSync(candidate,selected)
const proof=join(root,'run','channel-prepare');mkdirSync(proof,{recursive:true})
const receipt=join(proof,'loads.jsonl'),marker='CHANNEL_REAL_MODEL_READY'
const env={...process.env,OPENCODE_CONFIG_CONTENT:reviewedAgentConfig(root,generation),OPENCODE_PLUGIN_GENERATION:generation,OPENCODE_RUNTIME_RECEIPT:receipt,CLAUDE_CODE_BRIDGE_PORT:String(await freePort())}

const controller=new AbortController(),watch=watchProviderSettlement({controller,since:Date.now()})
let outcome:{code:number|null;stdout:string;stderr:string}
try {
 outcome=await runArgv(hostExecutable(),['run','--standalone','--auto','--agent','general','-m',model,`Reply exactly ${marker}. Do not call tools, create Quests or change files.`],{cwd:root,env,timeout:120000,maxBytes:12000,signal:controller.signal})
} catch (error) {
 // A timeout or an early stop used to reject before anything was written, so the one file that
 // explains the preparation did not exist at the path the failure pointed at.
 outcome={code:null,stdout:'',stderr:error instanceof Error?error.message:String(error)}
} finally { watch.stop() }

const loads=existsSync(receipt)?readFileSync(receipt,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[]
const loaded=loads.some(x=>x.component==='server'&&x.sourceCommit===source.commit)
const answered=outcome.code===0&&outcome.stdout.includes(marker)
const providerFailure=watch.failure()

const {probe,ok,accepted}=judgePreparation({loaded,answered,providerFailure})
const evidence={ok,accepted,probe,providerFailure,sourceCommit:source.commit,model,modelCatalog,outcome,loads,realProvider:true}
writeFileSync(join(proof,'report.json'),JSON.stringify(evidence,null,2))
if(!accepted)throw Error('Real model preparation failed: '+join(proof,'report.json'))
writeFileSync(join(root,'plugin-activation.json'),JSON.stringify({schema:2,activeGeneration:generation,lastKnownGood:generation,updated:new Date().toISOString(),evidence},null,2))
console.log(JSON.stringify({prepared:true,sourceCommit:source.commit,generation,model,probe,report:join(proof,'report.json')}))
