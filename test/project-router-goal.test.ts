import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QuestStore } from '../quest/store'
import { questsAPI, QuestError } from '../quest/api'
import { QuestContinuation } from '../quest/continuation'
import { QuestTracker } from '../quest/tracker'
import { retainGoalTerminal, finishGoalTerminal, consumeGoalTerminal } from '../quest/goal-lifecycle'
import {typedQuestTool} from '../quest/typed-tool'
import {projectIdentity} from '../quest/project'
import {runKnownCommand} from '../quest/command-runtime'
import {createGoalFacade} from '../quest/goal-public'
const model='openai/gpt-6-astra#medium'
const route={routeID:'astra',accountID:'selected',providerID:'openai',modelID:'gpt-6-astra',reasoning:'medium',serviceTier:'default'}
test('assigned verification returns inspectable output and exit facts without external file reads',async()=>{
 const f=fixture(),oldRoot=process.env.OPENCODE_QUEST_ROOT,oldPolicy=process.env.OPENCODE_DISPATCH_POLICY
 process.env.OPENCODE_QUEST_ROOT=f.root;process.env.OPENCODE_DISPATCH_POLICY=join(f.root,'policy.json')
 writeFileSync(process.env.OPENCODE_DISPATCH_POLICY,JSON.stringify({version:1,commandsByProject:{[f.context.project.id]:{check:{argv:[process.execPath,'-e',"console.log('GOAL_VERIFIED');console.error('check detail token=fixture-private-secret')"],timeoutMilliseconds:5000,description:'fixture'}}}}))
 let directory=f.root
 const facade=createGoalFacade({get:async()=>({location:{directory}})} as any)
 try{await facade.verify({questID:f.q.id,stepID:'a',commandID:'check',action:'bind'},f.context)
 const result=await facade.verify({questID:f.q.id,stepID:'a',commandID:'check'},f.context) as any
 expect(result.output).toContain('GOAL_VERIFIED');expect(result.output).toContain('check detail');expect(result.exitCode).toBe(0);expect(result.timedOut).toBe(false);expect(result.outputTruncated).toBe(false)
 expect(result.output).toContain('[REDACTED]');expect(result.output).not.toContain('fixture-private-secret');expect(readFileSync(result.log,'utf8')).toContain('token=fixture-private-secret');expect(f.store.read(f.q.id)!.stages[0].proofs[0].verified).toBe(true)
 await expect(facade.verify({questID:f.q.id,stepID:'b',commandID:'check'},f.context)).rejects.toThrow('giver must')
 directory=tmpdir();await expect(facade.verify({questID:f.q.id,stepID:'a',commandID:'check'},f.context)).rejects.toThrow('owning destination')
 }finally{facade.dispose();if(oldRoot===undefined)delete process.env.OPENCODE_QUEST_ROOT;else process.env.OPENCODE_QUEST_ROOT=oldRoot;if(oldPolicy===undefined)delete process.env.OPENCODE_DISPATCH_POLICY;else process.env.OPENCODE_DISPATCH_POLICY=oldPolicy;f.clean()}
})
test('command evidence bounds returned head/tail, retains durable log and failed exit',async()=>{
 const root=mkdtempSync(join(tmpdir(),'goal-output-'));try{const result=await runKnownCommand({argv:[process.execPath,'-e',"process.stdout.write('BEGIN'+ 'x'.repeat(40000)+'END');process.exitCode=7"],description:'bounded failure',timeoutMilliseconds:5000},root,join(root,'check.log'))
 expect(result.exitCode).toBe(7);expect(result.outputTruncated).toBe(true);expect(result.output.startsWith('BEGIN')).toBe(true);expect(result.output.endsWith('END')).toBe(true);expect(result.output.length).toBeLessThan(16500);expect(readFileSync(result.logFile,'utf8').length).toBe(40008);expect(result.truncated).toBe(false)
 }finally{rmSync(root,{recursive:true,force:true})}
})
function fixture(){const root=mkdtempSync(join(tmpdir(),'router-goal-'));if(Bun.spawnSync(['git','init',root],{windowsHide:true}).exitCode!==0)throw new Error('Goal Git fixture failed');const store=new QuestStore(root),context={project:projectIdentity(root),directory:root,sessionID:'giver',requestID:'one'},api=questsAPI(store,context,async()=>({sessionID:'worker'})),q=api.create({title:'Goal',description:'Only these steps',steps:[{id:'a',title:'First'},{id:'b',title:'Second',needs:['a']}]});return {root,store,context,q,api,clean:()=>rmSync(root,{recursive:true,force:true})}}
test('giver goal holds do not retry, restart stays paused, explicit resume is a live trigger',async()=>{
 const f=fixture();try{let launches=0;const start:any=async()=>{launches++;throw new QuestError('ROUTE_UNAVAILABLE','Uncalibrated worker hold: other')},options:any={goalMode:true,refresh:async()=>({accounts:[]})},a=new QuestContinuation(f.store,start,options)
 await a.run(f.q.id,{model,stepIDs:['a']},f.context);await a.tick();expect(launches).toBe(1);expect(a.status(f.q.id)[0].state).toBe('stopped')
 const b=new QuestContinuation(f.store,start,options);await b.tick();expect(launches).toBe(1);expect(b.goalStatus('giver')[0].resumeRequired).toBe(true)
 await b.resumeGoal({...f.context,requestID:'resume'});expect(launches).toBe(2)
 }finally{f.clean()}
})
test('worker successful events continue same session once, retain tracker ownership, pause then finalize',async()=>{
 const f=fixture();try{
 f.store.apply(f.q.id,'session-planned',{callID:'run',runID:'run',deliverables:['a','b']},'test');f.store.apply(f.q.id,'session-claimed',{callID:'run',sessionID:'ses_worker'},'test')
 const context={...f.context,sessionID:'ses_worker'},tracker=new QuestTracker(f.store);let prompts=0
 const goal=new QuestContinuation(f.store,async()=>{throw new Error('worker dispatch forbidden')},{goalMode:true,refresh:async()=>({accounts:[{id:'selected',state:'available',freshness:{stale:false}},{id:'other',state:'exhausted',freshness:{stale:false}}]} as any),workerPrompt:async()=>{prompts++}})
 goal.startWorkerGoal(f.q.id,['a','b'],context,model,route);retainGoalTerminal(f.store.runtime,'ses_worker')
 const event={id:'event-one',type:'session.execution.succeeded',properties:{sessionID:'ses_worker'}}
 expect(tracker.onHostEvent(event)).toBeUndefined();expect(f.store.read(f.q.id)!.sessions[0].state).toBe('executing')
 await goal.workerEvent('ses_worker','event-one',true);await goal.workerEvent('ses_worker','event-one',true);expect(prompts).toBe(1);consumeGoalTerminal(f.store.runtime,'ses_worker')
 tracker.onHostEvent({...event,id:'event-two'});goal.pauseGoal(context);finishGoalTerminal(f.store.runtime,'ses_worker')
 expect(f.store.read(f.q.id)!.sessions[0].state).toBe('completed');await goal.workerEvent('ses_worker','event-two',true);expect(prompts).toBe(1)
 }finally{f.clean()}
})
test('worker goal requires current assignments and actual passing proofs; turn success alone is not completion',async()=>{
 const f=fixture();try{
 f.store.apply(f.q.id,'session-planned',{callID:'run',runID:'run',deliverables:['a']},'test');f.store.apply(f.q.id,'session-claimed',{callID:'run',sessionID:'worker'},'test')
 const context={...f.context,sessionID:'worker'},goal=new QuestContinuation(f.store,async()=>{throw new Error('no dispatch')},{goalMode:true,refresh:async()=>({accounts:[]} as any),workerPrompt:async()=>{}})
 expect(()=>goal.startWorkerGoal(f.q.id,['b'],context,model)).toThrow('current active assigned')
 f.store.apply(f.q.id,'patched',{extensions:{routerVerification:{a:'fixture'}}},'test')
 goal.startWorkerGoal(f.q.id,['a'],context,model);f.api.update(f.q.id,{steps:[{id:'a',state:'done',note:'I claim success'}]});await goal.workerEvent('worker','done',true)
 expect(goal.goalStatus('worker')[0].state).toBe('stopped');expect(goal.goalStatus('worker')[0].reason).toContain('verified passing proof')
 f.store.apply(f.q.id,'proof-added',{stageID:'a',proof:{id:'real-check',kind:'command',at:new Date().toISOString(),attempt:0,result:'passed',verified:true,command:'fixture'}},'test')
 f.store.apply(f.q.id,'patched',{extensions:{routerVerification:{a:'fixture'}}},'test')
 await goal.resumeGoal({...context,requestID:'verified-resume'});expect(goal.goalStatus('worker')[0].state).toBe('done')
 }finally{f.clean()}
})
test('missing selected account stops; explicit budget resume creates one new bounded epoch',async()=>{
 const f=fixture();try{f.store.apply(f.q.id,'session-planned',{callID:'run',runID:'run',deliverables:['a']},'test');f.store.apply(f.q.id,'session-claimed',{callID:'run',sessionID:'worker'},'test');let prompts=0,available=false
 const context={...f.context,sessionID:'worker'},goal=new QuestContinuation(f.store,async()=>{throw new Error('no dispatch')},{goalMode:true,refresh:async()=>({accounts:available?[{id:'selected',state:'available',freshness:{stale:false}}]:[{id:'other',state:'available',freshness:{stale:false}}]} as any),workerPrompt:async()=>{prompts++}})
 goal.startWorkerGoal(f.q.id,['a'],context,'route:astra',route);await goal.workerEvent('worker','missing-account',true);expect(prompts).toBe(0);expect(goal.goalStatus('worker')[0].reason).toContain('exact reserved account')
 available=true;await goal.resumeGoal({...context,requestID:'resume-account'});for(let i=0;i<4;i++)await goal.workerEvent('worker','event-'+i,true);expect(prompts).toBe(3);expect(goal.goalStatus('worker')[0].state).toBe('stopped')
 await goal.resumeGoal({...context,requestID:'new-budget'});expect(prompts).toBe(4);expect(goal.goalStatus('worker')[0].epoch).toBe(2)
 }finally{f.clean()}
})
test('typed worker updates enforce latest active assignment and bounded result-only scope',async()=>{
 const root=mkdtempSync(join(tmpdir(),'router-assignment-'));try{const store=new QuestStore(root),project=projectIdentity(root),api=questsAPI(store,{project,sessionID:'giver',requestID:'create'},async()=>({sessionID:'none'})),q=api.create({title:'Assignment',description:'Current owner only',steps:[{id:'a',title:'A'},{id:'b',title:'B'}]})
 for(const [callID,sessionID] of [['old','ses_old'],['new','ses_new']]){store.apply(q.id,'session-planned',{callID,runID:callID,deliverables:['a']},'test');store.apply(q.id,'session-claimed',{callID,sessionID},'test');if(callID==='old')store.apply(q.id,'session-state',{callID,state:'completed'},'test')}
 const tool=typedQuestTool(store,{get:async()=>({location:{directory:root}}),create:async()=>{},prompt:async()=>{}},{startRun:async()=>({sessionID:'none'})})
 await expect(tool.execute({action:'update',id:q.id,update:{steps:[{id:'a',state:'done',note:'stale'}]}},{sessionID:'ses_old',id:'old-write'})).rejects.toThrow('current assigned')
 await expect(tool.execute({action:'update',id:q.id,update:{steps:[{id:'b',state:'done'}]}},{sessionID:'ses_new',id:'other-step'})).rejects.toThrow('current assigned')
 await expect(tool.execute({action:'update',id:q.id,update:{reward:'global mutation'}},{sessionID:'ses_new',id:'reward'})).rejects.toThrow('current assigned')
 const result=await tool.execute({action:'update',id:q.id,update:{steps:[{id:'a',state:'working',note:'Actual assigned check in progress'}]}},{sessionID:'ses_new',id:'allowed'})
 expect(result.output.steps.find((s:any)=>s.id==='a').state).toBe('working');expect(store.read(q.id)!.stages.find(s=>s.id==='b')!.status).toBe('pending')
 }finally{rmSync(root,{recursive:true,force:true})}
})
