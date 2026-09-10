import {test,expect} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {QuestStore} from '../quest/store'
test('successful turn with unfinished assignment needs attention; completed research still permits later work',()=>{
 const dir=mkdtempSync(join(tmpdir(),'quest-incomplete-')),store=new QuestStore(dir)
 try{const q=store.create({id:'01j00000000000000000000881',title:'Actual completion',objective:'Verify',contractVersion:2,stages:[{id:'read',title:'Read',status:'pending',needs:[]},{id:'edit',title:'Edit',status:'pending',needs:['read']}]});store.apply(q.id,'session-planned',{callID:'one',role:'worker',deliverables:['read']},'test');store.apply(q.id,'session-state',{callID:'one',state:'completed',result:'Turn ended, no saved result'},'test');expect(store.read(q.id)?.state).toBe('Needs attention');expect(store.read(q.id)?.reason).toContain('without saved completion');store.apply(q.id,'stage-state',{stageID:'read',status:'done',evidence:'Actual verified result'},'test');expect(store.read(q.id)?.state).toBe('Waiting');expect(store.read(q.id)?.stages[1].status).toBe('pending')}finally{rmSync(dir,{recursive:true,force:true})}
})
