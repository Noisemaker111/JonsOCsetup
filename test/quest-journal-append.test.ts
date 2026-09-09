import {test,expect} from 'bun:test'
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {appendEvent,readEvents,journalPath} from '../quest/journal'
import {makeEvent} from '../quest/events'
test('invalid complete event cannot create or corrupt a journal',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-append-'));try{
 const event=makeEvent('q','session-claimed',{});delete (event as any).payload
 expect(()=>appendEvent(root,event)).toThrow('object payload');expect(existsSync(journalPath(root,'q'))).toBe(false)
 const valid=makeEvent('q','session-claimed',{callID:'call'});appendEvent(root,valid)
 const before=readFileSync(journalPath(root,'q'));expect(()=>appendEvent(root,event)).toThrow('Journal preserved')
 expect(readFileSync(journalPath(root,'q'))).toEqual(before);expect(readEvents(root,'q')).toEqual([JSON.parse(JSON.stringify(valid))])
 }finally{rmSync(root,{recursive:true,force:true})}
})
