/** @jsxImportSource @opentui/solid */
import { mkdirSync,writeFileSync } from "node:fs"
import { join,resolve } from "node:path"
import { testRender } from "@opentui/solid"
import { QuestStore } from "../quest/store"
import { QuestBoard } from "../quest/tui-active/quest-board"
import { frameToSvg } from "./opencode-visual-e2e"
import { Resvg } from "@resvg/resvg-js"
const root=resolve(import.meta.dir,".."),dir=join(root,".visual-e2e","quest-contract-"+Date.now());mkdirSync(dir,{recursive:true});process.env.OPENCODE_QUEST_ROOT=dir
const store=new QuestStore(dir),q=store.create({id:"01j00000000000000000000666",title:"Build project activity view",objective:"Show activity and explain how to use it",stages:[{id:"implement",title:"Implement and verify the activity view",status:"done",needs:[],todos:[],proofs:[],claim:{repos:[],include:[],exclude:[]},attempt:1}],usageInstructions:["Run bun run dev and open Activity."],setbacks:[{id:"old",stageID:"implement",attempt:1,reason:"Earlier retry"}] as any})
for(const phase of ["before","after"]){if(phase==="after")store.apply(q.id,"patched",{contractVersion:2,description:q.objective,reward:"Activity view is ready. Run bun run dev and open Activity. Rollout: local changes only."},"fixture")
 const setup=await testRender(()=><QuestBoard context={{location:{directory:root},ui:{router:{},dialog:{}}}} initialQuestID={q.id}/>,{width:132,height:72})
 try{await setup.renderOnce();await Bun.sleep(70);await setup.renderOnce();const frame=setup.captureCharFrame();writeFileSync(join(dir,phase+".txt"),frame);const svg=frameToSvg(setup.captureSpans(),"Quest contract "+phase);writeFileSync(join(dir,phase+".svg"),svg);writeFileSync(join(dir,phase+".png"),new Resvg(svg,{font:{loadSystemFonts:true}}).render().asPng());if(phase==="after"&&(!frame.includes("QUEST REWARD")||!frame.includes("CHANGES")||frame.includes("SETBACKS")||frame.includes("QUEST PAYOUT")))throw new Error("Contract view assertion failed")}finally{setup.renderer.destroy()}
}
console.log(JSON.stringify({ok:true,dir,source:"Actual QuestBoard component; deterministic isolated ledger. This is not live host acceptance."}))
