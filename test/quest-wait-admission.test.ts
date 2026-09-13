/**
 * @core-prevents snapshot reads waiting on their own workers, and explicit waits outliving their bound or missing a real change
 * @core-observed 420 `quest get` calls landed on 216 distinct (session, quest) pairs in the session database, one Code Mode execute issuing 24 of them for the same run (2026-09-11).
 */
import { test, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QuestStore } from "../quest/store"
import { questsAPI } from "../quest/api"
import { awaitQuestChange, observedState } from "../quest/wait"

const context = (requestID: string): any => ({ project: { id: "project-a", root: join("C", "projects", "project-a") }, sessionID: "ses_giver", requestID })
const started = async () => ({ sessionID: "ses_worker" })
const request = { title: "Append one marker line to the scratch document", description: "Append exactly one marker line to docs/scratch.md.", steps: [{ title: "Append the marker" }] }

function dispatched() {
  const root = mkdtempSync(join(tmpdir(), "quest-wait-"))
  const store = new QuestStore(root)
  const created = questsAPI(store, context("call-1"), started).create(request)
  const quest = store.read(created.id)!
  store.apply(quest.id, "session-claimed", { callID: "run-1", runID: "run-1", sessionID: "ses_worker", parentID: "ses_giver", role: "worker", deliverables: quest.stages.map((s) => s.id) }, "test")
  store.apply(quest.id, "session-state", { callID: "run-1", state: "executing" }, "test")
  return { root, store, questID: quest.id }
}

/** @core-observed September 13 the installed CLI shared the giver's polling memory: a worker's get waited for itself and then returned QUEST_UNCHANGED. */
test("public reads return unchanged active snapshots without waiting for their own worker", async () => {
  const {physicalDirectory}=await import('../quest/project')
  const {createQuestService}=await import('../quest/service')
  const {serveQuestAPI}=await import('../quest/api-server')
  const {createQuestClient}=await import('../quest/client.mjs')
  const root=physicalDirectory(mkdtempSync(join(tmpdir(),'quest-snapshot-'))),store=new QuestStore(root)
  let dispose:()=>void=()=>{},endpoint:any,questID:string|undefined
  const host={get:async({sessionID}:any)=>({id:sessionID,agent:'quest-giver',location:{directory:root}})} as any
  const service=createQuestService(store,host,{directory:root,onDispose:fn=>{dispose=fn},startRun:async()=>{throw Error('No worker dispatch in this API check')}})
  try {
    endpoint=await serveQuestAPI(store,service,root)
    // Bind the host-owned giver before the public listener can serve it.
    const created=await service.call('create',request,{sessionID:'ses_giver',id:'create'})
    questID=created.id
    const q=store.read(questID!)!
    store.apply(q.id,'session-claimed',{callID:'run',runID:'run',sessionID:'ses_worker',parentID:'ses_giver',role:'worker',deliverables:q.stages.map(s=>s.id)},'check')
    store.apply(q.id,'session-state',{callID:'run',state:'executing'},'check')
    for(let i=0;i<3;i++) {
      const result=await createQuestClient({endpoint}).get({id:q.id},{signal:AbortSignal.timeout(1000)})
      expect(result.progress.done).toBe(0)
      expect(result.waited).toBeUndefined()
      expect(store.read(q.id)!.sessions[0].state).toBe('executing')
    }
  } finally {
    if(questID)store.apply(questID,'session-state',{callID:'run',state:'completed'},'check')
    dispose();endpoint?.dispose();rmSync(root,{recursive:true,force:true})
  }
},10000)

test("the wait ends on the run actually settling, and never outlives its bound when the worker goes silent", async () => {
  const { root, store, questID } = dispatched()
  try {
    const read = () => store.read(questID)
    const fingerprint = observedState(read()!)
    const settle = setTimeout(() => store.apply(questID, "session-state", { callID: "run-1", state: "failed", result: "Worker reported a blocker" }, "test"), 300)
    const woken = await awaitQuestChange({ read, fingerprint, deadline: Date.now() + 20000 })
    clearTimeout(settle)
    expect(woken.changed).toBe(true)
    expect(woken.quest!.sessions[0].state).toBe("failed")
    expect(woken.milliseconds).toBeLessThan(20000)
    // A worker that dies stops writing; silence must expire, not hold the giver.
    const silent = await awaitQuestChange({ read, fingerprint: observedState(read()!), deadline: Date.now() + 1200 })
    expect(silent.changed).toBe(false)
    expect(silent.milliseconds).toBeLessThan(6000)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
