import { rememberReturn } from "./tui-workflow"
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
  rememberReturn(context)
  context.ui.dialog?.clear?.()
  context.ui.router.navigate(route)
  return true
}

/**
 * Whether arriving at home should open the registered Quest Giver.
 *
 * Arriving at home means two different things and they need opposite answers, and the route is
 * `{type:"home"}` either way. On startup with nothing open it means "nothing is open", and opening
 * the registered giver is the whole point: one conversation across all projects. After a
 * conversation has been open it means the user asked for home -- `/new` navigates there
 * (packages/tui/src/app.tsx:697), and so does Esc -- and navigating back is what Jon reported twice
 * as `/new` teleporting him back.
 *
 * The old rule fired on every arrival, because a second conversation carrying the giver agent used
 * to be refused by the context hook, so returning to the existing one was the only outcome that
 * worked. A deliberately opened root conversation now succeeds the binding and says so
 * (quest/user-giver.ts), which is what makes staying at home correct rather than lossy.
 */
export function giverHomeEntry() {
  let opened = false
  return (routeType: string | undefined) => {
    if (routeType === "session") { opened = true; return false }
    return routeType === "home" && !opened
  }
}
