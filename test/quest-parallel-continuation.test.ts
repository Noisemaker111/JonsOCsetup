import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestStore } from '../quest/store'
import { QuestContinuation } from '../quest/continuation'
import { questsAPI, QuestError } from '../quest/api'
const model='openai/gpt-6-astra#medium'
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'quest-parallel-')),store=new QuestStore(root),context={project:{id:'project',root},sessionID:'giver',requestID:'parallel'}
 const launches:any[]=[]
 const start:any=async(i:any)=>{launches.push(i);store.apply(i.quest.id,'session-claimed',{callID:i.runID,runID:i.runID,sessionID:'worker'+launches.length},'test');return {sessionID:'worker'+launches.length}}
 const q=questsAPI(store,context,start).create({title:'Independent work then integration',description:'Verified combined result',steps:[{id:'a',title:'First worker'},{id:'b',title:'Second worker'},{id:'integrate',title:'Integrate accepted results',needs:['a','b']}]})
 const options:any={refresh:async()=>({accounts:[]})}
 const complete=(id:string,terminal=true)=>{store.apply(q.id,'stage-state',{stageID:id,status:'done',evidence:'Verified result'},'test');if(terminal){const run=store.read(q.id)!.sessions.find(s=>s.deliverables.includes(id))!;store.apply(q.id,'session-state',{callID:run.callID,state:'completed'},'test')}}
 return {root,store,context,start,q,options,launches,complete,clean:()=>rmSync(root,{recursive:true,force:true})}
}
test('independent steps launch once across concurrent ticks and reload; integration requires both terminal outcomes',async()=>{
 const f=fixture();try{
  const a=new QuestContinuation(f.store,f.start,f.options),b=new QuestContinuation(f.store,f.start,f.options)
  await a.run(f.q.id,{model,maxConcurrent:2,stepModels:{b:'other/model#high'}},f.context)
  expect(f.launches.map(x=>x.stepIDs)).toEqual([['a'],['b']]);expect(f.launches[1].model).toBe('other/model#high')
  const admissions=a.status(f.q.id)[0].admissions!
  await Promise.all([a.tick(),b.tick(),a.tick()]);expect(f.launches).toHaveLength(2)
  f.complete('a');f.complete('b',false)
  await b.tick();expect(f.launches).toHaveLength(2)
  f.complete('b');await Promise.all([a.tick(),b.tick(),a.tick()]);expect(f.launches).toHaveLength(3)
  expect(f.launches[2].stepIDs).toEqual(['integrate']);expect(b.status(f.q.id)[0].admissions!.slice(0,2).map(x=>x.requestID)).toEqual(admissions.map(x=>x.requestID))
  f.complete('integrate');await b.tick();expect(a.status(f.q.id)[0].state).toBe('done')
 }finally{f.clean()}
})
test('concurrent refresh claims consume capacity and cancellation wins before launches',async()=>{
 const f=fixture();try{
  const releases:Array<(x:any)=>void>=[]
  const options:any={refresh:()=>new Promise(r=>releases.push(r))}
  const a=new QuestContinuation(f.store,f.start,options),b=new QuestContinuation(f.store,f.start,options)
  const pending=a.run(f.q.id,{model,maxConcurrent:2},f.context);await Promise.resolve();await Promise.resolve()
  const other=b.tick();await Promise.resolve();await Promise.resolve()
  expect(releases).toHaveLength(2);expect(a.status(f.q.id)[0].admitted).toBe(2)
  await new QuestContinuation(f.store,f.start,f.options).tick();expect(f.launches).toHaveLength(0)
  a.cancel(f.q.id,f.context);for(const release of releases)release({accounts:[]});await Promise.all([pending,other])
  expect(f.launches).toHaveLength(0);expect(a.status(f.q.id)[0].state).toBe('stopped')
 }finally{f.clean()}
})
test('one account hold preserves successful sibling and retries only its own known failed admission',async()=>{
 const f=fixture();try{
  let now=0,held=true;const attempts:any[]=[]
  const start:any=async(i:any)=>{attempts.push(i);if(i.stepIDs[0]==='a'&&held)throw new QuestError('ROUTE_UNAVAILABLE','Burn pacing hold: Desired concurrency reached');return f.start(i)}
  const a=new QuestContinuation(f.store,start,{...f.options,now:()=>now})
  await a.run(f.q.id,{model,maxConcurrent:2},f.context)
  expect(f.launches.map(x=>x.stepIDs[0])).toEqual(['b']);expect(a.status(f.q.id)[0].waiting).toBe(2)
  held=false;now=30001;await new QuestContinuation(f.store,start,{...f.options,now:()=>now}).tick()
  expect(f.launches.map(x=>x.stepIDs[0])).toEqual(['b','a']);expect(attempts.filter(x=>x.stepIDs[0]==='b')).toHaveLength(1)
  expect(attempts[0].runID).not.toBe(attempts[2].runID)
 }finally{f.clean()}
})
test('unknown launch survives reload without retry and does not block unrelated available capacity',async()=>{
 const f=fixture();try{
  let attempts=0;const start:any=async(i:any)=>{attempts++;if(i.stepIDs[0]==='a')throw new Error('lost response');return f.start(i)}
  const a=new QuestContinuation(f.store,start,f.options);await a.run(f.q.id,{model,maxConcurrent:2},f.context)
  await Promise.all([a.tick(),new QuestContinuation(f.store,start,f.options).tick()])
  expect(attempts).toBe(2);expect(a.status(f.q.id)[0].admissions![0].state).toBe('unknown');expect(f.launches[0].stepIDs).toEqual(['b'])
  f.complete('b');await a.tick();expect(attempts).toBe(2)
 }finally{f.clean()}
})
test('authorization change during refresh prevents admission and validates concurrency and per-step model keys',async()=>{
 const f=fixture();try{
  const a=new QuestContinuation(f.store,f.start,f.options)
  await expect(a.run(f.q.id,{model,maxConcurrent:17},f.context)).rejects.toThrow('1 to 16')
  await expect(a.run(f.q.id,{model,stepModels:{unknown:model}},f.context)).rejects.toThrow('authorized step IDs')
  const b=new QuestContinuation(f.store,f.start,{refresh:async()=>{questsAPI(f.store,f.context,f.start).update(f.q.id,{description:'Changed scope'});return {accounts:[]} as any}})
  await b.run(f.q.id,{model,maxConcurrent:2},f.context);expect(f.launches).toHaveLength(0);expect(b.status(f.q.id)[0].state).toBe('stopped')
 }finally{f.clean()}
})

