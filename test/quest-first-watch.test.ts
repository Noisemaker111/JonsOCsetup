import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {watchQuests} from '../quest/watcher'
import {QuestStore} from '../quest/store'
import {readAllQuests} from '../quest/index'
test('chat observes the first Quest when its ledger directory is created after mount',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-first-watch-'));let observed:string[]=[]
 const stop=watchQuests(root,()=>{observed=readAllQuests(root).flatMap(r=>r.quest?[r.quest.title]:[])},10)
 try{new QuestStore(root).create({id:'01j00000000000000000000882',title:'First real saved Quest',objective:'Observe',stages:[]});const until=Date.now()+3000;while(!observed.length&&Date.now()<until)await Bun.sleep(25);expect(observed).toEqual(['First real saved Quest'])}finally{stop();rmSync(root,{recursive:true,force:true})}
})
