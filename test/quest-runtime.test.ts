import { expect,test as bunTest } from "bun:test"
import { realpathSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { QuestStore } from "../quest/store"
import { questsAPI } from "../quest/api"
import { projectIdentity } from "../quest/project"
import { startQuestRun } from "../quest/runtime"
import { typedQuestTool } from "../quest/typed-tool"
const test=(title:string,fn:()=>any)=>bunTest(title,fn,30000)
function fixture(){const root=mkdtempSync(join(tmpdir(),"quest-runtime-")),main=join(root,"main");mkdirSync(main);for(const args of [["init"],["-c","user.name=Test","-c","user.email=test@example.invalid","commit","--allow-empty","-m","base"]]){const p=spawnSync("git",["-C",main,...args],{encoding:"utf8",windowsHide:true});if(p.status!==0)throw new Error(p.stderr)}const settingsFile=join(root,"workspace-settings.json");writeFileSync(settingsFile,JSON.stringify({version:1,workspaceMode:"worktree"}));return {root,main,settingsFile,store:new QuestStore(join(root,"ledger")),cleanup:()=>rmSync(root,{recursive:true,force:true})}}
const route={id:"r",providerID:"p",modelID:"m",harness:"native",reasoning:"high",serviceTier:"default"}
test("runtime verifies actual worktree before prompt, records model and collects worker changes",async()=>{
 const f=fixture();let directory="",prompts=0,selectedModel:any
 try{const host={create:async(i:any)=>{directory=i.location.directory;selectedModel=i.model;return{id:"worker"}},get:async()=>({location:{directory},model:selectedModel}),prompt:async()=>{prompts++;writeFileSync(join(directory,"result.txt"),"result\n")}}
 const reserve:any=async()=>({route,bootstrapByProject:{},ledger:{settle:()=>{}}})
 const api=questsAPI(f.store,{project:projectIdentity(f.main),directory:f.main,sessionID:"parent",requestID:"run"},startQuestRun(f.store,host,{settingsFile:f.settingsFile,policyFile:"fixture",reserve}))
 const q=api.create({title:"Task",description:"Implement",steps:[{title:"Work"}]});const result=await api.run(q.id,{model:"p/m"});expect(result.sessionID).toBe("worker");expect(directory).toContain(".claude");expect(prompts).toBe(1);expect(api.get(q.id).steps[0].state).toBe("working");expect(api.get(q.id).runs[0].model).toBe("p/m")
 }finally{f.cleanup()}
})
test("binding mismatch never sends a prompt and preserves an actionable failed run",async()=>{
 const f=fixture();let prompts=0,cancelled=""
 try{const host={create:async()=>({id:"wrong"}),get:async()=>({location:{directory:f.main}}),prompt:async()=>{prompts++}}
 const reserve:any=async()=>({route,bootstrapByProject:{},ledger:{settle:(_:any,o:any)=>cancelled=o.state}})
 const api=questsAPI(f.store,{project:projectIdentity(f.main),directory:f.main,sessionID:"parent",requestID:"run"},startQuestRun(f.store,host,{settingsFile:f.settingsFile,policyFile:"fixture",reserve}));const q=api.create({title:"Task",description:"Work",steps:[{title:"Work"}]})
 await expect(api.run(q.id)).rejects.toThrow("not bound");expect(prompts).toBe(0);expect(cancelled).toBe("cancelled");expect(api.get(q.id).runs[0].state).toBe("failed")
 }finally{f.cleanup()}
})
test("typed host tool exposes only five operations and derives project from the real session",async()=>{
 const f=fixture();try{const tool=typedQuestTool(f.store,{get:async()=>({location:{directory:f.main}}),create:async()=>null,prompt:async()=>null},{startRun:async()=>({sessionID:"worker"})});expect(tool.input.properties.action.enum).toEqual(["list","get","create","update","run"]);const q=await tool.execute({action:"create",create:{title:"Title",description:"Description",steps:[{title:"Work"}]}},{sessionID:"parent",id:"create"});expect(q.output.project).toEqual(projectIdentity(f.main));expect(q.output).toStrictEqual(JSON.parse(JSON.stringify(q.output)));await expect(tool.execute({action:"bogus"},{sessionID:"parent",callID:"bad"})).rejects.toThrow("Use list") }finally{f.cleanup()}
})

test("configured commands execute without host inference and preserve actual failures",async()=>{
 const f=fixture();try{const project=projectIdentity(f.main),policyFile=join(f.root,"policy.json");writeFileSync(policyFile,JSON.stringify({version:1,commandsByProject:{[project.id]:{check:{description:"Run fixture check",argv:[process.execPath,"-e","console.log('observed command');require('fs').writeFileSync('command.txt','ok')"],timeoutMilliseconds:5000},fail:{description:"Fail fixture check",argv:[process.execPath,"-e","process.exit(7)"],timeoutMilliseconds:5000}}}}));const host={create:async()=>{throw new Error("No model should start")},get:async()=>null,prompt:async()=>{throw new Error("No inference")}}
 const api=questsAPI(f.store,{project,directory:f.main,sessionID:"parent",requestID:"command"},startQuestRun(f.store,host,{settingsFile:f.settingsFile,policyFile}));const q=api.create({title:"Check",description:"Run configured verification",steps:[{title:"Run check",commandID:"check"}]});expect((await api.run(q.id)).state).toBe("completed");expect(api.get(q.id).steps[0].state).toBe("done");expect(api.get(q.id).artifacts).toHaveLength(1);expect(api.get(q.id).runs[0].kind).toBe("command")
 const failAPI=questsAPI(f.store,{project,directory:f.main,sessionID:"parent",requestID:"failure"},startQuestRun(f.store,host,{settingsFile:f.settingsFile,policyFile}));const failed=failAPI.create({title:"Failure",description:"Observe configured failure",steps:[{title:"Run failing check",commandID:"fail"}]});await expect(failAPI.run(failed.id)).rejects.toThrow("exit 7");expect(failAPI.get(failed.id).steps[0].state).toBe("blocked");expect(failAPI.get(failed.id).runs[0].state).toBe("failed")
 }finally{f.cleanup()}
})

test("dependent command steps receive predecessor output without changing the main checkout",async()=>{
 const f=fixture();try{const project=projectIdentity(f.main),policyFile=join(f.root,"policy.json");writeFileSync(policyFile,JSON.stringify({version:1,commandsByProject:{[project.id]:{write:{description:"Produce output",argv:[process.execPath,"-e","require('fs').writeFileSync('predecessor.txt','expected')"],timeoutMilliseconds:5000},check:{description:"Verify predecessor",argv:[process.execPath,"-e","if(require('fs').readFileSync('predecessor.txt','utf8')!=='expected')process.exit(1)"],timeoutMilliseconds:5000}}}}));const host={create:async()=>null,get:async()=>null,prompt:async()=>null},start=startQuestRun(f.store,host,{settingsFile:f.settingsFile,policyFile});const api=questsAPI(f.store,{project,directory:f.main,sessionID:"parent",requestID:"first"},start);const q=api.create({title:"Sequence",description:"Carry work forward",steps:[{id:"write",title:"Write",commandID:"write"},{id:"check",title:"Check",commandID:"check",needs:["write"]}]});await api.run(q.id);const next=questsAPI(f.store,{project,directory:f.main,sessionID:"parent",requestID:"second"},start);expect((await next.run(q.id)).state).toBe("completed");expect(next.get(q.id).steps.every(s=>s.state==="done")).toBe(true);expect(()=>readFileSync(join(f.main,"predecessor.txt"))).toThrow()
 }finally{f.cleanup()}
})

test("a target that stops during workspace preparation cancels the reservation before any prompt",async()=>{
 const f=fixture();let directory="",selectedModel:any,prompts=0,checked=false,settled:any
 try{
  const host={create:async(i:any)=>{directory=i.location.directory;selectedModel=i.model;return{id:"unprompted"}},get:async()=>({location:{directory},model:selectedModel}),prompt:async()=>{prompts++}}
  const reserve:any=async()=>({route:{...route,accountID:"account"},bootstrapByProject:{},ledger:{settle:(_id:string,value:any)=>{settled=value}}})
  const start=startQuestRun(f.store,host,{settingsFile:f.settingsFile,policyFile:"fixture",reserve,beforePrompt:async account=>{checked=true;expect(account).toBe("account");throw Error("Burn pacing stopped: Target deadline reached")}})
  const api=questsAPI(f.store,{project:projectIdentity(f.main),directory:f.main,sessionID:"parent",requestID:"deadline"},start)
  const q=api.create({title:"Work near deadline",description:"Do not start after deadline",steps:[{id:"work",title:"Useful work"}]})
  await expect(api.run(q.id,{model:"p/m#high"})).rejects.toThrow("Target deadline reached")
  expect(checked).toBe(true);expect(prompts).toBe(0);expect(settled.state).toBe("cancelled")
 }finally{f.cleanup()}
})

test("shared worker host location retains native filesystem case without changing identity",async()=>{
 const f=fixture();let directory="",model:any;try{writeFileSync(f.settingsFile,JSON.stringify({version:1,workspaceMode:"shared"}));const host={create:async(i:any)=>{directory=i.location.directory;model=i.model;return{id:"worker"}},get:async()=>({location:{directory},model}),prompt:async()=>{}};const reserve:any=async()=>({route,bootstrapByProject:{},ledger:{settle:()=>{}}});const api=questsAPI(f.store,{project:projectIdentity(f.main),directory:f.main,sessionID:"parent",requestID:"case"},startQuestRun(f.store,host,{settingsFile:f.settingsFile,policyFile:"fixture",reserve}));const q=api.create({title:"Case",description:"Keep native spelling",steps:[{id:"case",title:"Inspect"}]});await api.run(q.id,{model:"p/m#high",files:["result.txt"]});expect(directory).toBe(realpathSync.native(f.main));expect(projectIdentity(directory)).toEqual(projectIdentity(f.main))}finally{f.cleanup()}
})
