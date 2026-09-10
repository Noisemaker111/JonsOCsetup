/** Installed-host navigation checks using a copied, real model readiness transcript.
 * This is navigation evidence, NOT successful Quest dispatch acceptance. */
import {EmbeddedTerminalRenderable,KeyEvent} from '@opentui/core'
import {createTestRenderer} from '@opentui/core/testing'
import {Resvg} from '@resvg/resvg-js'
import {frameToSvg,HOST_PALETTE} from '../ui-lab/frame-html'
import {Database} from 'bun:sqlite'
import {spawn} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {QuestStore} from '../quest/store'
import {projectIdentity} from '../quest/project'
import {freePort} from './plugin-deploy'
const root=resolve(process.argv[2]),output=join(root,'.visual-e2e','installed-navigation-'+Date.now())
mkdirSync(output,{recursive:true})
const marker=process.argv[4]??'CHANNEL_REAL_MODEL_READY'
const sourceDB=process.argv[3]?resolve(process.argv[3]):join(root,'.visual-e2e','preparation','host.db'),source=new Database(sourceDB,{readonly:true})
const actual:any=source.query('select id,directory,model,time_idle,idle_outcome from session_v2 order by time_created desc limit 1').get();source.close()
if(actual?.idle_outcome!=='succeeded')throw Error('Real model transcript must have a persisted successful outcome')
const project=projectIdentity(root)
const model=JSON.parse(actual.model),sourceCommit=JSON.parse(readFileSync(join(root,'plugin-activation.json'),'utf8')).evidence.sourceCommit
const report:any={ok:false,scope:'Installed native session navigation with real recorded transcript; Quest dispatch acceptance remains separate',root,sourceCommit,model,runs:[]}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
for(const width of [160,80]){
 const dir=join(output,'width-'+width);mkdirSync(dir,{recursive:true});const dbPath=join(dir,'host.db');copyFileSync(sourceDB,dbPath)
 for(const suffix of ['-wal','-shm'])if(existsSync(sourceDB+suffix))copyFileSync(sourceDB+suffix,dbPath+suffix)
 const store=new QuestStore(join(dir,'ledger')),q=store.create({id:'01j00000000000000000000977',title:'Verify installed Quest session navigation',objective:'Open the actual recorded readiness session and return',description:'Navigation check against the real configured model transcript. This does not claim a successful Quest worker dispatch.',contractVersion:2,project,stages:[{id:'navigate',title:'Check keyboard and mouse navigation',status:'pending',needs:[]}],reward:'Installed captures and saved verification result'})
 store.apply(q.id,'session-planned',{callID:'navigation-evidence',role:'worker',model:model.providerID+'/'+model.id,deliverables:[]},'verification')
 store.apply(q.id,'session-claimed',{callID:'navigation-evidence',sessionID:actual.id,providerID:model.providerID,modelID:model.id,reasoningEffort:model.variant,runtime:'native',scope:{worktree:actual.directory},task:'Real model transcript (navigation reference)'},'verification')
 store.apply(q.id,'session-state',{callID:'navigation-evidence',state:'completed',result:'Host persisted a successful execution outcome'},'verification')
 store.apply(q.id,'evidence-added',{kind:'artifacts',value:{name:'Development workflow',path:'docs/development-workflow.md',label:'Recorded source instructions',at:new Date().toISOString(),verified:false}},'verification')
 const height=width===160?52:32,setup=await createTestRenderer({width,height}),terminal=new EmbeddedTerminalRenderable(setup.renderer,{id:'installed',width,height,cols:width,rows:height,maxScrollback:100000});setup.renderer.root.add(terminal);terminal.focus()
 const env={...process.env,OPENCODE_CONFIG_DIR:root,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_RELEASE_CHANNEL:'dev',OPENCODE_DB:dbPath,OPENCODE_QUEST_ROOT:store.projectRoot,OPENCODE_ORCHESTRATION_LEDGER:join(dir,'orchestration.jsonl'),OPENCODE_TELEMETRY_FILE:join(dir,'requests.jsonl'),XDG_STATE_HOME:join(dir,'state'),OPENCODE_DISABLE_AUTOUPDATE:'1',CLAUDE_CODE_BRIDGE_PORT:String(await freePort()),OPENCODE_ROUTE_RESERVATIONS:'C:/Users/Jk101/.config/opencode/.channels/state/dev/quests/.opencode/.quest-runtime/route-reservations.json'}
 const child=spawn('node',[join(root,'scripts/opencode-runtime.mjs'),'--json','--cwd',root,'--model',model.providerID+'/'+model.id+'#'+model.variant,'--agent','quest-giver','--cols',String(width),'--rows',String(height)],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
 let buffer='',errors='',exited=false;const events:any[]=[],result:any={width,height,ok:false,screenshots:[],sessionID:actual.id}
 child.stdout.on('data',chunk=>{buffer+=chunk;for(;;){const n=buffer.indexOf('\n');if(n<0)break;const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const e=JSON.parse(line);if(e.type==='data')terminal.write(Buffer.from(e.data,'base64').toString());else events.push(e)}catch{errors+=line}}});child.stderr.on('data',x=>errors+=x);child.on('exit',()=>exited=true)
 const send=(data:string)=>child.stdin.write(JSON.stringify({type:'write',data:Buffer.from(data).toString('base64')})+'\n')
 terminal.onData=data=>send(Buffer.from(data).toString())
 const frame=async()=>{await setup.renderOnce();return terminal.screen().text}
 async function wait(label:string,check:()=>any){const end=Date.now()+45000;while(Date.now()<end){if(await check())return;if(exited)throw Error(label+': host exited '+errors);await sleep(200)}throw Error(label+': timed out')}
 async function capture(name:string){await setup.renderOnce();const path=join(dir,name+'.png');writeFileSync(path,new Resvg(frameToSvg(setup.captureSpans(),name,HOST_PALETTE),{font:{loadSystemFonts:true}}).render().asPng());writeFileSync(join(dir,name+'.txt'),await frame());result.screenshots.push(path)}
 async function key(name:string,sequence:string){send(Buffer.from(terminal.encodeKey(new KeyEvent({name,sequence,raw:sequence,ctrl:false,meta:false,shift:false,option:false,number:false,eventType:'press',source:'raw'}))).toString());await sleep(350)}
 async function command(value:string){send(Buffer.from(terminal.encodePaste(new TextEncoder().encode(value))).toString());await sleep(1000);await frame();await key('return','\r')}
 try{
  await wait('plugin load',()=>{const launch=events.find(e=>e.type==='launched');if(!launch||!existsSync(launch.receipt))return false;result.loads=readFileSync(launch.receipt,'utf8').trim().split('\n').map(s=>JSON.parse(s));return result.loads.some((l:any)=>l.component==='tui:quests'&&l.sourceCommit===sourceCommit)})
  await wait('home',async()=>(await frame()).includes('Quests'))
  await sleep(1000);await command('/quests');await wait('board',async()=>(await frame()).includes('Search quests'))
  if(width<100)await key('return','\r')
  await wait('details',async()=>(await frame()).includes('QUEST STEPS'));await capture('board');await key('v','v');await wait('recorded checks dialog',async()=>(await frame()).includes('Recorded checks'));await capture('recorded-checks');await key('escape','\x1b');result.checks=true
  await key('w','w');await wait('actual native session',async()=>(await frame()).includes(marker));await capture('worker-keyboard')
  await command('/quest-back');await wait('return to selected Quest',async()=>(await frame()).includes('QUEST STEPS'));result.keyboard=true
  for(let i=0;i<4;i++)await key('pagedown','\x1b[6~')
  await wait('live inspection completes',async()=>!(await frame()).includes('Checking owning host'));await capture('agent-log');if(!(await frame()).includes('Development workflow'))throw Error('Recorded artifact preview missing');result.artifactPreview=true;const lines=(await frame()).split('\n'),y=lines.findIndex(l=>l.includes('↳')&&l.includes(model.id)),x=y<0?-1:lines[y].indexOf('↳')
  if(y<0)throw Error('Worker mouse target not visible')
  send('\x1b[<0;'+(x+3)+';'+(y+1)+'M');send('\x1b[<0;'+(x+3)+';'+(y+1)+'m')
  await wait('mouse native session',async()=>(await frame()).includes(marker));await capture('worker-mouse');result.mouse=true
  await command('/quest-back');await wait('mouse return',async()=>(await frame()).includes('QUEST STEPS'));await capture('returned')
  store.apply(q.id,'stage-state',{stageID:'navigate',status:'done',evidence:'Actual installed keyboard and mouse opened the native recorded transcript and returned'},'verification')
  result.persisted=new QuestStore(store.projectRoot).read(q.id);result.ok=result.persisted.stages[0].status==='done'
 }catch(e){result.error=String(e);await capture('failure')}
 finally{terminal.onData=undefined;if(!exited){await key('escape','\x1b');if(width<100)await key('escape','\x1b');await command('/exit');await sleep(1500)}terminal.destroy();setup.renderer.destroy();result.events=events;result.errors=errors;report.runs.push(result);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2))}
 console.log(JSON.stringify({width,ok:result.ok,error:result.error,output:dir}))
}
report.ok=report.runs.every((r:any)=>r.ok);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));console.log(join(output,'report.json'));process.exit(report.ok?0:1)
