/** Real installed dispatch, worker completion, automatic giver response and native navigation. */
import {EmbeddedTerminalRenderable,KeyEvent} from '@opentui/core'
import {createTestRenderer} from '@opentui/core/testing'
import {Resvg} from '@resvg/resvg-js'
import {frameToSvg,HOST_PALETTE} from '../ui-lab/frame-html'
import {Database} from 'bun:sqlite'
import {spawn} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync,existsSync,mkdtempSync,appendFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {readAllQuests} from '../quest/index'
import {join,resolve} from 'node:path'
import {QuestStore} from '../quest/store'
import {projectIdentity} from '../quest/project'
import {freePort} from './plugin-deploy'
import {getAccountUsage} from '../usage/account-api'
import {liveDispatchRoutes} from '../models/live-routes'
const root=resolve(process.argv[2]),reservations=resolve(process.argv[3]),output=join(root,'.visual-e2e','installed-single-giver-'+Date.now())
const policy=JSON.parse(readFileSync(join(root,'models/dispatch-policy.json'),'utf8'))
// The check must run on a lane that has capacity. Pinning the primary route, or a hardcoded
// giver model, fails the whole gate when that account is spent even though other routes are free.
const snapshot=await getAccountUsage()
// Choose from the same candidate pool a real dispatch ranks -- the policy's curated routes plus
// whatever the live join derives -- or this gate fails whenever the curated accounts are spent
// and the router would happily have run somewhere else.
const live=await liveDispatchRoutes(policy,snapshot)
const candidates=[...live.curated,...live.derived]
const usable=(r:any)=>snapshot.accounts.some((a:any)=>a.id===r.accountID&&a.state==='available')
// Verify on the lane the channel actually ships on when it has capacity: a route can hold quota
// and still be unusable here, and the activated model is the one already proven against this host.
const activated=(()=>{try{const c=JSON.parse(readFileSync(join(root,"..","..","dev.json"),"utf8"));return String(c.model??"")}catch{return ""}})()
// Reasoning effort is part of route identity, so match the whole thing. Matching on provider/model
// alone returned whichever effort happened to sit first in the candidate list: with dev.json
// recording deepseek-v4.1-flash#high, the gate ran both the giver and the worker at #max, which is
// the most expensive lane for this model and not the one the channel ships. Verification runs on the
// lane that was actually prepared, or it falls through to the policy's primary route as before.
const activatedID=candidates.find((r:any)=>activated&&activated===r.providerID+"/"+r.modelID+"#"+r.reasoning)?.id
const ordered=[activatedID,policy.request.primaryRouteID,...(policy.request.allowedRouteIDs??[]),...live.derived.map(r=>r.id)].filter(Boolean)
const route=ordered.map((id:string)=>candidates.find((r:any)=>r.id===id)).find((r:any)=>r&&usable(r))
if(!route)throw Error('No authorized route has available capacity; this check cannot produce real dispatch evidence')
const holds=()=>policy.billing[route.accountID]==='subscription'&&policy.request.subscriptionConcurrency==='unlimited'?[]:JSON.parse(readFileSync(reservations,'utf8')).reservations.filter((r:any)=>r.accountID===route.accountID&&r.exclusive&&['active','unknown'].includes(r.state))
if(holds().length)throw Error('Existing uncertain account ownership blocks this successful dispatch check; inspect it first')
const workerModel=route.providerID+'/'+route.modelID+'#'+route.reasoning
const project=projectIdentity(root),model=process.env.OPENCODE_VERIFY_GIVER_MODEL??workerModel
const sourceCommit=JSON.parse(readFileSync(join(root,'plugin-activation.json'),'utf8')).evidence.sourceCommit
mkdirSync(output,{recursive:true});const report:any={ok:false,scope:'Real configured worker dispatch, persisted step and terminal outcome, automatic giver return, native worker navigation',root,sourceCommit,model,workerModel,runs:[]}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
const fixture=mkdtempSync(join(tmpdir(),'quest-giver-projects-'));report.projects=[]
// Resolve fixture identities before starting the PTY renderer. Runtime project_select
// still independently verifies each source in the installed host on each real turn.
const fixtures=[1,2].map(number=>{const directory=join(fixture,'project-'+number);mkdirSync(directory);writeFileSync(join(directory,'AGENTS.md'),'This is installed verification project '+number+'. Read only this instruction file and report the project number honestly. Do not edit files or run shell commands.\n');report.projects.push(directory);return {directory,expectedProject:projectIdentity(directory)}})
{
 if(holds().length)throw Error('An account worker is still active or unknown; no duplicate launch')
 let number=1,dir=join(output,'run-1');mkdirSync(dir,{recursive:true});const database=join(output,'host.db'),store=new QuestStore(join(output,'ledger'))

 const setup=await createTestRenderer({width:150,height:52}),terminal=new EmbeddedTerminalRenderable(setup.renderer,{id:'hold-check',width:150,height:52,cols:150,rows:52,maxScrollback:100000});setup.renderer.root.add(terminal);terminal.focus()
 const env={...process.env,OPENCODE_CONFIG_DIR:root,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_RELEASE_CHANNEL:'dev',OPENCODE_DB:database,OPENCODE_QUEST_ROOT:store.projectRoot,OPENCODE_ROUTE_RESERVATIONS:reservations,OPENCODE_ORCHESTRATION_LEDGER:join(dir,'orchestration.jsonl'),OPENCODE_TELEMETRY_FILE:join(dir,'requests.jsonl'),XDG_STATE_HOME:join(dir,'state'),OPENCODE_DISABLE_AUTOUPDATE:'1',CLAUDE_CODE_BRIDGE_PORT:String(await freePort())}
 const child=spawn('node',[join(root,'scripts/opencode-runtime.mjs'),'--json','--auto','--cwd',root,'--model',model,'--agent','quest-giver','--cols','150','--rows','52'],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
 let buffer='',errors='',exited=false,db:Database|undefined;const events:any[]=[];let row:any={number,ok:false,screenshots:[]}
 child.stdout.on('data',chunk=>{buffer+=chunk;for(;;){const n=buffer.indexOf('\n');if(n<0)break;const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const e=JSON.parse(line);if(e.type==='data'){const raw=Buffer.from(e.data,'base64').toString();appendFileSync(join(output,'terminal.ansi'),raw);terminal.write(raw);}else events.push(e)}catch{errors+=line}}});child.stderr.on('data',x=>errors+=x);child.on('exit',()=>exited=true)
 const send=(data:string)=>{appendFileSync(join(output,'input.jsonl'),JSON.stringify({at:new Date().toISOString(),data})+'\n');return child.stdin.write(JSON.stringify({type:'write',data:Buffer.from(data).toString('base64')})+'\n')};terminal.onData=data=>send(Buffer.from(data).toString())
 const frame=async()=>{await setup.renderOnce();return terminal.screen().text}
 /**
  * Two classes of wait, and the default only ever suited one of them. 60s is generous for a UI
  * transition -- a composer appearing, a board rendering -- and far too tight for a model turn: on
  * 2026-09-11 the gate failed the merged candidate with "Quest created: timed out" because the giver
  * spent a single 56.9s thought on a max-reasoning lane before it made any call at all. Measured over
  * 24,232 recorded assistant turns the p90 turn is 31.8s, and a high-effort lane reading a long gate
  * instruction sits well past that, so a wait that spans a model turn gets the same bound the gate
  * already gives worker completion. This is headroom for a turn that is working, not a slower gate:
  * every wait returns the moment its condition holds.
  */
 const MODEL_TURN=240000
 async function wait(label:string,check:()=>any,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;if(exited)throw Error(label+': host exited '+errors);await sleep(300)}throw Error(label+': timed out')}
 async function capture(name:string){await setup.renderOnce();const path=join(dir,name+'.png');writeFileSync(path,new Resvg(frameToSvg(setup.captureSpans(),name,HOST_PALETTE),{font:{loadSystemFonts:true}}).render().asPng());writeFileSync(join(dir,name+'.txt'),await frame());row.screenshots.push(path)}
 async function key(name:string,sequence:string){send(Buffer.from(terminal.encodeKey(new KeyEvent({name,sequence,raw:sequence,ctrl:false,meta:false,shift:false,option:false,number:false,eventType:'press',source:'raw'}))).toString());await sleep(350)}
 async function command(text:string){send(Buffer.from(terminal.encodePaste(new TextEncoder().encode(text))).toString());await sleep(1000);await frame();await capture('before-enter');await key('return','\r')}
 try{
  await wait('plugin load',()=>{const e=events.find(e=>e.type==='launched');if(!e||!existsSync(e.receipt))return false;row.loads=readFileSync(e.receipt,'utf8').trim().split('\n').map(s=>JSON.parse(s));return row.loads.some((l:any)=>l.component==='tui:quests'&&l.sourceCommit===sourceCommit)})
  await wait('composer',async()=>(await frame()).includes('Quests'));await sleep(1000)
  await sleep(2500);await capture('giver-before-prompt')
  await command('Reply exactly SINGLE_GIVER_READY. This is conversation only. Do not call tools, create Quests, dispatch, or change files.')
  await wait('first discussion registered',()=>{
    if(!existsSync(database))return false;db??=new Database(database,{readonly:true})
    const giver:any=db.query("select id,idle_outcome from session_v2 where agent='quest-giver' and parent_id is null order by time_created asc").get()
    if(giver?.idle_outcome!=='succeeded')return false
    const file=join(store.runtime,'user-giver.json');if(!existsSync(file))return false
    const binding=JSON.parse(readFileSync(file,'utf8'));report.giverSessionID=giver.id;report.firstDiscussion=binding.state==='bound'&&binding.sessionID===giver.id&&readAllQuests(store.projectRoot).length===0
    return report.firstDiscussion
  },MODEL_TURN)
  report.loads=row.loads;await capture('registered-discussion')
  for(number=1;number<=2;number++){
   if(holds().length)throw Error('Existing account ownership; no duplicate worker')
   dir=join(output,'run-'+number);mkdirSync(dir,{recursive:true});row={number,sessionID:report.giverSessionID,ok:false,screenshots:[],loads:report.loads}
   const {directory,expectedProject}=fixtures[number-1]
   await command(`Select project ${directory.replaceAll('\\','/')} with project_select action select. Create two independent Quests titled Installed single giver project ${number} and Installed concurrent sibling ${number}. Give each Quest its own description, because one request may not create two Quests that state the same objective. For the first: Read only AGENTS.md in the assigned directory for the single giver check, save INSTALLED_QUEST_WORKER_VERIFIED plus the actual project number and one instruction in assigned step note with quest update.steps state done, then quest get to verify. For the second: Read only AGENTS.md in the assigned directory for the concurrent sibling check, save INSTALLED_QUEST_WORKER_VERIFIED plus the actual project number and one instruction in assigned step note with quest update.steps state done, then quest get to verify. Create one step id inspect, title Read AGENTS.md and save verified result. Run each newly created Quest exactly once immediately, without waiting for either worker to finish, with run {stepIDs:["inspect"],model:"${workerModel}",readOnly:true}. Create each Quest in a separate execute call so it has its own request identity. Use Code Mode Promise.all for the two independent run calls. Do not retry, substitute models, create another giver, or release account holds. Report the admission and finish without polling. When an automatic Quest worker update arrives, get the saved Quest, report its actual saved finding and outcome, and finish without dispatch.`)
   await capture('submitted-request')
   await wait('giver persisted',()=>{if(!existsSync(database))return false;db??=new Database(database,{readonly:true});const found:any=db.query("select id from session_v2 where agent='quest-giver' and parent_id is null order by time_created asc").get();report.giverSessionID??=found?.id;row.sessionID=report.giverSessionID;return !!row.sessionID})
   let q:any
   await wait('Quest created',()=>{q=readAllQuests(store.projectRoot).find(r=>r.quest?.title==='Installed single giver project '+number)?.quest;return !!q},MODEL_TURN)
  let sibling:any
  await wait('both workers bound',()=>{sibling=readAllQuests(store.projectRoot).find(r=>r.quest?.title==='Installed concurrent sibling '+number)?.quest;return !!store.read(q.id)?.sessions[0]?.sessionID&&!!sibling?.sessions[0]?.sessionID},MODEL_TURN)
  await command('/quests');await wait('live board',async()=>(await frame()).includes('Search quests'));{await key('q','q');await wait('Quest picker',async()=>(await frame()).includes('Select Quest'));await command(q.title);}await wait('selected assigned Quest',async()=>(await frame()).split('\n').some(line=>line.indexOf(q.title)>35));await wait('confirmed running',async()=>(await frame()).includes('RUNNING · Saved: executing'));await capture('worker-running');const firstCheck=(await frame()).match(/Checked: ([^\n]+)/)?.[1];await sleep(4500);await capture('worker-activity-update');row.liveUpdates=firstCheck!==(await frame()).match(/Checked: ([^\n]+)/)?.[1]
  await key('n','n');await wait('native composer dialog',async()=>(await frame()).includes('Nudge Quest Giver'));await capture('composer');await key('escape','\x1b');row.composer=true
  await wait('automatic worker response',()=>{const all:any[]=db!.query('select type,data from session_message where session_id=? order by seq').all(row.sessionID);const messages=all.map(r=>({type:r.type,...JSON.parse(r.data)}));row.messages=messages.map(m=>({...m,content:m.content?.filter((p:any)=>p.type!=='reasoning')}));const at=messages.findIndex(m=>m.type==='user'&&JSON.stringify(m).includes('Automatic Quest worker update')&&JSON.stringify(m).includes(q.title));row.automaticReturn=at>=0&&messages.slice(at+1).some(m=>m.type==='assistant'&&m.time?.completed&&m.finish==='stop');return row.automaticReturn},240000)
  await wait('completed live board',async()=>(await frame()).includes('COMPLETED · Saved: completed'));await capture('completed-board');await key('escape','\x1b');await wait('giver response visible',async()=>!(await frame()).includes('Search quests'));await capture('automatic-worker-response');await command('/quests');await wait('board',async()=>(await frame()).includes('Search quests'));await key('q','q');await wait('exact worker Quest picker',async()=>(await frame()).includes('Select Quest'));await command(q.title);await wait('exact worker Quest selected',async()=>(await frame()).split('\n').some(line=>line.indexOf(q.title)>35));await key('w','w');await wait('native worker transcript',async()=>(await frame()).includes('INSTALLED_QUEST_WORKER_VERIFIED')&&(await frame()).includes(q.title)&&!(await frame()).includes('Search quests'));await capture('actual-worker');await command('/quest-back');await wait('returned to Quest',async()=>(await frame()).includes('QUEST STEPS')&&(await frame()).split('\n').some(line=>line.indexOf(q.title)>35));await capture('returned-board')
  row.quest=new QuestStore(store.projectRoot).read(q.id);const run=row.quest.sessions[0];row.singleWorker=row.quest.sessions.length===1&&run?.state==='completed'&&!!run.sessionID;row.savedStep=row.quest.stages[0].status==='done'&&row.quest.stages[0].note?.includes('INSTALLED_QUEST_WORKER_VERIFIED');row.terminal=db!.query('select idle_outcome,model from session_v2 where id=?').get(run?.sessionID??'');row.workerMessages=db!.query('select type,data from session_message where session_id=? order by seq').all(run?.sessionID??'').map((r:any)=>({type:r.type,...JSON.parse(r.data)})).map((m:any)=>({...m,content:m.content?.filter((p:any)=>p.type!=='reasoning')}));const assistants=row.workerMessages.filter((m:any)=>m.type==='assistant');row.exactModel=assistants.length>0&&assistants.every((m:any)=>m.model?.providerID===route.providerID&&m.model?.id===route.modelID&&m.model?.variant===route.reasoning);row.reservation=JSON.parse(readFileSync(reservations,'utf8')).reservations.find((r:any)=>r.runID===run?.runID);row.workerProject=row.quest.project;row.correctProject=row.quest.project.id===expectedProject.id&&row.quest.integrationOwner===report.giverSessionID;row.ok=row.correctProject&&row.liveUpdates&&row.composer&&row.automaticReturn&&row.singleWorker&&row.savedStep&&row.exactModel&&row.terminal?.idle_outcome==='succeeded'&&row.reservation?.state==='settled'
   await wait('concurrent sibling terminal and settled',()=>{const saved=store.read(sibling.id);return saved?.sessions[0]?.state==='completed'&&JSON.parse(readFileSync(reservations,'utf8')).reservations.find((r:any)=>r.runID===saved.sessions[0].runID)?.state==='settled'},240000)
   row.sibling=new QuestStore(store.projectRoot).read(sibling.id)
   const siblingRun=row.sibling.sessions[0],siblingReservation=JSON.parse(readFileSync(reservations,'utf8')).reservations.find((r:any)=>r.runID===siblingRun.runID)
   const siblingAssistant:any[]=db!.query("select data from session_message where session_id=? and type='assistant' order by seq").all(siblingRun.sessionID).map((r:any)=>JSON.parse(r.data))
   row.concurrent={reservation:siblingReservation,overlap:Math.max(Date.parse(row.reservation.startedAt),Date.parse(siblingReservation.startedAt))<Math.min(Date.parse(row.reservation.completedAt),Date.parse(siblingReservation.completedAt)),exactModel:siblingAssistant.length>0&&siblingAssistant.every(m=>m.model?.providerID===route.providerID&&m.model?.id===route.modelID&&m.model?.variant===route.reasoning),terminal:db!.query('select idle_outcome from session_v2 where id=?').get(siblingRun.sessionID)}
   row.ok=row.ok&&row.concurrent.overlap&&row.concurrent.exactModel&&row.concurrent.terminal?.idle_outcome==='succeeded'&&row.sibling.sessions.length===1&&row.sibling.stages[0].status==='done'&&row.sibling.stages[0].note?.includes('INSTALLED_QUEST_WORKER_VERIFIED')&&row.sibling.integrationOwner===report.giverSessionID
   await key('escape','\x1b');await command('/quest-new');await sleep(1200);await capture('same-giver-after-new-quest');await command('/new');await sleep(1200);await capture('same-giver-after-native-new')
   row.givers=db!.query("select id from session_v2 where agent='quest-giver' and parent_id is null").all();row.ok=row.ok&&row.givers.length===1&&row.givers[0].id===report.giverSessionID
   report.runs.push(row);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({number,ok:row.ok,output:dir}));if(!row.ok)throw Error('Acceptance checks failed')
  }
  await command('/quests');await wait('board for composer',async()=>(await frame()).includes('Search quests'));await key('q','q');await wait('older Quest picker',async()=>(await frame()).includes('Select Quest'));await command('Installed single giver project 1');await wait('older Quest selected',async()=>(await frame()).split('\n').some(line=>line.indexOf('Installed single giver project 1')>35));await key('n','n');await wait('real nudge composer',async()=>(await frame()).includes('Nudge Quest Giver'));await command('Reply exactly NATIVE_BOARD_NUDGE_CONFIRMED. This is a composer/navigation check only; do not call tools, create Quests or dispatch.');
  await wait('real giver nudge response',()=>{const messages:any[]=db!.query('select type,data from session_message where session_id=? order by seq').all(report.giverSessionID).map((r:any)=>({type:r.type,...JSON.parse(r.data)}));const at=messages.findLastIndex(m=>m.type==='user'&&m.text?.includes('NATIVE_BOARD_NUDGE_CONFIRMED'));return at>=0&&messages.slice(at+1).some(m=>m.type==='assistant'&&m.time?.completed&&m.finish==='stop'&&m.content?.some((p:any)=>p.type==='text'&&p.text.includes('NATIVE_BOARD_NUDGE_CONFIRMED')))});await capture('giver-nudge-response');await command('/quest-back');await wait('nudge returns to older selected Quest',async()=>(await frame()).split('\n').some(line=>line.indexOf('Installed single giver project 1')>35));await capture('nudge-returned-to-selected');report.giverComposer=true;
 }catch(e){row.ok=false;row.error=String(e);await capture('failure')}
 finally{const pending=readAllQuests(store.projectRoot).flatMap(r=>r.quest?.sessions??[]).filter((r:any)=>!['completed','failed','cancelled'].includes(r.state));row.preservedActiveWorkers=pending.map((r:any)=>r.sessionID);if(!exited&&!pending.length){await key('escape','\x1b');await command('/exit');await sleep(1500)}db?.close();terminal.onData=undefined;terminal.destroy();setup.renderer.destroy();row.events=events;row.errors=errors;if(!report.runs.includes(row))report.runs.push(row);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2))}
 console.log(JSON.stringify({number:row.number,ok:row.ok,error:row.error,output:dir}))
}
report.ok=report.firstDiscussion&&report.giverComposer&&report.runs.length===2&&report.runs.every((r:any)=>r.ok);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));console.log(join(output,'report.json'));process.exitCode=report.ok?0:1
