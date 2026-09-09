import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {QuestStore} from '../quest/store'
import {installUserGiverContext,bindUserGiver,ensureUserGiver,selectUserGiverProject,userGiverID,verifyGiverBinding} from '../quest/user-giver'
import {typedQuestTool} from '../quest/typed-tool'

test('one verified giver owns different projects without moving the conversation or creating givers',async()=>{
 const root=mkdtempSync(join(tmpdir(),'one-giver-')),a=join(root,'a'),b=join(root,'b');mkdirSync(a);mkdirSync(b);const store=new QuestStore(join(root,'ledger')),giver={id:'ses_user',agent:'quest-giver',model:{providerID:'exact',id:'model'},location:{directory:a}};let created=0;const contexts:any[]=[]
 const host={get:async()=>giver,create:async()=>{created++;throw Error('No other giver')},prompt:async()=>{}}
 try{
  await bindUserGiver(store,host,giver.id);expect((await ensureUserGiver(store,host)).id).toBe(giver.id)
  const tool=typedQuestTool(store,host,{startRun:async(input)=>{contexts.push(input.context);verifyGiverBinding(store,input.context,giver);return {sessionID:'ses_worker'+contexts.length}}})
  selectUserGiverProject(store,giver.id,[{directory:a}],1);const first=await tool.execute({action:'create',create:{title:'A',description:'First project',steps:[{id:'work',title:'Work'}]}},{sessionID:giver.id,id:'create-a'})
  selectUserGiverProject(store,giver.id,[{directory:b}],2);const second=await tool.execute({action:'create',create:{title:'B',description:'Second project',steps:[{id:'work',title:'Work'}]}},{sessionID:giver.id,id:'create-b'})
  expect(first.output.project.id).not.toBe(second.output.project.id)
  await tool.execute({action:'run',id:first.output.id},{sessionID:giver.id,id:'run-a'});await tool.execute({action:'run',id:second.output.id},{sessionID:giver.id,id:'run-b'})
  expect(contexts.map(c=>c.sessionID)).toEqual([giver.id,giver.id]);expect(contexts.map(c=>c.directory)).toEqual([a,b]);expect(created).toBe(0);expect(userGiverID(store)).toBe(giver.id)
  expect((await tool.execute({action:'list'},{sessionID:giver.id,id:'list'})).output.items).toHaveLength(2)
  expect(()=>verifyGiverBinding(store,contexts[0],{...giver,location:{directory:b}})).toThrow('giver changed')
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('unreachable existing giver never creates a substitute',async()=>{
 const root=mkdtempSync(join(tmpdir(),'one-giver-missing-')),store=new QuestStore(root);let creates=0;const giver={id:'ses_user',agent:'quest-giver',location:{directory:root}}
 try{await bindUserGiver(store,{get:async()=>giver},giver.id);await expect(ensureUserGiver(store,{get:async()=>{throw Error('host unreachable')},create:async()=>{creates++}})).rejects.toThrow('host unreachable');expect(creates).toBe(0)}finally{rmSync(root,{recursive:true,force:true})}
})

test('simultaneous entry and uncertain create preserve one giver admission',async()=>{
 const root=mkdtempSync(join(tmpdir(),'one-giver-race-')),store=new QuestStore(root);let creates=0,release:any
 const pending=new Promise<any>(r=>release=r),giver={id:'ses_one',agent:'quest-giver',location:{directory:root}}
 try{
  const host={get:async()=>giver,create:async()=>{creates++;return pending}}
  const first=ensureUserGiver(store,host,undefined,root)
  await expect(ensureUserGiver(store,host,undefined,root)).rejects.toThrow('uncertain')
  release(giver);expect((await first).id).toBe(giver.id)
  expect((await ensureUserGiver(new QuestStore(root),host)).id).toBe(giver.id);expect(creates).toBe(1)
 }finally{rmSync(root,{recursive:true,force:true})}
 const unknown=mkdtempSync(join(tmpdir(),'one-giver-unknown-')),ledger=new QuestStore(unknown)
 try{
  const host={get:async()=>null,create:async()=>{creates++;throw Error('connection lost after create')}}
  await expect(ensureUserGiver(ledger,host,undefined,unknown)).rejects.toThrow('connection lost')
  await expect(ensureUserGiver(new QuestStore(unknown),host,undefined,unknown)).rejects.toThrow('uncertain');expect(creates).toBe(2)
 }finally{rmSync(unknown,{recursive:true,force:true})}
})
test('a different returned session or a worker cannot claim the user giver',async()=>{
 const root=mkdtempSync(join(tmpdir(),'one-giver-identity-')),store=new QuestStore(root)
 try{
  await expect(bindUserGiver(store,{get:async()=>({id:'ses_other',agent:'quest-giver',location:{directory:root}})},'ses_user')).rejects.toThrow('different giver')
  await expect(bindUserGiver(store,{get:async()=>({id:'ses_child',parentID:'ses_parent',agent:'quest-giver',location:{directory:root}})},'ses_child')).rejects.toThrow('never an execution worker')
  expect(userGiverID(store)).toBeUndefined()
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('first native discussion registers the giver before any Quest exists and rejects a second giver turn',async()=>{
 const root=mkdtempSync(join(tmpdir(),'one-giver-discussion-')),store=new QuestStore(root);let context:any,creates=0
 const host={hook:async(_name:string,fn:any)=>context=fn,get:async({sessionID}:any)=>({id:sessionID,agent:'quest-giver',location:{directory:root}}),create:async()=>{creates++}}
 try{await installUserGiverContext(store,host);await context({agent:'general',sessionID:'ses_general'});expect(userGiverID(store)).toBeUndefined();await context({agent:'quest-giver',sessionID:'ses_user'});expect(userGiverID(new QuestStore(root))).toBe('ses_user');await expect(context({agent:'quest-giver',sessionID:'ses_other'})).rejects.toThrow('existing Quest Giver');expect(creates).toBe(0)}finally{rmSync(root,{recursive:true,force:true})}
})
