import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { QuestStore } from "../quest/store"
import { questsAPI } from "../quest/api"
import { projectIdentity } from "../quest/project"
import { projectQuests, resolveBoardProject } from "../quest/board-project"
import { filterQuests, questLaneCounts } from "../quest/tui-model"
import { questChanges } from "../quest/change-view"
import { QuestWorkspaces } from "../quest/workspaces"
import { startDisabled, talkToGiver, returnToQuest, runDetails, createGiver, turnInDisabled } from "../quest/tui-workflow"
import { navigateQuestSession } from "../quest/tui-navigation"

function fixture() {
  const root=mkdtempSync(join(tmpdir(),"quest-workflow-")),store=new QuestStore(join(root,"ledger")),project=projectIdentity(root)
  const api=questsAPI(store,{project,sessionID:"ses_giver",requestID:"request"},async()=>({sessionID:"ses_worker"}))
  const view=api.create({title:"Workflow",description:"Test",steps:[{id:"first",title:"First"}]})
  return {root,store,project,api,q:()=>store.read(view.id)!,close:()=>rmSync(root,{recursive:true,force:true})}
}
test("each HUD count reaches exactly its scoped records, including overlapping attention/activity",()=>{
  const f=fixture()
  try {
    const q=f.q(),foreign={...q,id:"foreign",project:{id:"other",root:"other"}},unknown={...q,id:"legacy",project:undefined}
    const rows=[q,{...q,id:"ready",state:"Ready to complete"},{...q,id:"attention",state:"Needs attention"},{...q,id:"verify",state:"Verifying"},{...q,id:"archive",state:"Archived"},foreign,unknown] as any[]
    const scoped=projectQuests(rows,f.project.id),counts=questLaneCounts(scoped)
    for(const [filter,key] of [["ready","toTurnIn"],["active","active"],["attention","attention"],["verifying","verifying"],["waiting","waitingNew"]] as const)expect(filterQuests(scoped,filter).length).toBe(counts[key])
    expect(filterQuests(scoped,"archived").map(q=>q.id)).toEqual(["archive"])
    expect(projectQuests(rows,undefined)).toEqual([])
    expect(projectQuests(rows,f.project.id,true)).toHaveLength(7)
  } finally {f.close()}
})
test("session location takes priority and missing session fails closed",async()=>{
  const f=fixture()
  try {
    const context={location:{directory:"untrusted"},client:{session:{get:async()=>({id:"ses_giver",location:{directory:f.root}})}}}
    expect((await resolveBoardProject(context,"ses_giver")).id).toBe(f.project.id)
    expect((await resolveBoardProject(context,"ses_missing")).id).toBeUndefined()
  } finally {f.close()}
})
test("giver navigation uses recorded owner, verifies project and preserves board return",async()=>{
  const f=fixture()
  try {
    const navigated:any[]=[],board={type:"plugin",id:"quests",name:"quests",data:{questID:f.q().id,filter:"ready"}}
    const context={ui:{router:{current:()=>board,navigate:(r:any)=>navigated.push(r)}},client:{session:{get:async()=>({id:"ses_giver",location:{directory:f.root}})}}}
    expect(f.q().integrationOwner).toBe("ses_giver")
    await talkToGiver(context,f.q());expect(navigated[0]).toEqual({type:"session",sessionID:"ses_giver"})
    returnToQuest(context);expect(navigated[1]).toEqual(board)
    await expect(talkToGiver(context,{...f.q(),integrationOwner:undefined})).rejects.toThrow("No Quest Giver")
    await expect(talkToGiver(context,{...f.q(),project:{id:"other",root:f.root}})).rejects.toThrow("project")
    expect(navigated).toHaveLength(2)
  } finally {f.close()}
})
test("opening a new Quest reuses the recorded user giver without another creation",async()=>{
  const f=fixture()
  try {
    let created=0;const routes:any[]=[]
    const context={location:{directory:f.root},ui:{router:{navigate:(r:any)=>routes.push(r)}},client:{session:{get:async()=>({id:'ses_giver',agent:'quest-giver',location:{directory:f.root}}),create:async()=>{created++;return {id:'ses_new'}}}}}
    await createGiver(context,f.store,f.q());await createGiver(context,f.store,f.q());expect(created).toBe(0);expect(f.q().integrationOwner).toBe('ses_giver');expect(routes).toEqual([{type:'session',sessionID:'ses_giver'},{type:'session',sessionID:'ses_giver'}])
  }finally{f.close()}
})

test("historical attempt identity is retained without entering workspace namespace",()=>{
  const f=fixture()
  try {
    f.store.apply(f.q().id,"session-planned",{callID:"call_OldHostID",runID:"call_OldHostID",model:"exact/model"})
    f.store.apply(f.q().id,"session-state",{callID:"call_OldHostID",state:"failed",result:"token=secret123 provider rejected\x1b[31m"})
    let lookups=0
    const rows=questChanges(f.q(),{get:()=>{lookups++;throw Error("must not look up")}} as any)
    expect(lookups).toBe(0);expect(rows[0].runID).toBe("call_OldHostID");expect(rows[0].note).toContain("Historical")
    const details=runDetails(f.q(),f.q().sessions[0]);expect(details).toContain("provider rejected");expect(details).not.toContain("secret123");expect(details).not.toContain("\x1b");expect(details).toContain("not confirmed")
    expect(startDisabled(f.q())).toBeUndefined()
  } finally {f.close()}
})
test("unknown launches disable new work and acceptance without discarding history",()=>{
  const f=fixture()
  try {
    f.store.apply(f.q().id,"session-planned",{callID:"unknown",runID:"unknown",deliverables:["first"]})
    expect(startDisabled(f.q())).toContain("unknown")
    expect(turnInDisabled(f.q())).toContain("unknown")
    expect(questChanges(f.q(),new QuestWorkspaces(f.store.runtime))[0].note).toContain("No owned workspace")
    expect(f.q().sessions).toHaveLength(1)
  } finally {f.close()}
})
test("v2 root worker sessions open only with exact stored ID and worktree binding",async()=>{
  const f=fixture()
  try {
    f.store.apply(f.q().id,"session-planned",{callID:"run",runID:"run",parentID:"ses_giver",providerID:"openai",modelID:"exact",runtime:"native",scope:{worktree:f.root}})
    f.store.apply(f.q().id,"session-bound",{callID:"run",sessionID:"ses_worker"})
    const s=f.q().sessions[0],routes:any[]=[]
    const context={client:{session:{get:async()=>({id:"ses_worker",location:{directory:f.root}})}},ui:{router:{navigate:(r:any)=>routes.push(r)}}}
    expect(await navigateQuestSession(context,s)).toBe(true)
    expect(routes).toEqual([{type:"session",sessionID:"ses_worker"}])
    context.client.session.get=async()=>({id:"ses_other",location:{directory:f.root}})
    expect(await navigateQuestSession(context,s)).toBe(false)
  } finally {f.close()}
})
