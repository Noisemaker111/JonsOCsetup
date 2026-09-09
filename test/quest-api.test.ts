import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { questsAPI, QuestError } from "../quest/api"
import { QuestStore } from "../quest/store"
import { projectIdentity } from "../quest/project"
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "quest-api-")), store = new QuestStore(root)
  const context = { project: { id: "project-a", root }, sessionID: "session-a", requestID: "request-a" }
  const cleanup = () => rmSync(root, { recursive: true, force: true })
  return { root, store, context, cleanup }
}
const input = { title: "Implement", description: "Requested work", steps: [{ title: "First" }] }
test("five operations, project filtering, and retry-safe creation", () => {
  const f = fixture()
  try {
    const api = questsAPI(f.store, f.context, async () => ({ sessionID: "worker" }))
    expect(Object.keys(api)).toEqual(["list", "get", "create", "update", "run"])
    const q = api.create(input)
    expect(api.create(input).id).toBe(q.id)
    const other = questsAPI(f.store, { ...f.context, project: { id: "project-b", root: f.root } }, async () => ({ sessionID: "worker" }))
    expect(other.list().items).toHaveLength(0)
    expect(other.list({ allProjects: true }).items).toHaveLength(1)
    expect(() => other.get(q.id)).toThrow("does not belong")
    expect(() => api.update(q.id, { steps: [{ id: q.steps[0].id } as any] })).toThrow("Step state is required")
    expect(api.get(q.id).steps[0].state).toBe("pending")
    expect(api.update(q.id, { reward: "Run the new command", steps: [{ id: q.steps[0].id, state: "done", note: "Observed result" }] }).reward).toBe("Run the new command")
  } finally { f.cleanup() }
})
test("concurrent retries start one worker and preserve an explicit model", async () => {
  const f = fixture()
  try {
    let count = 0, selected = "", release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const api = questsAPI(f.store, f.context, async request => { count++; selected = request.model!; await pending; return { sessionID: "worker" } })
    const q = api.create(input)
    const first = api.run(q.id, { model: "exact/model" })
    expect((await api.run(q.id, { model: "exact/model" })).state).toBe("planned")
    release()
    expect((await first).state).toBe("executing")
    expect(count).toBe(1); expect(selected).toBe("exact/model")
    expect((await api.run(q.id)).sessionID).toBe("worker")
  } finally { f.cleanup() }
})
test("ambiguous launch persists diagnostics and never blindly starts again", async () => {
  const f = fixture()
  try {
    let count = 0
    const api = questsAPI(f.store, f.context, async () => { count++; throw new Error("connection interrupted") })
    const q = api.create(input)
    await expect(api.run(q.id)).rejects.toMatchObject({ code: "DISPATCH_OUTCOME_UNKNOWN" })
    await expect(api.run(q.id)).rejects.toMatchObject({ code: "DISPATCH_OUTCOME_UNKNOWN", message: "connection interrupted" })
    expect(count).toBe(1)
  } finally { f.cleanup() }
})
test("permanent launch errors remain failed with the actual cause", async () => {
  const f = fixture()
  try {
    const api = questsAPI(f.store, f.context, async () => { throw new QuestError("MODEL_UNAVAILABLE", "Configure the exact requested route") })
    const q = api.create(input)
    await expect(api.run(q.id)).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" })
    await expect(api.run(q.id)).rejects.toMatchObject({ code: "DISPATCH_FAILED" })
    expect(api.get(q.id).runs[0].result).toBe("Configure the exact requested route")
  } finally { f.cleanup() }
})
test("non-Git projects have separate stable identity without ledger inference", () => {
  const f = fixture()
  try {
    const a = join(f.root, "a"), b = join(f.root, "b")
    mkdirSync(a); mkdirSync(b)
    expect(projectIdentity(a)).toEqual(projectIdentity(a))
    expect(projectIdentity(a).id).not.toBe(projectIdentity(b).id)
  } finally { f.cleanup() }
})

