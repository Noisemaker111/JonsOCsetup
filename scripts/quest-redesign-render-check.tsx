/** @jsxImportSource @opentui/solid */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import { testRender } from "@opentui/solid"
import { QuestBoard } from "../quest/tui-active/quest-board"
import { QuestStore } from "../quest/store"
import { questsAPI } from "../quest/api"
import { projectIdentity } from "../quest/project"

const ledger=mkdtempSync(join(tmpdir(),"quest-redesign-"))
const prior=process.env.OPENCODE_QUEST_ROOT
process.env.OPENCODE_QUEST_ROOT=ledger
try {
 const store=new QuestStore(ledger),project=projectIdentity(process.cwd())
 const make=(i:number,title:string,done=false)=>{
  const api=questsAPI(store,{project,sessionID:"fixture",requestID:String(i)},async()=>{throw Error("No dispatch")})
  const q=api.create({title,description:"Unique description "+i,steps:Array.from({length:12},(_,j)=>({id:"step"+j,title:"Task "+j,detail:"Detail for task "+j})),reward:"Deliverable to inspect before acceptance"})
  if(done)api.update(q.id,{steps:Array.from({length:12},(_,j)=>({id:"step"+j,state:"done" as const}))})
  return q
 }
 const first=make(1,"Fix duplicate invoice reminders after reconnect"),second=make(2,"Restore keyboard focus after dialogs"),ready=make(3,"Keep cancelled work available for review",true)
 for(const width of [80,160]) {
  const context={renderer:Object.assign(new EventEmitter(),{width,height:30}),location:{directory:process.cwd()},keymap:{layer:()=>{}},ui:{router:{navigate:()=>{}},dialog:{}}}
  const returned=await testRender(()=><QuestBoard context={context} initialQuestID={second.id} initialAllProjects={true}/>,{width,height:30})
  try {await returned.renderOnce();await Bun.sleep(80);await returned.renderOnce();assert(returned.captureCharFrame().includes("Unique description 2"),"Returning to a selected Quest must survive the initial empty record load at width "+width)}finally{returned.renderer.destroy()}
 }
 for(const width of [80,120]) {
  const commands=new Map<string,any>();let chosen:any;let navigated:any
  const size=Object.assign(new EventEmitter(),{width,height:30})
  const context={renderer:size,location:{directory:process.cwd()},keymap:{layer:(get:any)=>{for(const c of get().commands)commands.set(c.id,c)}},ui:{router:{navigate:(r:any)=>{navigated=r}},dialog:{select:async()=>chosen,prompt:async()=>chosen}}}
  const setup=await testRender(()=><QuestBoard context={context}/>,{width,height:30})
  const frame=async()=>{await setup.renderOnce();await Bun.sleep(60);await setup.renderOnce();return setup.captureCharFrame()}
  const run=async(id:string)=>{assert(commands.has(id),"Missing command "+id);await commands.get(id).run();return frame()}
  try {
   let text=await frame();assert(text.includes("Search quests"),"initial search missing");assert(text.includes("3 matching"),"initial quest count missing");assert(!text.includes("unavailable"),"unexpected unavailable")
   if(width===80){assert(!text.includes("DELIVERABLE"),"detail leaked");text=await run("quests.open");assert(text.includes("Back to Quests"),"back missing");assert(text.includes("QUEST STEPS"),"steps missing");assert(text.includes("Review and accept"),"review missing");await run("quests.close");assert(!navigated,"narrow close navigated")}
    chosen=first.id;text=await run("quests.choose");assert(text.includes("Unique description 1"),"selected description missing");assert(!text.includes("Detail for task 11"),"detail overflowed")
    const lines=text.split("\n");const titleRow=lines.findIndex(l=>l.includes("invoice"));assert(titleRow>=0,"selected title missing")
    await run("quests.detail-down");chosen=second.id;text=await run("quests.choose");assert(text.includes("Unique description 2"),"New selection must reset detail scroll")
    for(let n=0;n<5;n++)text=await run("quests.detail-down");assert(text.includes("AGENT LOG"),"agent log missing after scroll");assert(text.includes("No worker sessions recorded"),"empty log missing");assert(commands.has("quests.worker"),"worker command missing")
    chosen="invoice";text=await run("quests.search");assert(text.includes("1 matching"),"search count missing");assert(text.includes("invoice"),"search result missing")
    if(width===80)assert(!text.includes("Unique description 1"),"narrow search leaked detail")
    text=await run("quests.clear-search");assert(text.includes("3 matching"),"clear count missing")
    chosen=ready.id;text=await run("quests.choose");assert(text.includes("Review and accept"),"review action missing");assert.equal((text.match(/\[t\]/g)??[]).length,1);assert(!text.includes("Detail for task 11"),"detail overflow after ready")
   if(width===80)await run("quests.close")
    await run("quests.close");assert.deepEqual(navigated,{type:"home"},"close did not return home")
  } finally {setup.renderer.destroy()}
 }
 console.log("QUEST_REDESIGN_RENDER_OK: narrow navigation, search, selection scroll, visible agent log, turn-in actions")
} finally {if(prior===undefined)delete process.env.OPENCODE_QUEST_ROOT;else process.env.OPENCODE_QUEST_ROOT=prior;rmSync(ledger,{recursive:true,force:true})}
