/**
 * @core-prevents simultaneous Automatic Quest worker updates collapsing into one giver turn instead of each retaining a queued response
 * @core-observed Cycle 2 of the September 13 economical-routing gate promoted two worker returns 2 ms apart after one execution claim, then recorded no assistant response before its unchanged 240 s deadline.
 */
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { questsAPI } from "../quest/api"
import { physicalDirectory, projectIdentity } from "../quest/project"
import { QuestStore } from "../quest/store"
import { QuestWorkerReturns } from "../quest/worker-returns"
import { saveUserGiver } from "../quest/giver-registry.mjs"

test("each terminal worker return queues and explicitly wakes its own giver turn", async () => {
  // Native sessions bind the physical directory. Windows runner TEMP can use
  // an alias, so the fixture must establish the same host-derived identity.
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), "quest-worker-return-")))
  const store = new QuestStore(root)
  const giver = {
    id: "ses_giver",
    agent: "quest-giver",
    model: { providerID: "provider", id: "model" },
    location: { directory: root },
  }
  const prompts: any[] = []
  const host = {
    get: async () => giver,
    prompt: async (input: any) => {
      prompts.push(input)
      return { id: input.id, sessionID: input.sessionID }
    },
  } as any
  const context: any = {
    sessionID: giver.id,
    requestID: "create",
    directory: root,
    project: projectIdentity(root),
  }
  const returns = new QuestWorkerReturns(store, host, "wake-test")
  try {
    const work = [
      { runID: "a".repeat(26), title: "Deliver the weather worker finding", description: "Return the completed weather inspection to its giver." },
      { runID: "b".repeat(26), title: "Surface the dependency audit result", description: "Notify the giver that its dependency audit completed." },
    ]
    for (const [index, item] of work.entries()) {
      const { runID } = item
      const created = questsAPI(store, { ...context, requestID: `create-${index}` }, async () => ({ sessionID: "unused" })).create({
        title: item.title,
        description: item.description,
        steps: [{ id: "report", title: "Report the completed worker outcome" }],
      })
      const quest = store.read(created.id)!
      await returns.watch({ quest, runID, stepIDs: ["report"], context })
      store.apply(quest.id, "session-claimed", {
        callID: runID,
        runID,
        sessionID: `ses_worker_${index}`,
        parentID: giver.id,
        role: "worker",
        deliverables: ["report"],
      }, "test")
      store.apply(quest.id, "stage-state", { stageID: "report", status: "done", evidence: `worker ${index + 1} done` }, "test")
      store.apply(quest.id, "session-state", { callID: runID, state: "completed", result: `worker ${index + 1} completed` }, "test")
    }

    const damagedDirectory=join(store.runtime,'worker-returns')
    mkdirSync(damagedDirectory,{recursive:true})
    const damagedPath=join(damagedDirectory,'0'.repeat(26)+'.json'), damaged=Buffer.alloc(618)
    writeFileSync(damagedPath,damaged)
    await returns.tick()
    await new QuestWorkerReturns(store,host,'reopened-wake-test').tick()
    expect(readFileSync(damagedPath)).toEqual(damaged)

    expect(prompts).toHaveLength(2)
    expect(prompts.map((prompt) => ({
      delivery: prompt.delivery,
      resume: prompt.resume,
      return: prompt.metadata?.questWorkerReturn,
    }))).toEqual([
      { delivery: "queue", resume: true, return: true },
      { delivery: "queue", resume: true, return: true },
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test.each(['before admission', 'after admission'])('failed worker notification retries %s with the same native message identity', async (failure) => {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), 'quest-return-retry-'))), store = new QuestStore(root)
  const giver = {id:'ses_return_retry',agent:'quest-giver',model:{providerID:'provider',id:'model'},location:{directory:root}}
  const project = projectIdentity(root), runID = 'c'.repeat(26), admitted = new Map<string, any>(), attempts:any[] = []
  let lookups=0
  const host = {get:async()=>{lookups++;return giver},prompt:async(input:any)=>{
    attempts.push(input)
    if(attempts.length===1&&failure==='before admission')throw Error('Database admission unavailable')
    // Installed native Session.prompt reconciles the stable ID before admission.
    if(!admitted.has(input.id))admitted.set(input.id,input)
    if(attempts.length===1)throw Error('Acknowledgement unavailable after admission')
    return admitted.get(input.id)
  }} as any
  try {
    saveUserGiver(store.runtime,{state:'bound',sessionID:giver.id,directory:root,model:giver.model})
    const quest=store.create({id:'d'.repeat(26),title:'Return the failed inspection',objective:'Surface a failed worker without duplicating its notification',contractVersion:2,project,integrationOwner:giver.id,stages:[{id:'probe',title:'Inspect the configured host',status:'pending',needs:[]}]})
    const context={project,directory:root,giverDirectory:root,sessionID:giver.id,requestID:'start'}
    const returns=new QuestWorkerReturns(store,host,'retry-test')
    await returns.watch({quest,runID,stepIDs:['probe'],context})
    store.apply(quest.id,'session-claimed',{callID:runID,runID,sessionID:'ses_failed_worker',parentID:giver.id,role:'worker',deliverables:['probe']},'test')
    await new QuestWorkerReturns(store,host,'next-generation').tick()
    expect(lookups).toBe(1) // Another generation cannot manage this active run.
    store.apply(quest.id,'session-state',{callID:runID,state:'failed',result:'Provider rejected an incomplete tool response'},'test')
    await returns.tick()
    // Reopening the coordinator must recover persisted uncertainty, not only memory.
    await new QuestWorkerReturns(store,host,'next-generation').tick()
    await new QuestWorkerReturns(store,host,'retry-test').tick()
    expect(attempts).toHaveLength(2)
    expect(new Set(attempts.map(p=>p.id)).size).toBe(1)
    expect(admitted.size).toBe(1)
    expect(attempts.every(p=>p.resume===true&&p.delivery==='queue')).toBe(true)
    expect(store.read(quest.id)?.sessions[0]?.state).toBe('failed')
  } finally {rmSync(root,{recursive:true,force:true})}
})
