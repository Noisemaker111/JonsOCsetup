/**
 * Read-only trace check for docs/quest-surface-authority.md.
 *
 * Part 1: every reader named in the trace document must still exist at the
 * anchor it was traced through (file + symbol), every reader this Quest removed
 * as superseded must stay removed, and the composed read's call sites must be
 * present. Renaming or removing a live reader fails this check until the trace
 * is updated.
 *
 * Part 2: project the live canonical ledger through each reader that can run
 * without a connected host (record, read normalization, board lane, sidebar
 * filter, composed reachability, tool projection, activity rewrite) and report
 * where the same Quest yields different state answers. This talks to no session
 * and writes nothing.
 *
 * Part 3: pin the pure classifier contract (observeWorker/observationFailure)
 * for the reachability distinctions; synthetic inputs, labelled as such.
 *
 * Usage: bun scripts/verify-quest-surface-trace.ts
 * Exit 0: all anchors present, no removed reader back, and the ledger was readable.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readAllQuests } from "../quest/index"
import { questRoot } from "../quest/root"
import { QuestStore } from "../quest/store"
import { questLane, summarizeQuest } from "../quest/board"
import { ownedRuns, readQuestActivity, questActivity, withQuestActivity } from "../quest/activity"
import { questReachability } from "../quest/reachability"
import { toolStatus } from "../quest/tool-projection"
import { latestSessionAttempts } from "../quest/session-lineage"
import { observeWorker, observationFailure } from "../quest/worker-observation.mjs"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (file: string) => existsSync(join(repo, file)) ? readFileSync(join(repo, file), "utf8") : undefined

type Manifest = { surface: string; file: string; anchors: string[] }
const MANIFEST: Manifest[] = [
  { surface: "one state derivation", file: "quest/reachability.ts", anchors: ["export function runReachability", "export function questLifecycle", "export function questReachability", "export function questTruth", "export function questGroup", "export function questCounts", "const SPEC"] },
  { surface: "built report for Jon", file: "quest/quest-report.ts", anchors: ["export function questReport", "export function reportBullet", "const HEADING", "const ID_TOKEN"] },
  { surface: "what wakes the giver", file: "quest/giver-wake.ts", anchors: ["export function completionWake", "export function permissionWake", "export const CAPACITY_FAILURE", "export function reportLine"] },
  { surface: "board route (/quest menu)", file: "quest/tui-active/quest-board.tsx", anchors: ["export function QuestBoard", "export function reachLabel", "export function toneColor", "readAllQuests(root, { includeArchived: true })"] },
  { surface: "sidebar + composer footer", file: "quest/tui-active/quests.tsx", anchors: ["export function QuestStatus", "export function Sidebar", "function useQuests", "sidebar.content", "reviewWorkerPermissions(props.context", "toneColor(questTruth(q,observation).reach.tone)", "questCounts(truths())", "runReachability(row.session,observation)"] },
  { surface: "TUI live observation", file: "quest/tui-active/worker-observation.tsx", anchors: ["export function useWorkerObservations", "context.client.session.get", "context.client.permission.list", "observeWorker(session"] },
  { surface: "TUI worker approvals", file: "quest/tui-active/worker-permissions.ts", anchors: ["export async function reviewWorkerPermissions", "context.client.permission.list({sessionID:id"] },
  { surface: "TUI reviewer choice", file: "quest/tui-active/reviewer-settings.ts", anchors: ["choosePermissionReviewer"] },
  { surface: "board lanes and summaries", file: "quest/board.ts", anchors: ["export function questLane", "export function questBoard", "export function summarizeQuest", "export function boardRows"] },
  { surface: "TUI filters and counts", file: "quest/tui-model.ts", anchors: ["export function filterQuests", "export function filterTruths", "export function questTruths", "truth.confirmed"] },
  { surface: "ledger read (normalized)", file: "quest/index.ts", anchors: ["export function readAllQuests", "normalizeState(row.quest"] },
  { surface: "ledger read (persisted)", file: "quest/store.ts", anchors: ["read(id: string)", "reduceQuest"] },
  { surface: "read normalization", file: "quest/state-machine.ts", anchors: ["export function normalizeState"] },
  { surface: "session lineage", file: "quest/session-lineage.ts", anchors: ["export const TERMINAL_RUN", "export function latestSessionAttempts"] },
  { surface: "reachability classifier", file: "quest/worker-observation.mjs", anchors: ["export function observeWorker", "export function observationFailure", "export async function boundedInspection"] },
  { surface: "tool inspection + reconcile sweep", file: "quest/worker-inspection.ts", anchors: ["export async function inspectWorker", "export function reconcileWorkers", "export async function confirmWorkerIdle", "state:'missing'"] },
  { surface: "activity snapshot", file: "quest/activity.ts", anchors: ["export function observationFromActivity", "export async function readQuestActivity", "export function questActivity", "export function withQuestActivity"] },
  { surface: "host observations", file: "quest/host-observation.ts", anchors: ["export function recordHostObservation", "export function hostExecution", "export async function hostPermissions", "export function hostPermissionDomain"] },
  { surface: "worker returns + permission notice", file: "quest/worker-returns.ts", anchors: ["export class QuestWorkerReturns", "async tick(", "msg_questreturn", "msg_questpermission"] },
  { surface: "permission reviewer", file: "quest/permission-reviewer.ts", anchors: ["export class PermissionReviewer", "'reviewing'|'retrying'|'decided'|'escalated'|'unknown'"] },
  { surface: "permission reply", file: "quest/worker-permissions.ts", anchors: ["export class WorkerPermissions", "export function permissionReplyInput", "export const permissionKey"] },
  { surface: "reviewer settings/pin", file: "quest/reviewer-settings.ts", anchors: ["export function reviewerSettings", "export async function reservePermissionReview"] },
  { surface: "continuation (auto-advance)", file: "quest/continuation.ts", anchors: ["export class QuestContinuation", "async tick(", "private async advance(", "private async advanceParallel(", "private async advanceWorker("] },
  { surface: "start admission", file: "quest/start-request.ts", anchors: ["export function requestQuestStart", "export function requestQuestReview", "export async function consumeQuestStarts", "export function questStartAuthorization"] },
  { surface: "tool service + poll gate", file: "quest/service.ts", anchors: ["export function createQuestService", "const memberships=readAllQuests", "questListResult(result,await readQuestActivity(host,result.records)", "readUserGiver(store.runtime)?.directory!==directory"] },
  { surface: "tool projections", file: "quest/tool-projection.ts", anchors: ["export function toolSummary", "export function toolStatus", "export function toolDetail", "export function toolPlan", "export function questListResult"] },
  { surface: "work supply", file: "quest/adaptive-tools.ts", anchors: ["workSupplyTool", "readQuestActivity(host,quests)"] },
  { surface: "goal facade (project_goal)", file: "quest/goal-public.ts", anchors: ["export function createGoalFacade", "continuation.tick", "workerEvent(sessionID"] },
  { surface: "plugin wiring", file: "quest/server.ts", anchors: ["export function installQuestEvents", "export async function installQuestTools", "export function installQuestCompletionEvidence", "recordHostObservation(ctx.session,event)"] },
  { surface: "giver identity/location", file: "quest/user-giver.ts", anchors: ["export const userGiverID", "export async function refreshUserGiverLocation", "export async function ensureUserGiver"] },
  { surface: "ledger file watch", file: "quest/watcher.ts", anchors: ["export function watchQuests"] },
  { surface: "project scope for the board", file: "quest/board-project.ts", anchors: ["export async function resolveBoardProject", "export function projectQuests", "export const allProjectsByDefault", "export const scopeLabel"] },
  { surface: "project-router tools", file: "project-router/server.ts", anchors: ["project_result", "project_goal", "goals.steer"] },
  { surface: "orchestration completion watchdog", file: "orchestration/orchestration.ts", anchors: ["export async function watchSubagentCompletions", "export async function deliverPendingCompletion"] },
  { surface: "CLI transport", file: "quest/cli.mjs", anchors: ["runQuestCLI"] },
  { surface: "shared workspace guard", file: "quest/shared-guard.ts", anchors: ["export async function installSharedWorkspaceGuard", "export function assertSharedAssignment", "readAllQuests"] },
  { surface: "research source binding", file: "quest/source-binding.ts", anchors: ["export function workerLedgerProject", "readAllQuests"] },
  { surface: "worker capabilities", file: "quest/worker-capabilities.ts", anchors: ["export async function installWorkerCapabilities"] },
  { surface: "worker instruction reads", file: "quest/worker-instructions.ts", anchors: ["export async function installWorkerInstructionReads", "readAllQuests"] },
  { surface: "guidance ownership", file: "quest/session-guidance.ts", anchors: ["export class SessionGuidance", "readAllQuests"] },
  { surface: "cleanup status", file: "quest/cleanup.ts", anchors: ["export function cleanupQuests", "export function cleanupStatus"] },
  { surface: "legacy migration", file: "quest/legacy-ledger-migration.ts", anchors: ["export function migrateLegacyQuestRoots", "readAllQuests"] },
  { surface: "context compaction", file: "models/context-plugin.ts", anchors: ["export async function installAdaptiveContext", "readAllQuests"] },
  { surface: "papercut intake", file: "papercut/papercut-ui.ts", anchors: ["export function createPapercutFollowup", "readAllQuests"] },
  { surface: "incident intake", file: "orchestration/incident-loop.ts", anchors: ["export function intakeIncidents", "readAllQuests"] },
  { surface: "verification harnesses", file: "scripts/quest-ui-audit.ts", anchors: ["readAllQuests"] },
  { surface: "single-giver harness", file: "scripts/verify-single-giver-installed.ts", anchors: ["readAllQuests"] },
  { surface: "ledger projection harness", file: "scripts/verify-project-router-ledger.ts", anchors: ["readAllQuests"] },
]

/** Readers this Quest removed as superseded; a reappearing file is a second authority, not a restore. */
const REMOVED = ["quest/quest-tui.tsx", "quest/host-adapter.ts", "quest/host.ts"]

