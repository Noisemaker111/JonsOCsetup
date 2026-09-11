/**
 * @core-prevents a Quest being admitted whose own record cannot say what it is: an objective that opens with who spoke, or a step titled only with the lifecycle stage it sits in
 * @core-observed Jk's ledger at ~/.opencode/quests, 2026-09-11: 37 of 79 objectives open with "Jk:" or "User requests", and 20 of 289 step titles are exactly Implementation, Verification or Integration. Driving the create-only guard the same day, the giver accepted the refusal and then patched the Quest back to "Integration" over five revisions.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {QuestStore} from '../quest/store'
import {questsAPI} from '../quest/api'
import {readAllQuests} from '../quest/index'

const context=(requestID:string):any=>({project:{id:'project-a',root:join('C:','projects','project-a')},sessionID:'ses_giver',requestID})
const started=async()=>({sessionID:'ses_worker'})
const refusal=(call:()=>unknown)=>{try{call()}catch(error){return String((error as any).code)+': '+String((error as any).message)}return 'no error'}

test('a Quest that cannot name itself is refused with what to write instead, and nothing is saved',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-naming-'))
 try{
  const store=new QuestStore(root)
  const speaker=refusal(()=>questsAPI(store,context('call-1'),started).create({title:'Quest board status line shows honest lane counts',description:"Jk: 'i dont like how in the bottom it says 21 quests when only like 3 are active' — split the total into lanes.",steps:[{title:'Derive the lane counts from the ledger'}]}))
  expect(speaker).toContain('UNREADABLE_QUEST')
  expect(speaker).toContain('Open with the goal itself')
  const stage=refusal(()=>questsAPI(store,context('call-2'),started).create({title:'Trim whitespace from greeting names',description:'greet.mjs keeps leading and trailing spaces in a name, so the greeting renders with a gap.',steps:[{title:'Implementation'},{title:'Verification'}]}))
  expect(stage).toContain('Step "Implementation" names a lifecycle stage')
  expect(stage).toContain('Step "Verification" names a lifecycle stage')
  expect(refusal(()=>questsAPI(store,context('call-3'),started).create({title:'Integration',description:'Fold the project router into the dev channel.',steps:[{title:'Merge the router plugin into the dev generation'}]}))).toContain('names a lifecycle stage, not an outcome')
  expect(readAllQuests(root).length).toBe(0)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('a readable Quest cannot be renamed back into an unreadable one',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-rename-'))
 try{
  const store=new QuestStore(root)
  const api=(request:string)=>questsAPI(store,context(request),started)
  const quest=api('call-1').create({title:'Composer draft survives a reconnect',description:'Typed composer text survives a reconnect instead of being lost.',steps:[{title:'Keep the draft through the reconnect'}]})
  expect(refusal(()=>api('call-2').update(quest.id,{title:'Integration'}))).toContain('names a lifecycle stage, not an outcome')
  expect(refusal(()=>api('call-3').update(quest.id,{description:'Jk: i lose my typing when it reconnects, fix it.'}))).toContain('opens by naming who spoke')
  expect(refusal(()=>api('call-4').update(quest.id,{steps:[{id:'keep-the-draft-through',state:'pending',title:'Implementation'}]}))).toContain('Step "Implementation" names a lifecycle stage')
  const saved=store.read(quest.id)!
  expect(saved.title).toBe('Composer draft survives a reconnect')
  expect(saved.stages.map(s=>s.title)).toEqual(['Keep the draft through the reconnect'])
  // Reporting a step's state carries no title, so a worker's normal update is untouched.
  expect(api('call-5').update(quest.id,{steps:[{id:'keep-the-draft-through',state:'done',note:'draft survived the reconnect'}]}).id).toBe(quest.id)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('the check is exact, so real work is never blocked over wording',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-naming-ok-'))
 try{
  const store=new QuestStore(root)
  // A stage word that leads a real title, a user named later in the objective, and an objective
  // genuinely about users: all three read fine on the board and none of them is refused.
  const quest=questsAPI(store,context('call-1'),started).create({
   title:'Integration: fold the project router into the dev channel',
   description:'Users lose their composer draft when the session reconnects. Jk authorized local commits only; no publish.',
   steps:[{title:'Verification: drive the composer through a reconnect and reopen the draft'},{title:'Persist the draft before the socket closes'}],
  })
  expect(readAllQuests(root).length).toBe(1)
  expect(store.read(quest.id)!.stages.map(s=>s.status)).toEqual(['pending','pending'])
 }finally{rmSync(root,{recursive:true,force:true})}
})
