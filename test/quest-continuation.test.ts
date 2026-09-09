import { expect,test } from 'bun:test'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestStore } from '../quest/store'
import { QuestContinuation } from '../quest/continuation'
import { questsAPI,QuestError } from '../quest/api'
const model='openai/gpt-6-astra#medium'
function fixture(){const root=mkdtempSync(join(tmpdir(),'quest-continuation-')),store=new QuestStore(root),context={project:{id:'project',root},sessionID:'giver',requestID:'intent'};let launches=0,refreshes=0;const start:any=async(i:any)=>{launches++;expect(i.model).toBe(model);store.apply(i.quest.id,'session-claimed',{callID:i.runID,runID:i.runID,sessionID:'worker'+launches},'test');return {sessionID:'worker'+launches}};const q=questsAPI(store,context,start).create({title:'Authorized work',description:'Preserve intent',steps:[{id:'a',title:'First'},{id:'b',title:'Second',needs:['a']}]});const options:any={refresh:async()=>{refreshes++;return {accounts:[]}}};return {root,store,context,start,q,options,counts:()=>({launches,refreshes}),clean:()=>rmSync(root,{recursive:true,force:true})}}
test('terminal outcome and actual step result continue once across competing givers',async()=>{const f=fixture();try{const a=new QuestContinuation(f.store,f.start,f.options),b=new QuestContinuation(f.store,f.start,f.options);await a.run(f.q.id,{model},f.context);expect(f.counts().launches).toBe(1);await Promise.all([a.tick(),b.tick()]);expect(f.counts().launches).toBe(1);const run=f.store.read(f.q.id)!.sessions[0];f.store.apply(f.q.id,'stage-state',{stageID:'a',status:'done',evidence:'actual check passed'},'test');f.store.apply(f.q.id,'session-state',{callID:run.callID,state:'completed'},'test');await Promise.all([a.tick(),b.tick(),a.tick()]);expect(f.counts()).toEqual({launches:2,refreshes:2});await Promise.all([a.tick(),b.tick()]);expect(f.counts().launches).toBe(2)}finally{f.clean()}})
test('normal session ending with blocked task stops continuation',async()=>{const f=fixture();try{const a=new QuestContinuation(f.store,f.start,f.options);await a.run(f.q.id,{model},f.context);const run=f.store.read(f.q.id)!.sessions[0];f.store.apply(f.q.id,'stage-state',{stageID:'a',status:'blocked',evidence:'missing shell'},'test');f.store.apply(f.q.id,'session-state',{callID:run.callID,state:'completed'},'test');await a.tick();expect(a.status(f.q.id)[0].state).toBe('stopped');expect(f.counts().launches).toBe(1)}finally{f.clean()}})
test('cancellation during refresh prevents launch',async()=>{const f=fixture();try{let release:any;const a=new QuestContinuation(f.store,f.start,{refresh:()=>new Promise(r=>release=r) as any});const pending=a.run(f.q.id,{model},f.context);await Promise.resolve();a.cancel(f.q.id,f.context);release({accounts:[]});await pending;expect(f.counts().launches).toBe(0)}finally{f.clean()}})
test('unknown launch is never retried; exact model is mandatory',async()=>{const f=fixture();try{let attempts=0;const a=new QuestContinuation(f.store,async()=>{attempts++;throw new Error('lost launch response')},f.options);await expect(a.run(f.q.id,{},f.context)).rejects.toThrow('explicit model');await a.run(f.q.id,{model},f.context);await a.tick();expect(attempts).toBe(1);expect(a.status(f.q.id)[0].state).toBe('stopped');expect(f.store.read(f.q.id)!.sessions[0].state).toBe('planned')}finally{f.clean()}})
test('hold retries are bounded and preserve model; other failures stop',async()=>{const f=fixture();try{let now=0,attempts=0;const a=new QuestContinuation(f.store,async i=>{expect(i.model).toBe(model);attempts++;throw new QuestError('ROUTE_UNAVAILABLE','Uncalibrated worker hold: old; await terminal and fresh quota')},{...f.options,now:()=>now});await a.run(f.q.id,{model},f.context);for(let n=0;n<5;n++){now+=10001;await a.tick()}expect(attempts).toBe(3);expect(a.status(f.q.id)[0].state).toBe('stopped')}finally{f.clean()}})
import { RouteReservations } from '../models/route-reservations'
import routing from './fixtures/routing-19h.json'
test('held follow-up waits for real terminal settlement then a newer observation, even across givers',async()=>{const f=fixture();try{let now=Date.parse(routing.request.now),fresh=false;const input=structuredClone(routing) as any,route=input.routes[0],account=input.accounts.find((a:any)=>a.id===route.accountID);input.request.allowedRouteIDs=[route.id];input.request.explicitRouteID=route.id;input.request.reserveFraction=0;route.admission='configured-choice';route.quotaPerTask={};const ledger=new RouteReservations(join(f.store.runtime,'route-reservations.json'));expect(ledger.reserve('blocker',input).reservation).not.toBeNull();const other=questsAPI(f.store,{...f.context,requestID:'other'},f.start).create({title:'Other authorized Quest',description:'Account worker',steps:[{id:'other',title:'Existing worker'}]});f.store.apply(other.id,'session-planned',{callID:'blocker',runID:'blocker',deliverables:['other']},'test');f.store.apply(other.id,'session-claimed',{callID:'blocker',sessionID:'blocker-session'},'test');let launches=0,refreshes=0;const start:any=async(i:any)=>{expect(i.model).toBe(model);const result=ledger.reserve(i.runID,input);if(!result.reservation)throw new QuestError('ROUTE_UNAVAILABLE',result.decision.excluded.map((x:any)=>x.reasons.join(';')).join(';'));launches++;return {sessionID:'actual-next'}};const options:any={now:()=>now,refresh:async()=>{refreshes++;if(fresh){account.observedAt=new Date(Date.now()+1000).toISOString();input.request.now=account.observedAt;for(const w of account.windows)w.resetAt=new Date(Date.now()+3600000).toISOString();}return {accounts:[]}}};const a=new QuestContinuation(f.store,start,options),b=new QuestContinuation(f.store,start,options);await a.run(f.q.id,{model,stepIDs:['a']},f.context);expect(launches).toBe(0);for(let n=0;n<8;n++){now+=10001;await Promise.all([a.tick(),b.tick()])}expect(refreshes).toBe(1);f.store.apply(other.id,'session-state',{callID:'blocker',state:'completed'},'host:execution');now+=10001;await a.tick();expect(ledger.get('blocker')?.state).toBe('settled');expect(launches).toBe(0);fresh=true;now+=10001;await Promise.all([a.tick(),b.tick(),a.tick()]);expect(launches).toBe(1);expect(refreshes).toBe(3)}finally{f.clean()}})
test('competing giver registrations cannot replace model or duplicate work',async()=>{const f=fixture();try{const a=new QuestContinuation(f.store,f.start,f.options),b=new QuestContinuation(f.store,f.start,f.options);const results=await Promise.allSettled([a.run(f.q.id,{model},f.context),b.run(f.q.id,{model:'other/model'}, {...f.context,sessionID:'other-giver'})]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(f.counts().launches).toBe(1);expect(a.status(f.q.id)).toHaveLength(1)}finally{f.clean()}})
test('changed authorization and archived Quests stop before dispatch',async()=>{const f=fixture();try{const a=new QuestContinuation(f.store,f.start,f.options);await a.run(f.q.id,{model},f.context);const run=f.store.read(f.q.id)!.sessions[0];f.store.apply(f.q.id,'stage-state',{stageID:'a',status:'done'},'test');f.store.apply(f.q.id,'session-state',{callID:run.callID,state:'completed'},'test');questsAPI(f.store,f.context,f.start).update(f.q.id,{description:'New scope requires new authorization'});await a.tick();expect(a.status(f.q.id)[0].state).toBe('stopped');expect(f.counts().launches).toBe(1)}finally{f.clean()}})

test('explicit continuation waits through pacing holds and stops permanently at the target deadline',async()=>{const f=fixture();try{let now=0,attempts=0,expired=false;const a=new QuestContinuation(f.store,async()=>{attempts++;throw new QuestError('ROUTE_UNAVAILABLE',expired?'Burn pacing stopped: Target deadline reached':'Burn pacing hold: Desired concurrency reached')},{...f.options,now:()=>now});await a.run(f.q.id,{model},f.context);for(let n=0;n<5;n++){now+=30001;await a.tick()}expect(attempts).toBe(6);expect(a.status(f.q.id)[0].state).toBe('waiting');expired=true;now+=30001;await a.tick();expect(a.status(f.q.id)[0].state).toBe('stopped');now+=30001;await a.tick();expect(attempts).toBe(7)}finally{f.clean()}})

test('a restarted continuation preserves research mode for subsequent steps',async()=>{
 const f=fixture();try{
  const modes:boolean[]=[];const start:any=async(input:any)=>{modes.push(input.readOnly);return f.start(input)}
  const first=new QuestContinuation(f.store,start,f.options);await first.run(f.q.id,{readOnly:true,model},f.context)
  const run=f.store.read(f.q.id)!.sessions[0];f.store.apply(f.q.id,'stage-state',{stageID:'a',status:'done'},'fixture');f.store.apply(f.q.id,'session-state',{callID:run.callID,state:'completed'},'fixture')
  const restarted=new QuestContinuation(f.store,start,f.options);await restarted.tick()
  expect(modes).toEqual([true,true])
  await expect(restarted.run(f.q.id,{readOnly:false,model},f.context)).rejects.toThrow('different work')
 }finally{f.clean()}
})
test('legacy and different dev generations cannot claim another generation queue',async()=>{
 const f=fixture();try{
  let legacyLaunches=0,otherLaunches=0
  const current=new QuestContinuation(f.store,f.start,{...f.options,runtimeGeneration:'gen-current'})
  const legacy=new QuestContinuation(f.store,async()=>{legacyLaunches++;throw Error('Old host claimed new work')},{...f.options,runtimeGeneration:''})
  const other=new QuestContinuation(f.store,async()=>{otherLaunches++;throw Error('Different generation claimed work')},{...f.options,runtimeGeneration:'gen-other'})
  await current.run(f.q.id,{model,maxConcurrent:1},f.context)
  const first=f.store.read(f.q.id)!.sessions[0];f.store.apply(f.q.id,'stage-state',{stageID:'a',status:'done'},'test');f.store.apply(f.q.id,'session-state',{callID:first.callID,state:'completed'},'test')
  await Promise.all([legacy.tick(),other.tick()]);expect(legacyLaunches+otherLaunches).toBe(0);expect(f.counts().launches).toBe(1)
  const resumed=new QuestContinuation(f.store,f.start,{...f.options,runtimeGeneration:'gen-current'});await Promise.all([current.tick(),resumed.tick()]);expect(f.counts().launches).toBe(2)
  expect(legacy.status(f.q.id)).toHaveLength(1)
 }finally{f.clean()}
})

test('foreign continuation blocks replacement until explicit cancellation, preserving live workers',async()=>{
 const f=fixture();try{
  const legacy=new QuestContinuation(f.store,f.start,{...f.options,runtimeGeneration:''}),current=new QuestContinuation(f.store,f.start,{...f.options,runtimeGeneration:'gen-current'})
  await legacy.run(f.q.id,{model,maxConcurrent:1},f.context)
  await expect(current.run(f.q.id,{model,stepIDs:['b'],maxConcurrent:1},{...f.context,requestID:'new'})).rejects.toThrow('existing continuation')
  expect(current.status(f.q.id)).toHaveLength(1)
  current.cancel(f.q.id,f.context);expect(legacy.status(f.q.id)[0].state).toBe('stopped')
  expect(f.store.read(f.q.id)!.sessions[0].state).toBe('executing')
  await Promise.all([legacy.tick(),current.tick()]);expect(f.counts().launches).toBe(1)
 }finally{f.clean()}
})
