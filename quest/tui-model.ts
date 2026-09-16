import type { Quest, QuestSession } from "./types"
import { questLane } from "./board"
import { latestSessionAttempts } from "./session-lineage"
import { runReachability } from "./reachability"
export type QuestFilter = "open" | "all" | "ready" | "active" | "attention" | "verifying" | "waiting" | "archived"
export const QUEST_FILTERS: { id: QuestFilter; label: string }[] = [
  { id: "open", label: "Open" }, { id: "ready", label: "Turn in" }, { id: "active", label: "Active" },
  { id: "attention", label: "Needs attention" }, { id: "verifying", label: "Verifying" },
  { id: "waiting", label: "Waiting/new" }, { id: "archived", label: "Archived" }, { id: "all", label: "All states" },
]
export type WorkerObservation = (run: QuestSession) => any
const unobserved: WorkerObservation = () => ({state: "unknown"})
/**
 * "Active" means the owning host confirmed an execution, never that a saved row says executing.
 * The same mapper the board, sidebar and footer draw from decides it, so the filter counts and the
 * rows they count can no longer disagree about one Quest.
 */
const liveQuest = (q: Quest, observation: WorkerObservation) => latestSessionAttempts(q.sessions).some(s => runReachability(s, observation).confirmed)
export function filterQuests(quests: Quest[], filter: QuestFilter, observation: WorkerObservation = unobserved): Quest[] {
  const live = (q: Quest) => liveQuest(q, observation)
  return quests.filter(q => filter === "all" || (filter === "archived" ? questLane(q) === "archived" : questLane(q) !== "archived" && (
    filter === "open" || filter === "active" && live(q) || filter === "ready" && questLane(q) === "ready" ||
    filter === "attention" && questLane(q) === "attention" || filter === "verifying" && questLane(q) === "verifying" ||
    filter === "waiting" && ["unassigned", "assigned"].includes(questLane(q)) && !live(q)
  )))
}