test("archive preserves reward and requires explicit acceptance or a reason", () => {
  const f = fixture()
  try {
    const api = questsAPI(f.store, f.context, async () => ({ sessionID: "worker" })), q = api.create(input)
    expect(() => api.update(q.id, { archive: { accepted: true } })).toThrow("Finish")
    expect(() => api.update(q.id, { archive: { accepted: false } })).toThrow("Reason")
    api.update(q.id, { reward: "How to use it", steps: [{ id: q.steps[0].id, state: "done" }], archive: { accepted: true } })
    expect(api.list().items).toHaveLength(0)
    expect(api.list({ archived: true }).items[0].reward).toBe("How to use it")
    api.update(q.id, { archive: null })
    expect(api.list().items).toHaveLength(1)
    expect(api.get(q.id).archive).toBeNull()
  } finally { f.cleanup() }
})

test("a worker worktree resolves to its main project identity", () => {
  const f = fixture()
  try {
    const main = join(f.root, "main"), worker = join(main, ".claude", "worktrees", "worker")
    mkdirSync(main)
    const git = (args: string[]) => {
      const result = spawnSync("git", ["-C", main, ...args], { encoding: "utf8", windowsHide: true })
      if (result.status !== 0) throw new Error(result.stderr)
    }
    git(["init"])
    git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture"])
    git(["worktree", "add", "-b", "worker", worker])
    expect(projectIdentity(worker)).toEqual(projectIdentity(main))
  } finally { f.cleanup() }
})

test("typed steps reject cycles and duplicate IDs before changing the ledger",()=>{const f=fixture();try{const api=questsAPI(f.store,f.context,async()=>({sessionID:"worker"}));expect(()=>api.create({...input,steps:[{id:"a",title:"A",needs:["b"]},{id:"b",title:"B",needs:["a"]}]})).toThrow("cycle");expect(()=>api.create({...input,steps:[{id:"a",title:"A"},{id:"a",title:"B"}]})).toThrow("Duplicate");const q=api.create(input);expect(()=>api.update(q.id,{steps:[{id:q.steps[0].id,state:"pending",needs:["later"]},{id:"later",title:"Later",state:"pending",needs:[q.steps[0].id]}]})).toThrow("cycle");expect(api.get(q.id).steps).toHaveLength(1)}finally{f.cleanup()}})

test("artifact updates preserve previously collected artifacts and verification",()=>{const f=fixture();try{const api=questsAPI(f.store,f.context,async()=>({sessionID:"worker"})),q=api.create(input);api.update(q.id,{artifacts:[{name:"Before",path:"before.png"}]});api.update(q.id,{artifacts:[{name:"After",path:"after.png"}]});expect(api.get(q.id).artifacts.map(a=>a.name)).toEqual(["Before","After"]);api.update(q.id,{artifacts:[{name:"After",path:"after.png"}]});expect(api.get(q.id).artifacts).toHaveLength(2)}finally{f.cleanup()}})

import {QuestTracker} from "../quest/tracker"
test("fast terminal event survives a cached index and a late dispatch response failure",async()=>{
 const f=fixture();try{
  const tracker=new QuestTracker(f.store);tracker.sessionIndex()
  const api=questsAPI(f.store,f.context,async r=>{
   f.store.apply(r.quest.id,"session-claimed",{callID:r.runID,runID:r.runID,sessionID:"ses_fast",role:"worker"},"fixture")
   expect(tracker.onHostEvent({type:"session.execution.succeeded",data:{sessionID:"ses_fast"}})).toBe("settled")
   throw new Error("Prompt response was lost")
  })
  const q=api.create(input);await expect(api.run(q.id)).rejects.toThrow("Worker outcome: completed")
  const run=f.store.read(q.id)!.sessions[0];expect(run.state).toBe("completed");expect(run.result).toContain("succeeded");expect(run.evidence.at(-1)).toContain("response was lost");expect((await api.run(q.id)).state).toBe("completed")
 }finally{f.cleanup()}
})

test("recorded route substitution survives terminal outcome in the public contract",()=>{
 const f=fixture();try{const api=questsAPI(f.store,f.context,async()=>({sessionID:"unused"})),q=api.create(input);f.store.apply(q.id,"session-planned",{callID:"fallback",role:"worker"});f.store.apply(q.id,"session-state",{callID:"fallback",state:"executing",routingNote:"Configured fallback primary → alternative: quota unavailable"});f.store.apply(q.id,"session-state",{callID:"fallback",state:"completed",result:"Observed completion"});expect(api.get(q.id).runs[0].routingNote).toContain("primary → alternative");expect(api.get(q.id).runs[0].result).toBe("Observed completion")}finally{f.cleanup()}
})
