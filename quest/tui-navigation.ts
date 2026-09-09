import { nativeSessionNavigation, type WorkerIdentity } from "../orchestration/dispatch"
import type { QuestSession } from "./types"
import { resolve } from "node:path"

function identityFromSession(session: QuestSession): WorkerIdentity | undefined {
  const model = session.model?.split("/")
  const providerID = session.providerID ?? (model && model.length > 1 ? model.shift() : undefined)
  const modelID = session.modelID ?? (model && model.length ? model.join("/") : undefined)
  const runtime = session.runtime ?? (session.harness ? "claude-code" : "native")
  const parentID = session.parentID ?? session.parentSessionID
  const runID = session.runID ?? session.callID
  const task = session.task ?? session.taskDescription ?? session.taskID ?? "Task"
  if (!providerID || !modelID || !parentID) return
  return {
    agentRole: runtime === "claude-code" ? "claude-code" : session.agentRole === "explore" ? "explore" : "build",
    providerID,
    modelID,
    runtime,
    openCodeSessionId: session.openCodeSessionId ?? session.openCodeSessionID ?? (runtime === "native" ? session.sessionID : undefined),
    runtimeSessionId: session.runtimeSessionId ?? session.harnessSessionID,
    parentID,
    runID,
    task,
  }
}

export async function navigateQuestSession(context: any, session: QuestSession): Promise<boolean> {
  const identity = identityFromSession(session)
  const id = session.openCodeSessionId ?? session.openCodeSessionID ?? session.sessionID
  if (!id?.startsWith("ses_") || session.harness || session.runtime === "claude-code") return false
  const get = context?.client?.session?.get
  if (typeof get !== "function") return false
  let result: any
  try { result = await get({ sessionID: id }) } catch { return false }
  const row = result?.data ?? result
  // V2 creates root sessions in owned worktrees, not native child sessions.
  // Verify the exact persisted session AND worktree rather than inventing a parent.
  const worktree = session.worktree ?? (session.scope as any)?.worktree
  const directory = row?.location?.directory
  const same = typeof worktree === "string" && typeof directory === "string" && (process.platform === "win32" ? resolve(worktree).toLowerCase() === resolve(directory).toLowerCase() : resolve(worktree) === resolve(directory))
  const route = row?.id === id && same
    ? { type: "session" as const, sessionID: row.id }
    : identity ? nativeSessionNavigation(identity, { id: row?.id, parentID: row?.parentID ?? row?.parent_id }) : undefined
  if (!route || typeof context?.ui?.router?.navigate !== "function") return false
  context.ui.router.navigate(route)
  return true
}
