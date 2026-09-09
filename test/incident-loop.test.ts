import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  detectPapercutIncidents, detectPluginHealthIncidents, detectLedgerIncidents, detectTuiLogIncidents,
  intakeIncidents, incidentRequestFingerprint, type Incident,
} from "../orchestration/incident-loop"
import { QuestStore } from "../quest/store"
import { completionMissing } from "../quest/completion"
import { runQuestCommand } from "../quest/commands"
import { applyGateOf, approveApplyGate, denyApplyGate, requestApplyApproval, touchesSystemOwnedPaths } from "../orchestration/apply-gate"

function fixtureDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// ---- Detectors ---------------------------------------------------------------

test("recurring papercut crossing the threshold becomes one incident", () => {
  const { dir, cleanup } = fixtureDir("incident-papercut-")
  const file = join(dir, "papercuts.json")
  const record = {
    id: "pc_test1", schema: 1, family: "git", fingerprint: "test1fingerprint", repo: "incident-test-repo", cwd: dir, worktree: dir,
    platform: "win32", shell: "powershell", command: "git status", errorSignature: "timeout-or-no-response",
    failure: { status: "no-response", excerpt: "no output for 120s", at: new Date().toISOString() },
    occurrences: 3, lastSeen: new Date().toISOString(), state: "unresolved", confidence: 0.5, solutions: [],
  }
  writeFileSync(file, JSON.stringify({ schema: 1, records: [record] }))
  const incidents = detectPapercutIncidents(2, file, "incident-test-repo")
  expect(incidents).toHaveLength(1)
  expect(incidents[0].source).toBe("papercut")
  expect(incidents[0].occurrences).toBe(3)
  // Below threshold: not incident-worthy yet.
  expect(detectPapercutIncidents(5, file, "incident-test-repo")).toHaveLength(0)
  cleanup()
})

test("plugin-health quarantine is always incident-worthy, deduplicated by path+phase+error", () => {
  const { dir, cleanup } = fixtureDir("incident-plugin-health-")
  const file = join(dir, "plugin-health.json")
  const entry = { path: "plugin-bootstrap", phase: "schema", error: "plugin directory has no TUI entrypoint (tui.tsx); the host skips it silently", action: "quarantined", timestamp: new Date().toISOString() }
  writeFileSync(file, JSON.stringify([entry, { ...entry, timestamp: new Date(Date.now() - 1000).toISOString() }]))
  const incidents = detectPluginHealthIncidents(file)
  expect(incidents).toHaveLength(1)
  expect(incidents[0].occurrences).toBe(2)
  expect(incidents[0].source).toBe("plugin-health")
  cleanup()
})

test("ledger: quota-failover notifications are excluded, real failures cross threshold, completion-delivery failures are counted", () => {
  const { dir, cleanup } = fixtureDir("incident-ledger-")
  const file = join(dir, "orchestration.jsonl")
  const lines = [
    { v: 1, at: new Date(Date.now()-1000).toISOString(), kind: "notification", parentID: "ses_p", callID: "c1", childID: "ch1", state: "failed", description: "Worker crashed: undefined is not a function" },
    { v: 1, at: new Date(Date.now()-1000).toISOString(), kind: "notification", parentID: "ses_p", callID: "c2", childID: "ch2", state: "failed", description: "Worker crashed: undefined is not a function" },
    { v: 1, at: new Date(Date.now()-1000).toISOString(), kind: "notification", parentID: "ses_p", callID: "c3", childID: "ch3", state: "failed", description: "Usage reached — opencode-go. Falling over to openai/gpt-5.6-luna-fast." },
    { v: 1, at: new Date(Date.now()-1000).toISOString(), kind: "completion-delivery", parentID: "ses_p", callID: "c4", deliveryKey: "k1", deliveryState: "failed" },
    { v: 1, at: new Date(Date.now()-1000).toISOString(), kind: "completion-delivery", parentID: "ses_p", callID: "c5", deliveryKey: "k2", deliveryState: "failed" },
  ]
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
  const incidents = detectLedgerIncidents(2, file)
  expect(incidents.find((i) => i.family === "notification")).toBeTruthy()
  expect(incidents.find((i) => i.family === "notification")!.occurrences).toBe(2)
  expect(incidents.find((i) => i.family === "completion-delivery")).toBeTruthy()
  expect(incidents.find((i) => i.family === "completion-delivery")!.occurrences).toBe(2)
  // Quota-failover text never contributes a third occurrence to the real-failure bucket.
  cleanup()
})

