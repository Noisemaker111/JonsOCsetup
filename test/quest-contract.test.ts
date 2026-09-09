import { expect, test } from "bun:test"
import { newQuest } from "../quest/schema"
import { migrateQuestContract, questView } from "../quest/contract"
import { compactQuestDispatch } from "../quest/context"
import { completionMissing } from "../quest/completion"
import { stagesFromSteps } from "../quest/steps"
import { parseQuestMarkdown, serializeQuestMarkdown } from "../quest/cst"
import { createQuestAgentAPI } from "../quest/agent-api"
import { QuestTracker } from "../quest/tracker"
import { QuestStore } from "../quest/store"
import { applyContractMigration, previewContractMigration } from "../quest/contract-migration"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const legacy = () => newQuest({ id: "01j00000000000000000000902", title: "Migrate", objective: "Keep my work", stages: stagesFromSteps(["Implement", "Verify behavior"]), acceptanceCriteria: [{ id: "a", text: "Exercise recovery", satisfied: false }] })
test("migration preserves history and puts acceptance in existing verification", () => {
  const before = legacy(), after = migrateQuestContract(before)
  expect(after.stages).toHaveLength(2)
  expect(after.stages[1].detail).toBe("Exercise recovery")
  expect(after.description).toBe(before.objective)
  expect(after.history).toEqual(before.history)
  expect(before.contractVersion).toBeUndefined()
  expect(migrateQuestContract(after)).toEqual(after)
  expect(parseQuestMarkdown(serializeQuestMarkdown(after)).quest).toEqual(after)
})
test("v2 completion is steps and live runs, without legacy proof gates", () => {
  const q = migrateQuestContract(legacy())
  for (const s of q.stages) s.status = "done"
  expect(completionMissing(q)).toEqual([])
  expect(compactQuestDispatch(q, "Finish")).not.toContain("Proof:")
  expect(questView(q)).not.toHaveProperty("completionPolicy")
  expect(questView(q)).not.toHaveProperty("state")
  q.stages[0].status = "blocked"
  expect(completionMissing(q)).toEqual(["step implement"])
})
test("unknown legacy archive acceptance stays unknown instead of completed", () => {
  const q = legacy(); q.state = "Archived"; q.reason = "Dropped"
  expect(migrateQuestContract(q).archive).toMatchObject({ reason: "Dropped", accepted: false })
})
test("v2 step and worker reports preserve notes without manufacturing tests or proof", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-contract-"))
  try {
    const store = new QuestStore(root), api = createQuestAgentAPI(root)
    const q = store.create(migrateQuestContract(legacy()))
    api.step(q.id, "implement", "done", "Implementation finished")
    new QuestTracker(store).applyWorkerReport(q.id, "STEP verify-behavior: done — Inspected behavior")
    const saved = store.read(q.id)!
    expect(saved.stages[0].note).toBe("Implementation finished")
    expect(saved.stages[1].note).toBe("Inspected behavior")
    expect(saved.stages.flatMap(s => s.proofs)).toEqual([])
    expect(saved.evidence.tests).toEqual([])
    expect(completionMissing(saved)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("migration backs up the original and rejects stale previews", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-migrate-contract-"))
  try {
    const store = new QuestStore(root), q = store.create(legacy())
    const preview = previewContractMigration(store, q.id)
    store.apply(q.id, "patched", { title: "User correction" })
    expect(() => applyContractMigration(store, q.id, preview.revision)).toThrow("changed since")
    const fresh = previewContractMigration(store, q.id)
    const migrated = applyContractMigration(store, q.id, fresh.revision)
    expect(migrated.title).toBe("User correction")
    expect(migrated.contractVersion).toBe(2)
    const backup = JSON.parse(readFileSync(join(store.runtime, "contract-backups", q.id + "-" + fresh.revision + ".json"), "utf8"))
    expect(backup.quest.contractVersion).toBeUndefined()
    expect(backup.quest.title).toBe("User correction")
    expect(backup.raw).toContain("User correction")
    expect(applyContractMigration(store, q.id, migrated.revision).revision).toBe(migrated.revision)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

import { normalizeState } from "../quest/state-machine"
import { questSessionContext } from "../quest/session-context"
test("v2 state ignores legacy review gates while preserving actual step progress",()=>{const q=migrateQuestContract(legacy());q.stages.forEach(s=>s.status="done");q.evidence.review={verdict:"BLOCK"} as any;expect(normalizeState(q).state).toBe("Ready to complete");expect(q.nextAction).toBe("Read the Quest reward")})
test("unknown v2 launches are not timed out into retryable missing state",()=>{const root=mkdtempSync(join(tmpdir(),"quest-v2-unknown-"));try{const store=new QuestStore(root),q=store.create({...legacy(),contractVersion:2});store.apply(q.id,"session-planned",{callID:"uncertain",runID:"uncertain",parentID:"ses_parent"});const tracker=new QuestTracker(store);expect(tracker.reconcileUnbound(0,Date.now()+86400000)).toBe(0);store.apply(q.id,"session-bound",{callID:"uncertain",sessionID:"ses_worker"});expect(questSessionContext("ses_worker",root)).toMatchObject({questID:q.id,parentID:"ses_parent",runID:"uncertain"})}finally{rmSync(root,{recursive:true,force:true})}})

test("migration binds only an explicit project and refuses reassignment",()=>{const root=mkdtempSync(join(tmpdir(),"quest-migration-project-"));try{const store=new QuestStore(root),q=store.create(legacy());expect(previewContractMigration(store,q.id).ownership).toBe("unresolved");const preview=previewContractMigration(store,q.id,root);expect(preview.ownership).toBe("bound");const migrated=applyContractMigration(store,q.id,preview.revision,root);expect(migrated.project?.root).toBe(root);expect(()=>previewContractMigration(store,q.id,tmpdir())).toThrow("reassign")}finally{rmSync(root,{recursive:true,force:true})}})

test("contract migration preserves activity timestamps, session history and archive reason",()=>{
 const root=mkdtempSync(join(tmpdir(),"quest-migration-time-"));try{
 const store=new QuestStore(root),q=legacy();q.createdAt="2025-02-01T00:00:00.000Z";q.updatedAt="2025-02-02T00:00:00.000Z";q.state="Archived";q.reason="Historical decision";const saved=store.create(q);store.apply(saved.id,"archive",{reason:"Historical decision"});const before=store.read(saved.id)!,migrated=applyContractMigration(store,before.id,before.revision)
 expect(migrated.createdAt).toBe(before.createdAt);expect(migrated.updatedAt).toBe(before.updatedAt);expect(migrated.sessions).toEqual(before.sessions);expect(migrated.archive?.reason).toBe(before.reason);expect(migrated.revision).toBe(before.revision+1);expect(store.read(before.id)?.updatedAt).toBe(before.updatedAt)
 }finally{rmSync(root,{recursive:true,force:true})}
})


test("contract migration preserves unbound waiting workers without inventing terminal outcomes",()=>{
 const root=mkdtempSync(join(tmpdir(),"quest-migration-waiting-"));try{
  const store=new QuestStore(root),q=store.create(legacy())
  store.apply(q.id,"session-planned",{callID:"legacy-waiting"})
  store.apply(q.id,"session-state",{callID:"legacy-waiting",state:"waiting"})
  const before=store.read(q.id)!,preview=previewContractMigration(store,q.id)
  const after=applyContractMigration(store,q.id,preview.revision)
  expect(after.sessions).toEqual(before.sessions);expect(after.project).toBeUndefined()
  expect(after.sessions[0].state).toBe("waiting")
  expect(new QuestTracker(store).reconcileUnbound(0,Date.now()+86400000)).toBe(0)
  expect(store.read(q.id)?.sessions).toEqual(before.sessions)
  const backup=JSON.parse(readFileSync(join(store.runtime,"contract-backups",q.id+"-"+before.revision+".json"),"utf8"))
  expect(backup.quest.sessions).toEqual(before.sessions)
 }finally{rmSync(root,{recursive:true,force:true})}
})
