/**
 * @core-prevents terminal workers pinning unfinished steps, JSON inspection pages losing data, and non-repository sessions acquiring machine-wide checkout locks
 * @core-observed September 12 giver made 72 detail reads, parsed a truncated continuation, and retained working steps after ConnectionRefused; a home-directory Codex reservation blocked unrelated reads.
 */
import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { QuestStore } from '../quest/store'
import { questsAPI } from '../quest/api'
import { toolDetail, toolSection } from '../quest/tool-projection'
import { hasCheckout } from '../quest/codex/recovery-workspace'

const make = (root: string) => {
 const store = new QuestStore(root)
 const api = questsAPI(store, { project: { id: 'review', root }, sessionID: 'giver', requestID: 'create' }, async () => ({sessionID:'ses_worker'}))
 const q = api.create({title:'Verify word deletion in an unsent draft',description:'Repeated physical Ctrl+Backspace removes the previous word.',steps:[{id:'keys',title:'Exercise repeated word deletion'}]})
 return { store, id:q.id }
}
test('terminal execution releases only its unfinished step and the decision record retains the failure after reload', () => {
 const root = mkdtempSync(join(tmpdir(),'quest-terminal-'))
 try {
  const {store,id}=make(root)
  store.apply(id,'session-planned',{callID:'a',deliverables:['keys'],role:'worker'},'check')
  store.apply(id,'session-bound',{callID:'a',sessionID:'ses_a'},'check')
  store.apply(id,'stage-state',{stageID:'keys',status:'working'},'check')
  store.apply(id,'session-state',{callID:'a',state:'failed',result:'ConnectionRefused'},'check')
  let record=toolDetail(new QuestStore(root).read(id)!)
  expect(record.steps[0].state).toBe('pending')
  expect(record.steps[0].ready).toBe(true)
  expect(record.steps[0].lastOutcome?.result).toBe('ConnectionRefused')
  store.apply(id,'session-planned',{callID:'b',deliverables:['keys'],role:'worker'},'check')
  store.apply(id,'stage-state',{stageID:'keys',status:'working'},'check')
  store.apply(id,'session-state',{callID:'a',state:'failed',result:'old duplicate'},'check')
  expect(store.read(id)!.stages[0].status).toBe('working')
  store.apply(id,'stage-state',{stageID:'keys',status:'done'},'check')
  store.apply(id,'session-state',{callID:'b',state:'completed'},'check')
  expect(store.read(id)!.stages[0].status).toBe('done')
 } finally {rmSync(root,{recursive:true,force:true})}
})
test('inspection pagination preserves whole values, including a record larger than the target page',()=>{
 const original=[{note:'x'.repeat(14000)},{note:'second'},{note:'third'}]
 const seen:unknown[]=[]
 let offset:number|null=0
 while(offset!==null){const page=toolSection(original,'runs',offset,100);seen.push(...page.data as unknown[]);offset=page.nextOffset}
 expect(seen).toEqual(original)
 expect(toolSection('a\"b','description').data).toBe('a\"b')
})
test('a container directory is not a checkout, while real repositories and separate worktrees remain protected',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-checkout-'))
 try {
  expect(hasCheckout(root)).toBe(false)
  const repo=join(root,'repo');mkdirSync(repo)
  const git=(...args:string[])=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});expect(r.status).toBe(0)}
  git('init');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','initial')
  const worktree=join(root,'worktree');git('worktree','add','-b','owned',worktree)
  expect(hasCheckout(root)).toBe(false)
  expect(hasCheckout(repo)).toBe(true)
  expect(hasCheckout(worktree)).toBe(true)
 }finally{rmSync(root,{recursive:true,force:true})}
})