test("tui log pattern crossing the threshold becomes one incident", () => {
  const { dir, cleanup } = fixtureDir("incident-tui-")
  const file = join(dir, "tui-probe.log")
  writeFileSync(file, ["["+new Date().toISOString()+"]", "setup keymap.layer FAILED: Keymap.Provider is missing", "setup keymap.layer FAILED: Keymap.Provider is missing"].join("\n"))
  const incidents = detectTuiLogIncidents([{ file, pattern: /Keymap\.Provider is missing/i, family: "tui-probe", title: "keymap.layer setup fails" }], 2)
  expect(incidents).toHaveLength(1)
  expect(incidents[0].occurrences).toBe(2)
  cleanup()
})

// ---- Auto-intake dedup --------------------------------------------------------

test("one recurring error class produces one Quest, not one per occurrence or per pass", () => {
  const { dir, cleanup } = fixtureDir("incident-intake-")
  const store = new QuestStore(dir)
  const incident: Incident = { fingerprint: "abc123", source: "papercut", family: "git", title: "Recurring git failure", detail: "git status :: timeout", occurrences: 3, lastSeen: new Date().toISOString(), refs: ["pc_1"] }
  const first = intakeIncidents(dir, [incident], store)
  expect(first).toHaveLength(1)
  expect(first[0].created).toBe(true)
  // A second detection pass over the *same* incident (e.g. occurrences grew from 3 to 4) must not create a duplicate Quest.
  const second = intakeIncidents(dir, [{ ...incident, occurrences: 4 }], store)
  expect(second).toHaveLength(1)
  expect(second[0].created).toBe(false)
  expect(second[0].quest.id).toBe(first[0].quest.id)
  expect(first[0].quest.requestFingerprint).toBe(incidentRequestFingerprint(incident))
  cleanup()
})

// ---- Apply gate: ask before apply for system-owning code ----------------------

test("touchesSystemOwnedPaths recognizes quest/orchestration/models/plugins, not ordinary app code", () => {
  expect(touchesSystemOwnedPaths(["quest/reducer.ts"])).toBe(true)
  expect(touchesSystemOwnedPaths(["orchestration/incident-loop.ts"])).toBe(true)
  expect(touchesSystemOwnedPaths(["models/capacity-registry.ts"])).toBe(true)
  expect(touchesSystemOwnedPaths(["plugins-active/favorite-router.ts"])).toBe(true)
  expect(touchesSystemOwnedPaths(["src/app/component.tsx"])).toBe(false)
})

test("a fix touching system-owning code cannot complete without Jk's recorded approval", () => {
  const { dir, cleanup } = fixtureDir("incident-gate-")
  const store = new QuestStore(dir)
  const id = "01j00000000000000000000010"
  store.create({ id, title: "Fix quota reconciliation", objective: "test", kind: "fix", claims: [{ repo: dir, include: ["orchestration/orchestration-ledger.ts"], exclude: [], state: "active" }] })
  let q = store.read(id)!
  expect(applyGateOf(q).status).toBe("not-requested")
  expect(completionMissing(q)).toContain("apply gate approval (Jk must explicitly approve this system-owning fix before it can complete)")
  expect(() => runQuestCommand(store, "complete", id)).toThrow(/completion policy failed/)

  q = requestApplyApproval(store, id, ["orchestration/orchestration-ledger.ts"], "proposed fix ready for review")
  expect(applyGateOf(q).status).toBe("pending-approval")
  expect(completionMissing(q).some((m) => m.startsWith("apply gate approval"))).toBe(true)

  q = denyApplyGate(store, id, "not the right fix")
  expect(applyGateOf(q).status).toBe("denied")
  expect(completionMissing(q).some((m) => m.startsWith("apply gate approval"))).toBe(true)

  q = approveApplyGate(store, id, "Jk", "looks correct")
  expect(applyGateOf(q).status).toBe("approved")
  expect(applyGateOf(q).approvedBy).toBe("Jk")
  expect(completionMissing(q).some((m) => m.startsWith("apply gate"))).toBe(false)
  cleanup()
})

