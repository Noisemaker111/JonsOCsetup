import type { Quest } from "./types"
import { QuestWorkspaces } from "./workspaces"
import { redact } from "./privacy"

export function workspaceRunID(id: string): boolean { return /^[a-z0-9-]{1,80}$/.test(id) }

/** Historical host call IDs are evidence, never filesystem names. */
export function questChanges(q: Quest, manager: QuestWorkspaces) {
  return q.sessions.map(session => {
    const runID = session.runID ?? session.callID
    const empty = { runID, available: false, files: [] as any[], commits: [] as string[] }
    if (!workspaceRunID(runID)) return { ...empty, note: "Historical attempt · no owned workspace identity recorded" }
    try {
      const owned = manager.get(runID)
      if (!owned) return { ...empty, note: "No owned workspace recorded for this attempt" }
      if (owned.questID !== q.id || owned.projectID !== q.project?.id) throw new Error("Workspace ownership does not match this Quest and project")
      const w = manager.collect(runID)
      return { ...empty, ...w.changes, workspace: w.path, integration: w.integration ?? null }
    } catch (error) { return { ...empty, error: redact(error instanceof Error ? error.message : String(error), 1000) } }
  })
}
