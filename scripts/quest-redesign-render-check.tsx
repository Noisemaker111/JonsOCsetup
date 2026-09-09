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
 for(const width of [80,120]) {
  const commands=new Map<string,any>();let chosen:any;let navigated:any
  const size=Object.assign(new EventEmitter(),{width,height:30})
  const context={renderer:size,location:{directory:process.cwd()},keymap:{layer:(get:any)=>{for(const c of get().commands)commands.set(c.id,c)}},ui:{router:{navigate:(r:any)=>{navigated=r}},dialog:{select:async()=>chosen,prompt:async()=>chosen}}}
  const setup=await testRender(()=><QuestBoard context={context}/>,{width,height:30})
  const frame=async()=>{await setup.renderOnce();await Bun.sleep(60);await setup.renderOnce();return setup.captureCharFrame()}
  const run=async(id:string)=>{assert(commands.has(id),"Missing command "+id);await commands.get(id).run();return frame()}
  try {
   let text=await frame();assert(text.includes("Search quests"));assert(text.includes("invoice reminders"));assert(!text.includes("unavailable"))
   if(width===80){assert(!text.includes("DELIVERABLE"));text=await run("quests.open");assert(text.includes("Back to Quests"));assert(text.includes("QUEST STEPS"));assert(text.includes("Review and accept"));await run("quests.close");assert(!navigated)}
   chosen=first.id;text=await run("quests.choose");assert(text.includes("Unique description 1"));assert(!text.includes("Detail for task 11"))
   const lines=text.split("\n");const titleRow=lines.findIndex(l=>l.includes("Fix duplicate invoice"));assert(titleRow>=0)
   await run("quests.detail-down");chosen=second.id;text=await run("quests.choose");assert(text.includes("Unique description 2"),"New selection must reset detail scroll")
   for(let n=0;n<5;n++)text=await run("quests.detail-down");assert(text.includes("AGENT LOG"));assert(text.includes("No worker sessions recorded"));assert(commands.has("quests.worker"))
   chosen="invoice";text=await run("quests.search");assert(text.includes("1 matching"));assert(text.includes("invoice reminders"))
   if(width===80)assert(!text.includes("Unique description 1"))
   text=await run("quests.clear-search");assert(text.includes("3 matching"))
   chosen=ready.id;text=await run("quests.choose");assert(text.includes("Review and accept"));assert.equal((text.match(/\[t\]/g)??[]).length,1);assert(!text.includes("Detail for task 11"))
   if(width===80)await run("quests.close")
   await run("quests.close");assert.deepEqual(navigated,{type:"home"})
  } finally {setup.renderer.destroy()}
 }
 console.log("QUEST_REDESIGN_RENDER_OK: narrow navigation, search, selection scroll, visible agent log, turn-in actions")
} finally {if(prior===undefined)delete process.env.OPENCODE_QUEST_ROOT;else process.env.OPENCODE_QUEST_ROOT=prior;rmSync(ledger,{recursive:true,force:true})}