test("approveApplyGate refuses an empty approver — it can never silently self-approve", () => {
  const { dir, cleanup } = fixtureDir("incident-gate-approver-")
  const store = new QuestStore(dir)
  const id = "01j00000000000000000000011"
  store.create({ id, title: "x", objective: "x" })
  expect(() => approveApplyGate(store, id, "")).toThrow(/explicit approver/)
  cleanup()
})

test("ordinary app-code Quests are never blocked by the apply gate", () => {
  const { dir, cleanup } = fixtureDir("incident-gate-appcode-")
  const store = new QuestStore(dir)
  const id = "01j00000000000000000000012"
  store.create({ id, title: "Add a button", objective: "test", claims: [{ repo: dir, include: ["src/app/Button.tsx"], exclude: [], state: "active" }] })
  expect(completionMissing(store.read(id)!).some((m) => m.startsWith("apply gate"))).toBe(false)
  cleanup()
})

// ---- Seed the loop with today's five real incidents, end to end ---------------

test("five recorded fixture incidents produce deduplicated diagnosis Quests", () => {
  const { dir, cleanup } = fixtureDir("incident-seed-")
  const papercutFile = join(dir, "papercuts.json")
  const pluginHealthFile = join(dir, "plugin-health.json")
  const ledgerFile = join(dir, "orchestration.jsonl")
  const probeLog = join(dir, "tui-probe.log")

  // 1) Session reconciliation mislabeling quota-failover terminals as failed (now excluded by the reducer's own pattern; confirm the loop does not misfire on it).
  writeFileSync(ledgerFile, [
    { v: 1, at: new Date(Date.now()-1000).toISOString(), kind: "completion-delivery", parentID: "ses_a", callID: "d1", deliveryKey: "k1", deliveryState: "failed" },
    { v: 1, at: new Date(Date.now()-1000).toISOString(), kind: "completion-delivery", parentID: "ses_a", callID: "d2", deliveryKey: "k2", deliveryState: "failed" },
    { v: 1, at: new Date(Date.now()-1000).toISOString(), kind: "completion-delivery", parentID: "ses_a", callID: "d3", deliveryKey: "k3", deliveryState: "failed" },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n")

  // 2) plugin-health quarantine: "plugin directory has no TUI entrypoint".
  writeFileSync(pluginHealthFile, JSON.stringify([
    { path: "plugin-bootstrap", phase: "schema", error: "plugin directory has no TUI entrypoint (tui.tsx); the host skips it silently", action: "quarantined", timestamp: new Date(Date.now()-1000).toISOString() },
  ]))

  // 3) tui-probe.log: Keymap.Provider failure.
  writeFileSync(probeLog, ["["+new Date().toISOString()+"]", "setup keymap.layer FAILED: Keymap.Provider is missing", "setup keymap.layer FAILED: Keymap.Provider is missing"].join("\n"))

  // 4) recurring papercut: bun test hangs / no-response.
  writeFileSync(papercutFile, JSON.stringify({ schema: 1, records: [{
    id: "pc_seed1", schema: 1, family: "node-dependencies", fingerprint: "seedfingerprint1", repo: "seed-repo", cwd: dir, worktree: dir,
    platform: "win32", shell: "powershell", command: "bun test", errorSignature: "timeout-or-no-response",
    failure: { status: "no-response", excerpt: "no output for 120s", at: new Date(Date.now()-1000).toISOString() },
    occurrences: 2, lastSeen: new Date(Date.now()-1000).toISOString(), state: "unresolved", confidence: 0.5, solutions: [],
  }] }))

  // 5) worker lanes universally lack the quest tool — no on-disk signal exists for this; it is fed in manually, as the Quest asked ("seed the loop with today's five incidents").
  const manualIncident: Incident = {
    fingerprint: "worker-lane-missing-quest-tool", source: "manual", family: "quest-tool",
    title: "Worker lanes universally lack the quest tool (ToolSearch finds no quest action)",
    detail: "Step reporting silently degrades to giver reconciliation instead of landing on the Quest directly.",
    occurrences: 1, lastSeen: new Date().toISOString(), refs: [],
  }

  const detected = [
    ...detectLedgerIncidents(2, ledgerFile),
    ...detectPluginHealthIncidents(pluginHealthFile),
    ...detectTuiLogIncidents([{ file: probeLog, pattern: /Keymap\.Provider is missing/i, family: "tui-probe", title: "keymap.layer setup fails: Keymap.Provider is missing" }], 2),
    ...detectPapercutIncidents(2, papercutFile, "seed-repo"),
    manualIncident,
  ]
  expect(detected).toHaveLength(5)

  const store = new QuestStore(dir)
  const firstPass = intakeIncidents(dir, detected, store)
  expect(firstPass).toHaveLength(5)
  expect(firstPass.every((r) => r.created)).toBe(true)
  expect(new Set(firstPass.map((r) => r.quest.id)).size).toBe(5)
  for (const r of firstPass) expect(r.quest.kind).toBe("investigation")

  // Second pass over the same five (occurrences may have grown) must not create duplicates.
  const secondPass = intakeIncidents(dir, detected, store)
  expect(secondPass.every((r) => r.created === false)).toBe(true)
  expect(secondPass.map((r) => r.quest.id).sort()).toEqual(firstPass.map((r) => r.quest.id).sort())

  cleanup()
})

test("stale, invalid and future plugin observations cannot repopulate intake",()=>{
 const {dir,cleanup}=fixtureDir("incident-window-");try{const file=join(dir,"health.json"),now=Date.now(),row={path:"plugin",phase:"schema",error:"failed",action:"quarantined"};writeFileSync(file,JSON.stringify([0,now-10000,now+1].map(at=>({...row,timestamp:new Date(at).toISOString()})).concat([{...row,timestamp:"invalid"}])));expect(detectPluginHealthIncidents(file,5000,now)).toHaveLength(0)}finally{cleanup()}
})
test("explicit synthetic failures do not become runtime incidents",()=>{
 const {dir,cleanup}=fixtureDir("incident-synthetic-");try{const file=join(dir,"ledger.jsonl");writeFileSync(file,[1,2].map(i=>JSON.stringify({v:1,at:new Date().toISOString(),kind:"notification",state:"failed",parentID:"fixture",callID:String(i),description:"Fixture failed",provenance:"synthetic"})).join("\n"));expect(detectLedgerIncidents(2,file)).toHaveLength(0)}finally{cleanup()}
})
test("archived incidents suppress old observations but a later recurrence can create work",()=>{
 const {dir,cleanup}=fixtureDir("incident-archive-");try{const store=new QuestStore(dir),incident:Incident={fingerprint:"repeat",source:"manual",family:"runtime",title:"Repeat",detail:"Observed failure",occurrences:2,lastSeen:new Date(Date.now()-1000).toISOString(),refs:[]};const first=intakeIncidents(dir,[incident],store)[0];store.apply(first.quest.id,"archive",{reason:"Reviewed old incident"});expect(intakeIncidents(dir,[incident],store)[0].created).toBe(false);expect(intakeIncidents(dir,[incident],store)[0].quest.id).toBe(first.quest.id);const later={...incident,lastSeen:new Date(Date.parse(store.read(first.quest.id)!.updatedAt)+1000).toISOString()};expect(intakeIncidents(dir,[later],store)[0].created).toBe(true)}finally{cleanup()}
})

test("undated TUI history is not relabeled as a new incident on every scan",()=>{
 const {dir,cleanup}=fixtureDir("incident-undated-");try{const file=join(dir,"tui.log");writeFileSync(file,"failed\nfailed\n");expect(detectTuiLogIncidents([{file,pattern:/failed/,family:"fixture",title:"Failure"}],2)).toHaveLength(0)}finally{cleanup()}
})
