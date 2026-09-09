import {test,expect} from 'bun:test'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {appendEvent,readEvents,journalPath,recoverIncompleteClaim} from '../quest/journal'
import {makeEvent} from '../quest/events'
const id='0001n9mvne4bj4ef7wn33x7pbe'
test('explicit recovery preserves malformed journal, restores replay and permits subsequent events',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-recovery-test-'))
 try{
 const first=makeEvent(id,'patched',{nextAction:'verify'}),bad:any=makeEvent(id,'session-claimed',{});delete bad.payload
 const file=journalPath(root,id);mkdirSync(dirname(file),{recursive:true});const original=JSON.stringify(first)+'\n'+JSON.stringify(bad)+'\n';writeFileSync(file,original)
 const expectedSha256=createHash('sha256').update(original).digest('hex'),input={expectedSha256,reason:'Incomplete claim has no session identity; discard rather than fabricate'}
 expect(()=>readEvents(root,id)).toThrow('line 2')
 expect(recoverIncompleteClaim(root,id,input).applied).toBe(false);expect(()=>readEvents(root,id)).toThrow('line 2')
 expect(()=>recoverIncompleteClaim(root,id,{...input,expectedSha256:'wrong',apply:true})).toThrow('changed')
 expect(recoverIncompleteClaim(root,id,{...input,apply:true}).applied).toBe(true)
 expect(readFileSync(file,'utf8')).toBe(original);expect(readFileSync(file+'.'+expectedSha256+'.preserved','utf8')).toBe(original)
 expect(readEvents(root,id).map(e=>e.eventID)).toEqual([first.eventID])
 const next=makeEvent(id,'patched',{nextAction:'recovered'});appendEvent(root,next)
 expect(readEvents(root,id).map(e=>e.eventID)).toEqual([first.eventID,next.eventID])
 writeFileSync(file,readFileSync(file,'utf8').replace('verify','tamper'))
 expect(()=>readEvents(root,id)).toThrow('evidence does not match')
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('recovery refuses a malformed non-tail event',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-recovery-test-'))
 try{const bad:any=makeEvent(id,'session-claimed',{});delete bad.payload;const file=journalPath(root,id);mkdirSync(dirname(file),{recursive:true});const bytes=JSON.stringify(bad)+'\n'+JSON.stringify(makeEvent(id,'patched',{}))+'\n';writeFileSync(file,bytes);expect(()=>recoverIncompleteClaim(root,id,{expectedSha256:createHash('sha256').update(bytes).digest('hex'),reason:'test',apply:true})).toThrow('only a complete final')}
 finally{rmSync(root,{recursive:true,force:true})}
})
