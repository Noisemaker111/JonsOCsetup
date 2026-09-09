import type { Quest } from "./types"
import { LANE_LABEL, boardRows, questBoard, questLane } from "./board"
import { latestSessionAttempts } from "./session-lineage"
import { artifactChain, artifactChainSummary, artifactLine } from "./artifacts"
export type TuiRoute = { type: "overview"; filter?: string } | { type: "detail"; questID: string }
export type Frame = { width: number; lines: string[] }
export type QuestAction = "Accept" | "Execute" | "Complete" | "Turn in" | "Resume" | "Open session" | "Cancel"
export type QuestFilter = "open" | "all" | "ready" | "active" | "attention" | "verifying" | "waiting" | "archived"
export const QUEST_FILTERS: { id: QuestFilter; label: string }[] = [
  { id: "open", label: "Open" }, { id: "ready", label: "Turn in" }, { id: "active", label: "Active" },
  { id: "attention", label: "Needs attention" }, { id: "verifying", label: "Verifying" },
  { id: "waiting", label: "Waiting/new" }, { id: "archived", label: "Archived" }, { id: "all", label: "All states" },
]
export function filterQuests(quests: Quest[], filter: QuestFilter): Quest[] {
  const live = (q: Quest) => latestSessionAttempts(q.sessions).some(s => s.state === "executing")
  return quests.filter(q => filter === "all" || (filter === "archived" ? questLane(q) === "archived" : questLane(q) !== "archived" && (
    filter === "open" || filter === "active" && live(q) || filter === "ready" && questLane(q) === "ready" ||
    filter === "attention" && questLane(q) === "attention" || filter === "verifying" && questLane(q) === "verifying" ||
    filter === "waiting" && ["unassigned", "assigned"].includes(questLane(q)) && !live(q)
  )))
}
/** Lane truth, not one raw non-archived total. Active means a worker executing; attention is reported separately. Done-but-gated (Verifying) has its own bucket; idle assigned/waiting quests are not active. Archived never appears here. */
export function questLaneCounts(quests: Quest[]): { toTurnIn: number; active: number; attention: number; verifying: number; waitingNew: number } {
  const lanes = questBoard(quests)
  const live = (q: Quest) => latestSessionAttempts(q.sessions).some((s) => s.state === "executing")
  const active = quests.filter((q) => q.state !== "Archived" && live(q)).length
  return {
    toTurnIn: lanes.ready.length,
    active,
    attention: lanes.attention.length,
    verifying: lanes.verifying.length,
    waitingNew: [...lanes.unassigned, ...lanes.assigned].filter((q) => !live(q)).length,
  }
}
export function questIndicator(quests: Quest[]): string {
  const { toTurnIn, active, attention, verifying, waitingNew } = questLaneCounts(quests)
  return `${toTurnIn} to turn in, ${active} active${attention ? `, ${attention} need attention` : ""}, ${verifying} verifying, ${waitingNew} waiting/new`
}
export function formatQuestLine(q: Quest): string {
  const turnIn = q.state === "Ready to complete" || q.state === "Complete" ? " · Ready for you to turn in" : ""
  return `${q.state} ${q.title}${turnIn} (${q.executingCount} running, ${q.deliverables.filter((d) => d.status !== "done").length} left)`
}
export function renderFrame(quests: Quest[], route: TuiRoute, width: number): Frame {
  const lines = route.type === "detail"
    ? detail(quests.find((q) => q.id === route.questID), width)
    : [questIndicator(quests), ...boardRows(quests, { filter: route.filter }).map((row) => row.kind === "header" ? row.label : formatQuestLine(row.quest))]
  return { width, lines: lines.map((x) => x.slice(0, width)) }
}
export function detail(q: Quest | undefined, width: number): string[] {
  if (!q) return ["Quest not found"]
  const workers = q.sessions.flatMap((s) => [`Worker: ${s.role} · ${s.state}`, `  model=${s.model ?? "?"} call=${s.callID} task=${s.taskID ?? "?"} session=${s.openCodeSessionId ?? s.sessionID ?? "unbound"}`, `  claim=${s.worktree ?? "none"} parent=${s.parentID ?? s.parentSessionID ?? "none"} heartbeat=${s.lastHeartbeatAt ?? "none"} lease=${s.leaseExpiresAt ?? "none"}`, `  dependency=${s.dependency ? `${s.dependency.status}:${s.dependency.sessionID}:${s.dependency.file}:${s.dependency.reason}` : "none"}`, `  command=${s.commandSummary ?? "not recorded"} progress=${s.evidence.at(-1) ?? "none"} result=${s.result ?? "none"}`])
  const claims = q.claims.map((claim) => `Claim: ${claim.state} · ${claim.sessionID ?? "unbound"} · ${claim.include.join(", ") || "none"}`)
  const chain = artifactChain([...q.evidence.artifacts])
  const artifactLines = [
    `ARTIFACTS (${q.evidence.artifacts.length})${chain.length > 1 ? ` chain: ${artifactChainSummary(chain)}` : ""}`,
    ...chain.map((artifact) => `  ${artifactLine(artifact)}`),
  ]
  return [
    `Quest: ${q.title}`,
    `Lane: ${LANE_LABEL[questLane(q)]}`,
    `State: ${q.state}`,
    `Owner: ${q.owner ?? "unassigned"} · integration=${q.integrationOwner ?? "unassigned"}`,
    `Reason: ${q.reason}`,
    `Next: ${q.nextAction}`,
    `Actions: [Accept] [Execute] [Complete] [Turn in]`,
    `Sessions: ${q.sessions.length} (${q.executingCount} executing)`,
    ...workers,
    ...claims,
    `Requirements: ${q.missingRequirements.join(", ") || "none"}`,
    `Evidence: history=${q.history.length} commits=${q.evidence.commits.length} tests=${q.evidence.tests.length} artifacts=${q.evidence.artifacts.length}`,
    ...artifactLines,
    q.state === "Ready to complete" || q.state === "Complete" ? "Turn in: explicit user action required" : "",
  ].filter(Boolean).map((x) => x.slice(0, width))
}
