/** Drive the installed OpenCode2 terminal with real Luna turns; capture its actual PTY pixels. */
import {EmbeddedTerminalRenderable,KeyEvent} from '@opentui/core'
import {createTestRenderer} from '@opentui/core/testing'
import {Resvg} from '@resvg/resvg-js'
import {frameToSvg,HOST_PALETTE} from '../ui-lab/frame-html'
import {Database} from 'bun:sqlite'
import {spawn} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {QuestStore} from '../quest/store'
import {projectIdentity} from '../quest/project'
import {freePort} from './plugin-deploy'
const opt=(s:string)=>process.argv[process.argv.indexOf(s)+1]
const root=resolve(opt('--candidate')),model=opt('--model'),hub=resolve(opt('--hub'))
if(!model||!process.argv.includes('--candidate')||!process.argv.includes('--hub'))throw Error('Choose candidate, real model, and hub')
const sourceCommit=JSON.parse(readFileSync(join(root,'channel-release.json'),'utf8')).commit
const resume=process.argv.includes('--resume')?resolve(opt('--resume')):undefined
const output=resume?dirname(resume):join(root,'.visual-e2e','real-returns-'+Date.now());mkdirSync(output,{recursive:true})
const report:any=resume?JSON.parse(readFileSync(resume,'utf8')):{ok:false,root,sourceCommit,model,hub,realProvider:true,runs:[]}
if(report.root!==root||report.sourceCommit!==sourceCommit||report.model!==model||report.runs.some((r:any)=>!r.ok))throw Error('Only matching successful partial evidence can be resumed')
const project=projectIdentity(hub)
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
for(let number=report.runs.length+1;number<=2;number++){
 const dir=join(output,'run-'+number);mkdirSync(dir,{recursive:true})
 const ledger=join(dir,'ledger'),database=join(dir,'host.db'),store=new QuestStore(ledger)
 const q=store.create({id:'01j0000000000000000000099'+number,title:'Dev launch failure reaches its giver '+number,objective:'Exercise an unavailable checkout and surface its failure automatically',description:'Authorized dev acceptance; no changes to the hub or stable work.',contractVersion:2,project,stages:[{id:'check',title:'Attempt the selected checkout once',commandID:'check',status:'pending',needs:[]}]})
 const policy=JSON.parse(readFileSync(join(root,'models/dispatch-policy.json'),'utf8'));policy.commandsByProject={[project.id]:{check:{description:'Harmless command; checkout admission should fail first',argv:[process.execPath,'-e','console.log("CHECKOUT_AVAILABLE")'],timeoutMilliseconds:5000}}}
 writeFileSync(join(dir,'dispatch.json'),JSON.stringify(policy))
 const env={...process.env,OPENCODE_CONFIG_DIR:root,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_DB:database,OPENCODE_QUEST_ROOT:ledger,OPENCODE_ORCHESTRATION_LEDGER:join(dir,'orchestration.jsonl'),OPENCODE_DISPATCH_POLICY:join(dir,'dispatch.json'),XDG_STATE_HOME:join(dir,'state'),OPENCODE_RELEASE_CHANNEL:'dev',OPENCODE_DISABLE_AUTOUPDATE:'1',CLAUDE_CODE_BRIDGE_PORT:String(await freePort())}
 const setup=await createTestRenderer({width:150,height:52}),terminal=new EmbeddedTerminalRenderable(setup.renderer,{id:'real-host',width:150,height:52,cols:150,rows:52,maxScrollback:100000});setup.renderer.root.add(terminal);terminal.focus()
 const child=spawn('node',[join(root,'scripts/opencode-runtime.mjs'),'--json','--auto','--cwd',hub,'--model',model,'--agent','quest-giver','--cols','150','--rows','52'],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
 let buffer='',stderr='',exited=false;const events:any[]=[],row:any={number,ok:false,automaticReturn:false,screenshots:[],questTitle:q.title}
 child.stdout.on('data',data=>{buffer+=data;for(;;){const at=buffer.indexOf('\n');if(at<0)break;const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;try{const event=JSON.parse(line);if(event.type==='data')terminal.write(Buffer.from(event.data,'base64').toString());else{events.push(event);console.log('run '+number+': '+event.type)}}catch{stderr+=line}}})
 child.stderr.on('data',x=>stderr+=x);child.once('exit',()=>exited=true);child.once('error',x=>{stderr+=x;exited=true})
 const send=(data:string)=>child.stdin.write(JSON.stringify({type:'write',data:Buffer.from(data).toString('base64')})+'\n')
 terminal.onData=data=>send(Buffer.from(data).toString())
 const frame=async()=>{await setup.renderOnce();return terminal.screen().text}
 async function wait(label:string,predicate:()=>any,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;if(exited||events.some(e=>e.type==='error'))throw Error(label+': host failed '+stderr);await sleep(300)}throw Error(label+': timed out')}
 async function capture(name:string){await setup.renderOnce();const path=join(dir,name+'.png');writeFileSync(path,new Resvg(frameToSvg(setup.captureSpans(),name,HOST_PALETTE),{font:{loadSystemFonts:true}}).render().asPng());writeFileSync(join(dir,name+'.txt'),await frame());row.screenshots.push(path)}
 async function key(name:string,sequence:string){send(Buffer.from(terminal.encodeKey(new KeyEvent({name,sequence,raw:sequence,ctrl:false,meta:false,shift:false,option:false,number:false,eventType:'press',source:'raw'}))).toString());await sleep(300)}
 async function command(text:string){send(Buffer.from(terminal.encodePaste(new TextEncoder().encode(text))).toString());await sleep(350);await key('return','\r')}
 let db:Database|undefined
 try{
  await wait('server and UI loads',()=>{const launch=events.find(e=>e.type==='launched');if(!launch||!existsSync(launch.receipt))return false;const loads=readFileSync(launch.receipt,'utf8').trim().split('\n').map(x=>JSON.parse(x));row.loads=loads;return ['server','tui:usage','tui:quests'].every(c=>loads.some(l=>l.component===c&&l.sourceCommit===sourceCommit))})
  await wait('home composer',async()=> (await frame()).includes('Quests'))
  await command('/plugins');await sleep(1500);await capture('host-plugins');await key('escape','\x1b')
  await command('/extensions');await wait('extension inventory',async()=> (await frame()).includes('opencode-project-router'));await capture('extensions');await key('escape','\x1b')
  const destinationRequest = `Run the existing Quest titled ${q.title} (id ${q.id}) using quest action run with stepIDs [check]. This is a command step; do not supply a model or create another Quest. Attempt once, report the actual tool error and whether a worker started, then finish. Do not fix checkout selection or change source.`
  const prompt=`Please delegate this request to ${hub}: "${destinationRequest}". For this originating conversation only: call project_select, capture its returned revision, and use that exact revision in project_route with requestKey dev-return-${number}. Never guess the revision. Route only the quoted request. Once delivered, briefly acknowledge delivery and finish your turn. Do not poll project_result, ask a question, sleep, or send another destination prompt. When an automatic delegation update arrives, explain the exact failure and whether any worker started, using its actual tool evidence.`

  await command(prompt)
  await wait('saved hub session',()=>{if(!existsSync(database))return false;db??=new Database(database,{readonly:true});const found:any=db.query('select id from session_v2 where parent_id is null order by time_created asc').get();if(found)row.sessionID=found.id;return !!found})
  await wait('automatic return and completed assistant',()=>{const records:any[]=db!.query('select type,data from session_message where session_id=? order by seq').all(row.sessionID);const messages=records.map(r=>({type:r.type,...JSON.parse(r.data)}));row.messages=messages.map(m=>({...m,content:m.content?.filter((p:any)=>p.type!=='reasoning')}));if(messages.some(m=>m.type==='assistant'&&m.model&&m.model.providerID+'/'+m.model.id+'#'+m.model.variant!==model))throw Error('Actual model differs from selected route');const at=messages.findIndex(m=>JSON.stringify(m).includes('Delegation update for'));if(at<0)return false;const response=messages.slice(at+1).find(m=>m.type==='assistant'&&m.time?.completed&&JSON.stringify(m).includes('checkout'));row.automaticReturn=!!response;return row.automaticReturn},240000)
  await sleep(1500);await capture('automatic-return')
  const all:any[]=db!.query('select type,data from session_message').all();row.actualToolFailure=all.some(r=>r.type==='assistant'&&(JSON.parse(r.data).content??[]).some((p:any)=>p.type==='tool'&&JSON.stringify(p.state?.content??p.state?.error).includes('Cannot establish selected Git checkout')));row.quest=store.read(q.id);row.noWorker=row.quest.sessions.every((s:any)=>!s.sessionID);row.ok=row.automaticReturn&&row.noWorker&&row.actualToolFailure
 }catch(error){row.error=String(error);await capture('failure')}
 finally{db?.close();terminal.onData=undefined;if(!exited)child.stdin.write(JSON.stringify({type:'stop'})+'\n');await sleep(1500);terminal.destroy();setup.renderer.destroy();row.events=events;row.stderr=stderr;report.runs.push(row);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2))}
 console.log(JSON.stringify({number,ok:row.ok,error:row.error,output:dir}))
 if(!row.ok)break
}
report.ok=report.runs.length===2&&report.runs.every((r:any)=>r.ok);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,report:join(output,'report.json')}));process.exit(report.ok?0:1)