const anchorChecks = MANIFEST.map((entry) => {
  const content = read(entry.file)
  return {
    surface: entry.surface,
    file: entry.file,
    exists: content !== undefined,
    missing: content === undefined ? entry.anchors : entry.anchors.filter((anchor) => !content.includes(anchor)),
  }
})
const missingAnchors = anchorChecks.filter((check) => !check.exists || check.missing.length)
/** A removed reader that is back is a second authority for the same state. */
const removedPresent = REMOVED.filter((file) => existsSync(join(repo, file)))

/* ── Part 2: the live ledger through each host-free reader ─────────────────── */
const root = questRoot()
const store = new QuestStore(root)
const rows = readAllQuests(root, { includeArchived: true })
const quests = rows.flatMap((row) => row.quest ? [row.quest] : [])
// A host stub with no active() and no event registry: exactly the "no host
// confirmation" input readQuestActivity falls back to. No session is contacted.
const snapshot = await readQuestActivity({}, quests)

const projections = quests.map((q) => {
  const recorded = store.read(q.id)
  const attempts = latestSessionAttempts(q.sessions)
  const active = ownedRuns(q)
  const activity = questActivity(q, snapshot)
  const status = toolStatus(q)
  const rewritten = recorded ? withQuestActivity(recorded, status, snapshot) : undefined
  const summary = summarizeQuest(q)
  // What the board, sidebar and footer draw with the same "no host answer" default the TUI uses.
  const composed = questReachability(q, () => ({ state: "unknown" }))
  const divergences: string[] = []
  if (recorded && recorded.state !== q.state) divergences.push("persisted state " + recorded.state + " vs read normalization " + q.state)
  if ((q.state === "Working" || recorded?.state === "Working") && activity.running === 0) divergences.push("Working recorded with 0 host-confirmed running")
  if (rewritten && rewritten.state !== status.state) divergences.push("tool state rewritten " + status.state + " -> " + rewritten.state)
  if (q.archive === true && q.state !== "Archived") divergences.push("archive flag true while state is " + q.state)
  return {
    id: q.id,
    title: q.title.slice(0, 80),
    persistedState: recorded?.state,
    normalizedState: q.state,
    lane: questLane(q),
    summaryLane: summary.lane,
    sidebarVisible: q.state !== "Archived",
    attempts: attempts.map((run) => ({ run: run.runID ?? run.callID, state: run.state })),
    ownedRuns: active.map((run) => run.state),
    activity: { running: activity.running, unconfirmed: activity.unconfirmed, assigned: activity.assigned, checkedAt: activity.checkedAt },
    toolState: status.state,
    toolStateWithActivity: rewritten?.state,
    composed: { state: composed.state, label: composed.label, tone: composed.tone, confirmed: composed.confirmed },
    divergences,
  }
})
const divergent = projections.filter((row) => row.divergences.length)

