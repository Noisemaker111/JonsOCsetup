import {test,expect} from "bun:test"
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname,join} from "node:path"
import {makeEvent} from "../quest/events"
import {journalPath,readEvents,appendEvent} from "../quest/journal"
test("malformed complete events fail visibly without erasing journal bytes; interrupted final appends remain recoverable",()=>{
 const dir=mkdtempSync(join(tmpdir(),"quest-journal-")),file=journalPath(dir,"q");mkdirSync(dirname(file),{recursive:true});try{
 const event=makeEvent("q","session-claimed",{callID:"worker"}),good=JSON.stringify(event)+"\n",bad:any={...event};delete bad.payload
 const corrupt=good+JSON.stringify(bad)+"\n";writeFileSync(file,corrupt);expect(()=>readEvents(dir,"q")).toThrow("object payload");expect(readFileSync(file,"utf8")).toBe(corrupt)
 writeFileSync(file,good+'{"unfinished":');expect(readEvents(dir,"q")).toEqual([event]);expect(()=>appendEvent(dir,event)).toThrow("Interrupted Quest journal append");expect(readEvents(dir,"q")).toEqual([event])
 writeFileSync(file,good+'{"unfinished":\n'+good);expect(()=>readEvents(dir,"q")).toThrow("Unreadable Quest journal line 2")
 }finally{rmSync(dir,{recursive:true,force:true})}
})
