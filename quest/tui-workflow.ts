import {QuestWorkerReturns} from './worker-returns'
import {ensureUserGiver,userGiverID,adoptQuestGiver,giverContext} from './user-giver'
import {QuestStore as GiverStore} from './store'
import {questRoot} from './root'
import { randomUUID } from "node:crypto"
import { questsAPI } from "./api"
import { boardProject, resolveBoardProject } from "./board-project"
import { startQuestRun } from "./runtime"
import { configuredDispatchPolicyFile } from "../models/dispatch-planner"
import { activeSessionID } from "../scripts/runtime-contract.mjs"
import { latestSessionAttempts } from "./session-lineage"
import { nextQuestStep } from "./steps"
import { redact } from "./privacy"
import type { Quest, QuestSession } from "./types"
import type { QuestStore } from "./store"
import { createSignal } from "solid-js"

const unwrap = (value: any) => value?.data ?? value
export const uncertainRuns = (q: Quest) => latestSessionAttempts(q.sessions).filter(s => ["planned", "executing", "waiting", "blocked"].includes(s.state))
export function startDisabled(q: Quest): string | undefined {
  if (!q.project) return "Project ownership unresolved; inspect history with the Quest Giver"
  if (q.state === "Archived") return "Reopen this Quest first"
  if (q.contractVersion !== 2) return "Legacy Quest: ask the giver to plan current steps"
  if (!giverID(q)) return "Create or resume the recorded Quest Giver conversation first"
  if (uncertainRuns(q).length) return "Active or unknown launch exists; check progress before starting another worker"
  if (nextQuestStep(q)?.status !== "pending") return "No eligible pending step; resolve dependencies or blockers with the giver"
}
export function turnInDisabled(q: Quest): string | undefined {
  if (uncertainRuns(q).length) return "Active or unknown runs must be resolved first"
  if (!q.stages.length || q.stages.some(s => s.status !== "done")) return "Finish all requested steps before accepting the reward"
}

/** Explicit persisted ownership only; never guess the current chat is the giver. */
export function giverID(q: Quest): string | undefined {
  return userGiverID()??(q.integrationOwner?.startsWith("ses_") ? q.integrationOwner : undefined)
}
export async function verifiedGiver(context: any, q: Quest) {
  const id = giverID(q)
  if (!id) throw new Error("No Quest Giver conversation is recorded for this legacy Quest")
  if (q.sessions.some(s => (s.openCodeSessionId ?? s.sessionID) === id)) throw new Error("Recorded giver is a worker session; ownership needs inspection")
  const row = unwrap(await context.client.session.get({ sessionID: id }))
  if (row?.id !== id) throw new Error("The recorded Quest Giver conversation is missing or deleted")
  if (userGiverID()!==id && (!q.project || boardProject(row.location?.directory).id !== q.project.id)) throw new Error("Giver project cannot be verified; no unrelated conversation was opened")
  if (row.parentID ?? row.parent_id) throw new Error("Recorded giver is a child conversation; ownership needs inspection")
  return row
}
export function snapshotRoute(context: any): any {
  const r = context?.ui?.router?.current?.()
  return r?.type === "session" ? { type: "session", sessionID: r.sessionID } : r?.type === "plugin" ? { type: "plugin", id: r.id, name: r.name, data: r.data } : { type: "home" }
}
// Session routes cannot carry plugin return data. Keep one explicit return link in chrome.
const returnRoutes = new WeakMap<object, any>()
const boardViews = new WeakMap<object, any>()
export function rememberBoardView(context:object,data:{questID?:string;filter:string;allProjects:boolean}) { boardViews.set(context,data) }
const [returnVersion, setReturnVersion] = createSignal(0)
export function returnToQuest(context: any) { const r = returnRoutes.get(context); if (r) context.ui.router.navigate(r) }
export function hasQuestReturn(context: any) { returnVersion(); return returnRoutes.has(context) }
export function rememberReturn(context:any,q?:Quest) {
  const route=snapshotRoute(context)
  if(route.type==="plugin" && route.name==="quests") route.data={...route.data,...(boardViews.get(context)??{}),...(q?{questID:q.id,...(q.archive?{filter:"archived"}:{})}:{})}
  returnRoutes.set(context,route)
  setReturnVersion(v=>v+1)
}
export async function talkToGiver(context: any, q: Quest) {
  const row = await verifiedGiver(context, q)
  rememberReturn(context,q)
  context.ui.dialog?.clear?.()
  context.ui.router.navigate({ type: "session", sessionID: row.id })
}
export async function createGiver(context: any, store?: QuestStore, q?: Quest) {
  const ledger=store??new GiverStore(questRoot()),row=await ensureUserGiver(ledger,context.client.session,activeSessionID(context),context.location?.directory??context.state?.path?.directory??process.cwd())
  if(q)adoptQuestGiver(ledger,q.id)
  rememberReturn(context,q)
  context.ui.dialog?.clear?.()
  context.ui.router.navigate({type:'session',sessionID:row.id})
}

export async function workflowAPI(context: any, store: QuestStore, q: Quest) {
  const sessionID = giverID(q) ?? activeSessionID(context)
  if (!sessionID) throw new Error("Create or resume the Quest Giver conversation first")
  const row = await verifiedGiver(context, q)
  const trusted=giverContext(store,row,randomUUID(),q.id)
  if(trusted.giverDirectory)adoptQuestGiver(store,q.id)
  else {const current=await resolveBoardProject(context,activeSessionID(context));if(current.id!==trusted.project.id)throw new Error("Open the Quest's owning project to change or start work")}
  const start=startQuestRun(store,context.client.session,{policyFile:configuredDispatchPolicyFile()}),returns=new QuestWorkerReturns(store,context.client.session)
  return questsAPI(store,trusted,async input=>{await returns.watch(input);return start(input)})
}
export async function nudgeGiver(context: any, q: Quest) {
  const row = await verifiedGiver(context, q)
  const text = await context.ui.dialog.prompt({ title: "Nudge Quest Giver", placeholder: "What should the giver check or change?" })
  if (typeof text !== "string" || !text.trim()) return
  await context.client.session.prompt({ sessionID: row.id, text: `Quest ${q.id}: ${text.trim()}\nInspect existing run outcomes before dispatch. Do not duplicate active or unknown launches. Retain the user's exact route preference.` })
  await talkToGiver(context, q)
}
export function runDetails(q: Quest, session: QuestSession): string {
  const clean = (s: string) => redact(s, 4000).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f]/g, "")
  return [
    `Attempt ${session.attempt} · ${session.state}`,
    `Run / historical call: ${session.runID ?? session.callID}`,
    `Updated: ${session.updatedAt || "unknown"}`,
    `Heartbeat: ${session.lastHeartbeatAt ?? "not recorded"}`,
    `Worker session: ${session.openCodeSessionId ?? session.sessionID ?? "not confirmed"}`,
    `Quest Giver: ${giverID(q) ?? "ownership not recorded"}`,
    `Cause / result: ${clean(session.result ?? session.evidence.at(-1) ?? "No cause was recorded; do not infer a provider or quota failure")}`,
    session.state === "planned" ? "Launch outcome may be unknown. Check the host and giver; do not retry blindly." : session.state === "failed" ? "Inspect this cause with the giver. Start work is available only after active/unknown runs and step blockers are resolved." : "Check progress reads recorded state; it does not invent a worker outcome.",
  ].join("\n")
}
