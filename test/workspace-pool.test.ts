import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {QuestWorkspaces} from '../quest/workspaces'
import {acquireLock} from '../quest/locking'
import {projectIdentity} from '../quest/project'
function fixture() {
 const scratch=mkdtempSync(join(tmpdir(),'quest-pool-')),root=join(scratch,'repo');mkdirSync(root)
 const git=(...args:string[])=>{const r=spawnSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid',...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
 git('init');writeFileSync(join(root,'.gitignore'),'.claude/\nnode_modules/\n');writeFileSync(join(root,'code.txt'),'base');git('add','.');git('commit','-m','base')
 const runtime=join(scratch,'runtime'),manager=new QuestWorkspaces(runtime),count=join(scratch,'count')
 const bootstrap=[process.execPath,'-e',`const fs=require('fs');const p=${JSON.stringify(count)};fs.writeFileSync(p,String(Number(fs.existsSync(p)?fs.readFileSync(p,'utf8'):0)+1))`]
 return {scratch,root,runtime,manager,git,bootstrap,count}
}
test('prepared assignment skips bootstrap, retains short physical path and checks freshness before prompt',()=>{
 const f=fixture();try{
  expect(f.manager.prepare({directory:f.root,bootstrap:f.bootstrap}).state).toBe('ready')
  const start=performance.now(),a=f.manager.create({runID:'worker-a',questID:'q',directory:f.root,bootstrap:f.bootstrap});const ms=performance.now()-start
  expect(a.physicalRunID).toMatch(/^warm-/);expect(readFileSync(f.count,'utf8')).toBe('1');f.manager.verify(a)
  expect(f.manager.create({runID:'worker-a',questID:'q',directory:f.root,bootstrap:f.bootstrap}).path).toBe(a.path)
  f.manager.assertPreparedSource(a);writeFileSync(join(f.root,'code.txt'),'changed');expect(()=>f.manager.assertPreparedSource(a)).toThrow('Project changed')
  const b=f.manager.create({runID:'worker-b',questID:'q',directory:f.root,bootstrap:f.bootstrap});expect(b.path).not.toBe(a.path);expect(readFileSync(join(b.path,'code.txt'),'utf8')).toBe('changed')
  console.log(JSON.stringify({preparedMs:a.preparationMs,assignmentMs:Math.round(ms),bootstrapCalls:readFileSync(f.count,'utf8')}))
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)
test('stale base and bootstrap changes rebuild only clean unassigned spares; dirty spare preserved',()=>{
 const f=fixture();try{
  const first=f.manager.prepare({directory:f.root,bootstrap:f.bootstrap});const old=f.manager.get(first.runID!)!
  writeFileSync(join(f.root,'code.txt'),'new');f.git('add','.');f.git('commit','-m','advance')
  const next=f.manager.prepare({directory:f.root,bootstrap:f.bootstrap});expect(next.state).toBe('ready');expect(next.runID).not.toBe(first.runID);expect(existsSync(old.path)).toBe(false)
  const changed=f.manager.prepare({directory:f.root,bootstrap:[...f.bootstrap,'changed']});expect(changed.state).toBe('ready');expect(changed.runID).not.toBe(next.runID)
  const spare=f.manager.get(changed.runID!)!;writeFileSync(join(spare.path,'code.txt'),'do not discard')
  expect(f.manager.prepare({directory:f.root,bootstrap:f.bootstrap}).state).toBe('preserved');expect(readFileSync(join(spare.path,'code.txt'),'utf8')).toBe('do not discard')
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)
test('one spare does not cap legitimate worker allocations; integrated cleanup retains records',()=>{
 const f=fixture();try{
  const runs=[]
  for(let i=0;i<4;i++){expect(f.manager.prepare({directory:f.root}).state).toBe('ready');runs.push(f.manager.create({runID:'run-'+i,questID:'q',directory:f.root}))}
  expect(new Set(runs.map(r=>r.path)).size).toBe(4);expect(f.manager.prepare({directory:f.root}).state).toBe('ready')
  const fifth=f.manager.create({runID:'fifth',questID:'q',directory:f.root});expect(fifth.physicalRunID).toBeTruthy();expect(runs.every(r=>r.path!==fifth.path)).toBe(true)
  expect(f.manager.cleanup(runs[0].runID).removed).toBe(true);expect(f.manager.prepare({directory:f.root}).state).toBe('ready')
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
// This case creates and snapshots multiple real Windows Git worktrees.
},120000)
test('competing preparation and allocation locks do not wait or duplicate assignment',()=>{
 const f=fixture();try{
  f.manager.prepare({directory:f.root});const id=projectIdentity(f.root).id
  const lock=acquireLock(f.runtime,'prepared-'+id)
  try {expect(f.manager.prepare({directory:f.root}).state).toBe('busy')}finally{lock.release()}
  const allocation=acquireLock(f.runtime,'workspace-blocked')
  try{expect(()=>f.manager.create({runID:'blocked',questID:'q',directory:f.root})).toThrow()}finally{allocation.release()}
  const a=f.manager.create({runID:'a',questID:'q',directory:f.root}),b=f.manager.create({runID:'b',questID:'q',directory:f.root});expect(a.path).not.toBe(b.path)
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)

test('background preparation returns promptly and competing processes keep one spare',async()=>{
 const f=fixture();try{
  const modulePath=join(import.meta.dir,'../quest/workspaces.ts')
  const code=`import {QuestWorkspaces} from ${JSON.stringify(modulePath)};console.log(JSON.stringify(new QuestWorkspaces(${JSON.stringify(f.runtime)}).prepare({directory:${JSON.stringify(f.root)}})))`
  const processes=[Bun.spawn([process.execPath,'-e',code],{stdout:'pipe',stderr:'pipe',windowsHide:true}),Bun.spawn([process.execPath,'-e',code],{stdout:'pipe',stderr:'pipe',windowsHide:true})]
  const results=await Promise.all(processes.map(async p=>{const [out,err,exit]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);expect(exit).toBe(0);return JSON.parse(out)}))
  expect(results.some(r=>r.state==='ready')).toBe(true);expect(results.every(r=>['ready','busy'].includes(r.state))).toBe(true)
  expect(f.manager.preparationStatus(projectIdentity(f.root).id).retainedNewAllocations).toBe(1)
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)
test('dirty source snapshot refreshes without discarding user edits or accepting stale files',()=>{
 const f=fixture();try{
  writeFileSync(join(f.root,'draft.txt'),'first');const first=f.manager.prepare({directory:f.root});expect(first.state).toBe('ready')
  writeFileSync(join(f.root,'draft.txt'),'second');const second=f.manager.prepare({directory:f.root});expect(second.state).toBe('ready');expect(second.runID).not.toBe(first.runID)
  const worker=f.manager.create({runID:'dirty',questID:'q',directory:f.root});expect(worker.physicalRunID).toBe(second.runID);expect(readFileSync(join(worker.path,'draft.txt'),'utf8')).toBe('second');expect(readFileSync(join(f.root,'draft.txt'),'utf8')).toBe('second')
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)

test('unchanged failed bootstrap is retained without another execution',()=>{
 const f=fixture();try{
  const fail=[process.execPath,'-e',`const fs=require('fs');const p=${JSON.stringify(f.count)};fs.writeFileSync(p,String(Number(fs.existsSync(p)?fs.readFileSync(p,'utf8'):0)+1));process.exit(7)`]
  expect(()=>f.manager.prepare({directory:f.root,bootstrap:fail})).toThrow('bootstrap failed')
  expect(f.manager.prepare({directory:f.root,bootstrap:fail}).state).toBe('failed');expect(readFileSync(f.count,'utf8')).toBe('1')
  expect(f.manager.prepare({directory:f.root,bootstrap:f.bootstrap}).state).toBe('ready');expect(readFileSync(f.count,'utf8')).toBe('2')
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)
test('host scheduling is nonblocking and writes an observable preparation result',async()=>{
 const f=fixture();try{
  const {prepareWorkspaceLater}=await import('../quest/workspace-pool')
  const policy=join(f.scratch,'policy.json');writeFileSync(policy,JSON.stringify({bootstrapByProject:{}}))
  const start=performance.now();prepareWorkspaceLater(f.runtime,f.root,policy);expect(performance.now()-start).toBeLessThan(250)
  const id=projectIdentity(f.root).id;let status
  for(let i=0;i<200;i++){status=f.manager.preparationStatus(id);if(status.last)break;await Bun.sleep(100)}
  expect(status?.last?.state).toBe('ready');expect(status?.spare?.bootstrapComplete).toBe(true)
 }finally{rmSync(f.scratch,{recursive:true,force:true})}
},60000)