test('failed sibling remains explicit while successful active sibling keeps its run',async()=>{
 const f=fixture();try{
  const a=new QuestContinuation(f.store,f.start,f.options);await a.run(f.q.id,{model,maxConcurrent:2},f.context)
  const failed=f.store.read(f.q.id)!.sessions.find(s=>s.deliverables.includes('a'))!
  f.store.apply(f.q.id,'session-state',{callID:failed.callID,state:'failed',result:'Verification failed'},'test')
  await a.tick();expect(a.status(f.q.id)[0].admissions!.map(x=>x.state)).toEqual(['stopped','running']);expect(a.status(f.q.id)[0].state).toBe('running')
  f.complete('b');await a.tick();expect(f.launches).toHaveLength(2);expect(a.status(f.q.id)[0].state).toBe('stopped')
 }finally{f.clean()}
})

test('same request replays after steps begin and conflicting authorization is rejected',async()=>{
 const f=fixture();try{
  const a=new QuestContinuation(f.store,f.start,f.options),input={model,maxConcurrent:2,stepIDs:['a','b'],stepModels:{b:'other/model'}}
  const first=await a.run(f.q.id,input,f.context)
  const replay=await new QuestContinuation(f.store,f.start,f.options).run(f.q.id,input,f.context)
  expect(replay.continuation!.id).toBe(first.continuation!.id);expect(f.launches).toHaveLength(2)
  for(const change of [{model:'other/model'},{files:['src']},{stepIDs:['a']},{maxConcurrent:3},{stepModels:{b:'different/model'}}])await expect(a.run(f.q.id,{...input,...change},f.context)).rejects.toThrow('different work')
  expect(f.launches).toHaveLength(2)
 }finally{f.clean()}
})