/* ── Part 3: classifier contract, synthetic inputs ─────────────────────────── */
const now = Date.now()
const classifier = [
  { label: "saved session, no host confirmation", state: observeWorker({}, {}).state, expect: "unknown" },
  { label: "host confirms active execution", state: observeWorker({}, { active: true }).state, expect: "running" },
  { label: "persisted outcome, host idle", state: observeWorker({ outcome: "succeeded", time: { idle: new Date(now).toISOString(), updated: new Date(now - 1000).toISOString() } }, { active: false }).state, expect: "completed" },
  { label: "pending permission", state: observeWorker({}, { permissions: [{ action: "read", resources: ["docs/x.md"] }] }).state, expect: "blocked" },
  { label: "acknowledged rejection", state: observeWorker({}, { active: false, expected: { state: "cancelled", permissionDecisions: [{ reply: "reject", state: "acknowledged" }] } }).state, expect: "interrupted" },
  { label: "host 404", state: observationFailure({ status: 404 }).state, expect: "missing" },
  { label: "host unreachable", state: observationFailure(new Error("connect failed")).state, expect: "unreachable" },
]
const classifierMismatch = classifier.filter((row) => row.state !== row.expect)

const report = {
  readOnly: true,
  generatedAt: new Date().toISOString(),
  tracedDocument: "docs/quest-surface-authority.md",
  ledger: root,
  anchors: { manifests: anchorChecks.length, verified: anchorChecks.length - missingAnchors.length, missing: missingAnchors, removedPresent },
  ledgerRead: { records: rows.length, readable: quests.length, unreadable: rows.length - quests.length },
  projections,
  divergences: { count: divergent.length, quests: divergent.map((row) => ({ id: row.id, flags: row.divergences })) },
  classifier: { synthetic: true, rows: classifier, mismatches: classifierMismatch },
  ok: missingAnchors.length === 0 && removedPresent.length === 0 && classifierMismatch.length === 0,
}
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.ok ? 0 : 1
