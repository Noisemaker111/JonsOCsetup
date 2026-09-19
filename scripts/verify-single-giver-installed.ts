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
import {ACCOUNT_USAGE_FILE} from '../usage/account-api'
import {dispatchPlanInput} from '../models/dispatch-planner'
import {planRoutes} from '../models/route-planner'
import {automaticReturn,boardVisible,boundSessions,detailCompleted,detailRunning,detailSelected,latestBoundSession,latestRunSavedResult,nudgeComposerVisible,nudgeReply,pickerVisible,questSettled,runQuestPair,stepsVisible,transcriptVisible,workerTranscriptHeaderVisible} from './gate-decisions'
const root=resolve(process.argv[2]),reservations=resolve(process.argv[3]),output=process.argv[4]?resolve(process.argv[4]):join(root,'.visual-e2e','installed-single-giver-'+Date.now())
const policy=JSON.parse(readFileSync(join(root,'models/dispatch-policy.json'),'utf8'))
// An explicit verification choice uses normal admission; otherwise use automatic task policy.
const plan=await dispatchPlanInput({policyFile:join(root,'models/dispatch-policy.json'),task:'utility',model:process.env.OPENCODE_VERIFY_WORKER_MODEL})
const decision=planRoutes(plan)
const route=plan.routes.find(r=>r.id===decision.selected?.routeID)
if(!route)throw Error('No eligible verification route: '+JSON.stringify(decision.excluded))
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
 // Account observations stay real. Everything else is redirected so a check cannot touch live data,
 // but XDG_STATE_HOME is where ACCOUNT_USAGE_FILE lives (usage/account-api.ts:12), so redirecting it
 // left the host with an empty snapshot -- and the dispatch this gate exists to prove was refused
 // with "No evidenced, funded route meets the task constraints: account capacity is unknown". The
 // gate chooses its route from the real snapshot; handing the host a different one asks it to fund
 // a worker on evidence it was denied. What it writes back are true observations of real calls.
 const env={...process.env,OPENCODE_ACCOUNT_USAGE_FILE:ACCOUNT_USAGE_FILE,OPENCODE_CONFIG_DIR:root,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_RELEASE_CHANNEL:'dev',OPENCODE_DB:database,OPENCODE_QUEST_ROOT:store.projectRoot,OPENCODE_ROUTE_RESERVATIONS:reservations,OPENCODE_ORCHESTRATION_LEDGER:join(dir,'orchestration.jsonl'),OPENCODE_TELEMETRY_FILE:join(dir,'requests.jsonl'),XDG_STATE_HOME:join(dir,'state'),OPENCODE_DISABLE_AUTOUPDATE:'1',CLAUDE_CODE_BRIDGE_PORT:String(await freePort())}
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
  const strengthenProjectSelection=(text:string,directory?:string)=>directory?`${text} Before creating or dispatching any Quest, perform this exact structured check in Code Mode with no prose-only substitute: const requestedDirectory=${JSON.stringify(directory)}; const result=await tools.project_select({action:"select",selectors:[requestedDirectory]}); const normalizeWindows=(value)=>String(value??"").split(String.fromCharCode(92)).join("/").replace(/\\/+$/,'').toLowerCase(); const target=(Array.isArray(result?.targets)?result.targets:[]).find(candidate=>normalizeWindows(candidate?.directory??candidate?.root)===normalizeWindows(requestedDirectory)); if(!target) throw new Error("project_select target mismatch: requested="+requestedDirectory+" returnedTargets="+JSON.stringify((result?.targets??[]).map(candidate=>candidate?.directory??candidate?.root))); return {requestedDirectory,matchedDirectory:target.directory??target.root}; Continue to Quest creation only after this returned target directory matches. Do not compare JSON.stringify(result) with a slash path and do not create Quests after a mismatch.`:text
  async function command(text:string,directory?:string){const prompt=strengthenProjectSelection(text,directory);send(Buffer.from(terminal.encodePaste(new TextEncoder().encode(prompt))).toString());await sleep(1000);await frame();await capture('before-enter');await key('return','\r')}
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
    await command(`Select project ${directory.replaceAll('\\','/')} with project_select action select and selectors containing exactly that directory. Check the structured returned target.directory for that exact directory before creating work. Create two independent Quests titled Installed single giver project ${number} and Installed concurrent sibling ${number}. Give each Quest its own description, because two Quests must not state the same objective. For the first: Read only AGENTS.md in the assigned directory for the single giver check, save INSTALLED_QUEST_WORKER_VERIFIED plus the actual project number and one instruction in assigned step note with quest update.steps state done, then quest get to verify. For the second: Read only AGENTS.md in the assigned directory for the concurrent sibling check, save INSTALLED_QUEST_WORKER_VERIFIED plus the actual project number and one instruction in assigned step note with quest update.steps state done, then quest get to verify. Create one step id inspect, title Read AGENTS.md and save verified result. Run each newly created Quest exactly once immediately, without waiting for either worker to finish, with run {stepIDs:["inspect"],model:"${workerModel}",readOnly:true}. Create each Quest in a separate execute call so it has its own request identity. Use Code Mode Promise.all for the two independent run calls. Do not retry, substitute models, create another giver, or release account holds. Report the admission and finish without polling. When an automatic Quest worker update arrives, get the saved Quest, report its actual saved finding and outcome, and finish without dispatch.`,directory)
   await capture('submitted-request')
    let q:any
   /**
    * A title is not an identity. Asked for these two Quests, the giver made three: two both called
    * "Installed single giver project 1", 79 seconds apart, with different request fingerprints, so
    * the duplicate-admission guard never saw a duplicate. `find` took the first -- the empty one --
    * and the gate then waited forever for a worker that had bound to the other. Everything the gate
    * exists to prove had actually happened.
    *
    * So the Quest this run means is the one carrying a worker, and when several share the title the
    * newest wins: the giver's own correction of itself is the one it dispatched against.
    */
    const allQuests=()=>readAllQuests(store.projectRoot).flatMap(r=>r.quest?[r.quest]:[])
    let sibling:any
    // Giver binding, creation and both worker bindings are one observed outcome of one giver turn.
    // Read each source once per observation and choose bound duplicates from that same snapshot;
    // separate waits used to make a slow turn pay four serial timeout links for one fact.
    await wait('giver, Quests and workers bound',()=>{
     if(!existsSync(database))return false
     db??=new Database(database,{readonly:true})
     const file=join(store.runtime,"user-giver.json");if(!existsSync(file))return false
     const binding=JSON.parse(readFileSync(file,"utf8"));const givers:any[]=db.query("select id from session_v2 where agent='quest-giver' and parent_id is null order by time_created asc").all()
     if(binding.state!=="bound"||givers.length!==number||givers.at(-1)?.id!==binding.sessionID)return false
     report.giverSessionID=binding.sessionID;row.sessionID=binding.sessionID
     const pair=runQuestPair(allQuests(),`Installed single giver project ${number}`,`Installed concurrent sibling ${number}`)
     q=pair.primary;sibling=pair.sibling
     return pair.complete
    },MODEL_TURN)
   await command('/quests');await wait('live board',async()=>boardVisible(await frame()));{await key('q','q');await wait('Quest picker',async()=>pickerVisible(await frame()));await command(q.id);}await wait('selected assigned Quest',async()=>detailSelected(await frame(),q.title));await wait('confirmed running',async()=>detailRunning(await frame()));await capture('worker-running');const firstCheck=(await frame()).match(/Checked: ([^\n]+)/)?.[1];await sleep(4500);await capture('worker-activity-update');row.liveUpdates=firstCheck!==(await frame()).match(/Checked: ([^\n]+)/)?.[1]
   await key('n','n');await wait('native composer dialog',async()=>nudgeComposerVisible(await frame()));await capture('composer');await key('escape','\x1b');row.composer=true
   await wait('worker return, completion and settlement',async()=>{const all:any[]=db!.query('select type,data from session_message where session_id=? order by seq').all(row.sessionID);const messages=all.map(r=>({type:r.type,...JSON.parse(r.data)}));row.messages=messages.map(m=>({...m,content:m.content?.filter((p:any)=>p.type!=='reasoning')}));const saved=store.read(q.id),latest=latestBoundSession(saved);row.automaticReturn=automaticReturn(messages,q.title,{questID:q.id,runID:latest?.runID,marker:'INSTALLED_QUEST_WORKER_VERIFIED'}).received;const reservationsNow=JSON.parse(readFileSync(reservations,'utf8')).reservations;return row.automaticReturn&&detailCompleted(await frame())&&questSettled(saved,reservationsNow)&&questSettled(store.read(sibling.id),reservationsNow)},240000);await capture('completed-board');await key('escape','\x1b');await wait('giver response visible',async()=>!(await frame()).includes('Search quests'));await capture('automatic-worker-response');await command('/quests');await wait('board',async()=>boardVisible(await frame()));await key('q','q');await wait('exact worker Quest picker',async()=>pickerVisible(await frame()));await command(q.id);await wait('exact worker Quest selected',async()=>detailSelected(await frame(),q.title));await key('w','w');await wait('native worker transcript header',async()=>workerTranscriptHeaderVisible(await frame(),q.title));await capture('actual-worker-header');for(let i=0;i<8&&!(await frame()).includes('INSTALLED_QUEST_WORKER_VERIFIED');i++)await key('pageup','\x1b[5~');await wait('native worker transcript assignment',async()=>transcriptVisible(await frame(),q.title,'INSTALLED_QUEST_WORKER_VERIFIED'));await capture('actual-worker');await command('/quest-back');await wait('returned to Quest',async()=>stepsVisible(await frame(),q.title));await capture('returned-board')
   row.quest=new QuestStore(store.projectRoot).read(q.id);const run=latestBoundSession(row.quest);row.singleWorker=boundSessions(row.quest).length===1&&run?.state==='completed'&&!!run.sessionID;row.savedStep=latestRunSavedResult(row.quest,row.messages,'INSTALLED_QUEST_WORKER_VERIFIED');row.terminal=db!.query('select idle_outcome,model from session_v2 where id=?').get(run?.sessionID??'');row.workerMessages=db!.query('select type,data from session_message where session_id=? order by seq').all(run?.sessionID??'').map((r:any)=>({type:r.type,...JSON.parse(r.data)})).map((m:any)=>({...m,content:m.content?.filter((p:any)=>p.type!=='reasoning')}));const assistants=row.workerMessages.filter((m:any)=>m.type==='assistant');row.exactModel=assistants.length>0&&assistants.every((m:any)=>m.model?.providerID===route.providerID&&m.model?.id===route.modelID&&m.model?.variant===route.reasoning);row.reservation=JSON.parse(readFileSync(reservations,'utf8')).reservations.find((r:any)=>r.runID===run?.runID);row.workerProject=row.quest.project;row.correctProject=row.quest.project.id===expectedProject.id&&row.quest.integrationOwner===report.giverSessionID;row.ok=row.correctProject&&row.liveUpdates&&row.composer&&row.automaticReturn&&row.singleWorker&&row.savedStep&&row.exactModel&&row.terminal?.idle_outcome==='succeeded'&&row.reservation?.state==='settled'
    row.sibling=new QuestStore(store.projectRoot).read(sibling.id)
    const siblingRun=latestBoundSession(row.sibling),siblingReservation=JSON.parse(readFileSync(reservations,'utf8')).reservations.find((r:any)=>r.runID===siblingRun?.runID)
   const siblingAssistant:any[]=db!.query("select data from session_message where session_id=? and type='assistant' order by seq").all(siblingRun.sessionID).map((r:any)=>JSON.parse(r.data))
   row.concurrent={reservation:siblingReservation,overlap:Math.max(Date.parse(row.reservation.startedAt),Date.parse(siblingReservation.startedAt))<Math.min(Date.parse(row.reservation.completedAt),Date.parse(siblingReservation.completedAt)),exactModel:siblingAssistant.length>0&&siblingAssistant.every(m=>m.model?.providerID===route.providerID&&m.model?.id===route.modelID&&m.model?.variant===route.reasoning),terminal:db!.query('select idle_outcome from session_v2 where id=?').get(siblingRun.sessionID)}
    row.ok=row.ok&&row.concurrent.overlap&&row.concurrent.exactModel&&row.concurrent.terminal?.idle_outcome==='succeeded'&&boundSessions(row.sibling).length===1&&row.sibling.stages[0].status==='done'&&row.sibling.stages[0].note?.includes('INSTALLED_QUEST_WORKER_VERIFIED')&&row.sibling.integrationOwner===report.giverSessionID
   await key('escape','\x1b');await command('/quest-new');await sleep(1200);await capture('same-giver-after-new-quest');await command('/new');await sleep(1200);await capture('native-new-home')
   // /new deliberately opens a fresh conversation on the next prompt. Each cycle
   // verifies the currently bound giver; previous conversations remain history.
   row.givers=db!.query("select id from session_v2 where agent='quest-giver' and parent_id is null").all();row.ok=row.ok&&row.givers.length===number&&row.givers.some((g:any)=>g.id===report.giverSessionID)
   report.runs.push(row);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({number,ok:row.ok,output:dir}));if(!row.ok)throw Error('Acceptance checks failed')
  }
   await command('/quests');await wait('board for composer',async()=>boardVisible(await frame()));await key('q','q');await wait('older Quest picker',async()=>pickerVisible(await frame()));await command(report.runs[0].quest.id);await wait('older Quest selected',async()=>detailSelected(await frame(),'Installed single giver project 1'));await key('n','n');await wait('real nudge composer',async()=>nudgeComposerVisible(await frame()));await command('Reply exactly NATIVE_BOARD_NUDGE_CONFIRMED. This is a composer/navigation check only; do not call tools, create Quests or dispatch.');
   await wait('real giver nudge response',()=>{const messages:any[]=db!.query('select type,data from session_message where session_id=? order by seq').all(report.giverSessionID).map((r:any)=>({type:r.type,...JSON.parse(r.data)}));return nudgeReply(messages,'NATIVE_BOARD_NUDGE_CONFIRMED')});await capture('giver-nudge-response');await command('/quest-back');await wait('nudge returns to older selected Quest',async()=>detailSelected(await frame(),'Installed single giver project 1'));await capture('nudge-returned-to-selected');report.giverComposer=true;
 }catch(e){row.ok=false;row.error=String(e);await capture('failure')}
 finally{const pending=readAllQuests(store.projectRoot).flatMap(r=>r.quest?.sessions??[]).filter((r:any)=>!['completed','failed','cancelled'].includes(r.state));row.preservedActiveWorkers=pending.map((r:any)=>r.sessionID);if(!exited&&!pending.length){await key('escape','\x1b');await command('/exit');await sleep(1500)}db?.close();terminal.onData=undefined;terminal.destroy();setup.renderer.destroy();row.events=events;row.errors=errors;if(!report.runs.includes(row))report.runs.push(row);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2))}
 console.log(JSON.stringify({number:row.number,ok:row.ok,error:row.error,output:dir}))
}
report.ok=report.firstDiscussion&&report.giverComposer&&report.runs.length===2&&report.runs.every((r:any)=>r.ok);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));console.log(join(output,'report.json'));process.exitCode=report.ok?0:1
