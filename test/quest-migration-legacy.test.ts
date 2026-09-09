import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverKnownQuestRoots, migrateLegacyQuestRoots } from "../quest/legacy-ledger-migration"
import { QuestStore } from "../quest/store"

const id = (suffix: string) => `01j00000000000000000000${suffix}`

test("versioned cross-project migration backs up every record and reruns idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-migration-ledger-"))
  const database = join(root, "opencode.db")
  const store = new QuestStore(root)
  try {
    store.create({ id: id("001"), title: "notification", objective: '<task id="ses_child" state="completed"><summary>done</summary></task>' })
    store.create({ id: id("002"), title: "Worker", objective: "Worker", requestFingerprint: "fingerprint", sessions: [{ callID: "call_1", sessionID: "ses_worker", role: "worker", state: "executing", evidence: ["unique evidence"], deliverables: [], attempt: 1, updatedAt: new Date().toISOString() }] })
    const explicitGoal = store.create({ id: id("003"), title: "Explicit goal", objective: "Implement durable backups", requestFingerprint: "goal", deliverables: [{ id: "d1", title: "backup", status: "pending" }], sessions: [{ callID: "call_2", sessionID: "ses_goal", role: "worker", state: "executing", evidence: [], deliverables: ["d1"], attempt: 1, updatedAt: new Date().toISOString() }] })
    store.create({ id: id("004"), title: "Could be a goal", objective: "Could be a goal from an old chat" })
    store.create({ id: id("005"), title: "who are you", objective: "who are you" })
    writeFileSync(join(root, ".opencode", "quests", `${id("006")}--broken.md`), "not a Quest record\n")
    const autoAdmitted = store.create({ id: id("007"), title: "ordinary request", objective: "ordinary request" })
    const db = new Database(database)
    db.exec("create table session_message (session_id text not null, type text not null, time_created integer not null, data text not null)")
    db.query("insert into session_message values (?, ?, ?, ?)").run("ses_origin", "user", Date.parse(autoAdmitted.createdAt), JSON.stringify({ text: autoAdmitted.objective }))
    db.query("insert into session_message values (?, ?, ?, ?)").run("ses_explicit", "user", Date.parse(explicitGoal.createdAt), JSON.stringify({ text: explicitGoal.objective }))
    db.close()

    const preview = migrateLegacyQuestRoots([root], false, database).projects[0]
    expect(preview.counts).toMatchObject({ scanned: 7, parsed: 6, invalid: 1, kept: 1, ambiguous: 2, highConfidenceJunk: 4, legacyMessageJunk: 2, taskLaunchJunk: 1, taskNotificationJunk: 1, changed: 0, alreadyMigrated: 0 })
    expect(preview.decisions.find((row) => row.questID === id("001"))?.sessionIDs).toContain("ses_child")
    expect(preview.decisions.find((row) => row.questID === id("007"))).toMatchObject({ classification: "legacy-message-junk", reason: "legacy auto-admitted SQLite user message", sessionIDs: ["ses_origin"] })
    expect(preview.decisions.find((row) => row.questID === id("006"))?.parseErrors?.length).toBeGreaterThan(0)
    expect(existsSync(preview.backupManifest)).toBe(true)
    expect(store.read(id("001"))?.state).toBe("Waiting")

    const applied = migrateLegacyQuestRoots([root], true, database).projects[0]
    expect(applied.counts).toMatchObject({ changed: 4, alreadyMigrated: 0 })
    expect(store.read(id("001"))?.state).toBe("Archived")
    expect(store.read(id("002"))).toMatchObject({ state: "Archived", sessions: [{ sessionID: "ses_worker", evidence: ["unique evidence"] }] })
    expect(store.read(id("003"))).toMatchObject({ state: "Working", sessions: [{ sessionID: "ses_goal" }] })
    expect(store.read(id("004"))?.state).toBe("Waiting")
    expect((store.read(id("001"))?.extensions.legacyQuestMigration as any)).toMatchObject({ version: 1, tombstone: true, classification: "task-notification-junk", sessionIDs: ["ses_child"] })

    const revision = store.read(id("001"))?.revision
    const manifest = readFileSync(applied.backupManifest, "utf8")
    const replay = migrateLegacyQuestRoots([root], true, database).projects[0]
    // Archived quests are physically relocated out of .opencode/quests/, so the ledger
    // scan no longer sees them on replay; there is nothing left to reclassify as junk.
    expect(replay.counts).toMatchObject({ scanned: 3, changed: 0, alreadyMigrated: 0 })
    expect(store.read(id("001"))?.revision).toBe(revision)
    expect(readFileSync(applied.backupManifest, "utf8")).toBe(manifest)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a retry completes a tombstone that was interrupted before archive", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-migration-retry-"))
  const store = new QuestStore(root)
  try {
    const q = store.create({ id: id("010"), title: "hello", objective: "hello" })
    const preview = migrateLegacyQuestRoots([root], false).projects[0]
    const decision = preview.decisions[0]
    store.apply(q.id, "patched", { extensions: { legacyQuestMigration: { version: 1, classification: decision.classification, confidence: "high", reason: decision.reason, sourceHash: decision.sourceHash, sessionIDs: [], linkDigests: [], tombstone: true } } })
    expect(store.read(q.id)?.state).toBe("Waiting")
    expect(migrateLegacyQuestRoots([root], true).projects[0].counts.changed).toBe(1)
    expect(store.read(q.id)?.state).toBe("Archived")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("discovery combines known database projects and explicit roots", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-migration-discovery-"))
  const project = join(root, "project")
  const sessionProject = join(root, "session-project")
  const additional = join(root, "additional")
  const database = join(root, "opencode.db")
  try {
    for (const directory of [project, sessionProject, additional]) new QuestStore(directory).create({ id: id(directory === project ? "020" : directory === sessionProject ? "021" : "022"), title: "goal", objective: "goal" })
    const db = new Database(database)
    db.exec("create table project (worktree text not null); create table session_v2 (directory text not null)")
    db.query("insert into project (worktree) values (?)").run(project)
    db.query("insert into session_v2 (directory) values (?)").run(sessionProject)
    db.close()
    expect(discoverKnownQuestRoots(database, [additional])).toEqual([additional, project, sessionProject].sort())
  } finally { rmSync(root, { recursive: true, force: true }) }
})
