import type { Quest, QuestSession } from "./types"
import { questTruth, questCounts, type QuestCounts, type QuestTruth, type ObservationOf } from "./reachability"
export type QuestFilter = "open" | "all" | "ready" | "active" | "attention" | "verifying" | "waiting" | "archived"
export const QUEST_FILTERS: { id: QuestFilter; label: string }[] = [
  { id: "open", label: "Open" }, { id: "ready", label: "Turn in" }, { id: "active", label: "Active" },
  { id: "attention", label: "Needs attention" }, { id: "verifying", label: "Verifying" },
  { id: "waiting", label: "Waiting/new" }, { id: "archived", label: "Archived" }, { id: "all", label: "All states" },
]
export type WorkerObservation = ObservationOf
const unobserved: WorkerObservation = () => ({ state: "unknown" })

/**
 * Every filter reads the one derived state, so the filter counts, the rows they count, the footer
 * and the CLI's `counts` cannot disagree. "Active" means the owning host confirmed an execution,
 * never that a saved row says executing.
 */
export function questTruths(quests: Quest[], observation: WorkerObservation = unobserved): QuestTruth[] {
  return quests.map(q => questTruth(q, observation))
}

/** The counts every surface shows, from the same records and the same observation. */
export function filterCounts(quests: Quest[], observation: WorkerObservation = unobserved): QuestCounts {
  return questCounts(questTruths(quests, observation))
}

const matches = (truth: QuestTruth, filter: QuestFilter) => {
  if (filter === "all") return true
  if (filter === "archived") return truth.lane === "archived"
  if (truth.lane === "archived") return false
  if (filter === "open") return true
  if (filter === "active") return truth.confirmed
  if (filter === "ready") return truth.lane === "ready"
  if (filter === "attention") return truth.lane === "attention"
  if (filter === "verifying") return truth.lane === "verifying"
  if (filter === "waiting") return ["unassigned", "assigned"].includes(truth.lane) && !truth.confirmed
  return false
}

export function filterQuests(quests: Quest[], filter: QuestFilter, observation: WorkerObservation = unobserved): Quest[] {
  return questTruths(quests, observation).filter(truth => matches(truth, filter)).map(truth => truth.quest)
}

/** Filter a set of truths already derived once, so a board frame derives each Quest a single time. */
export function filterTruths(truths: QuestTruth[], filter: QuestFilter): QuestTruth[] {
  return truths.filter(truth => matches(truth, filter))
}

export type { QuestSession }
