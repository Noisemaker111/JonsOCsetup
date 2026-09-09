import { inspectWorker } from "../worker-inspection"
/** @jsxImportSource @opentui/solid */
import { Show, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { Quest } from "../types"
import type { QuestStore } from "../store"
import { redact } from "../privacy"
import { nextQuestStep } from "../steps"
import { uncertainRuns, createGiver, giverID, nudgeGiver, runDetails, startDisabled, talkToGiver, turnInDisabled, workflowAPI } from "../tui-workflow"
import { C, activate, openWorkerSession } from "./quest-board"

function RunDetailDialog(props: { context: any; message: string }) {
  const height = Math.max(5, Math.min(18, Math.floor((props.context?.renderer?.height ?? 40) * 0.45)))
  return <box flexDirection="column" padding={1} gap={1}>
    <text fg={C.cyan} attributes={TextAttributes.BOLD}>Run details · recorded cause and host check</text>
    <scrollbox height={height}><text fg={C.text} wrapMode="word">{props.message}</text></scrollbox>
    <text fg={C.cyan} onMouseUp={(e:any)=>activate(e,()=>props.context.ui.dialog.clear())}>Esc · close · scroll for full details</text>
  </box>
}

export async function inspectRun(context: any, q: Quest, callID: string) {
  const session = q.sessions.find(s => s.callID === callID)
  if (!session) throw new Error("Attempt no longer available; refresh the Quest")
  const action = await context.ui.dialog.select({ title: "Run details · " + session.state, placeholder: "Choose details, worker session or giver", options: [
    { value: "details", title: "Failure reason / run details", description: redact(session.result ?? "Timing, state and recorded cause"), details: runDetails(q, session) },
    { value: "worker", title: "Open worker session", disabled: !(session.openCodeSessionId ?? session.sessionID), description: (session.openCodeSessionId ?? session.sessionID) || "No session was confirmed" },
    { value: "giver", title: "Talk to Quest Giver", description: giverID(q) ?? "Ownership is not recorded", disabled: !giverID(q) },
  ] })
  if (action === "details") {
    const id=session.openCodeSessionId??session.sessionID
    let host=JSON.stringify(await inspectWorker(context.client.session,session),null,2)
    const message=runDetails(q,session)+"\n\nHost check: "+host+"\nObserved: "+new Date().toISOString()
    context.ui.dialog.show(()=> <RunDetailDialog context={context} message={message} />)
  }
  if (action === "worker") await openWorkerSession(context, session)
  if (action === "giver") await talkToGiver(context, q)
}
export async function inspectProgress(context: any, q: Quest) {
  if (!q.sessions.length) return context.ui.dialog.alert({ title: "Check progress", message: "No runs recorded. " + q.stages.filter(s=>s.status==="done").length + "/" + q.stages.length + " steps done." })
  const picked = await context.ui.dialog.select({ title: "Check progress · recorded runs", placeholder: "Select a run for reason, timing and session", options: q.sessions.map(s => ({ value: s.callID, title: `${s.state} · attempt ${s.attempt} · ${s.model ?? "model unknown"}`, description: redact(s.result ?? "No terminal result recorded"), footer: s.updatedAt })) })
  if (picked) await inspectRun(context, q, picked)
}

export function WorkflowActions(props: { context: any; store: QuestStore; quest: () => Quest; refresh: () => void }) {
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const actions = () => [
    { id: "giver", key: "g", title: "Continue in chat", reason: props.quest().project ? undefined : "Project ownership unresolved" },
    { id: "create", key: "c", title: "Create giver session", reason: props.quest().project ? undefined : "Project ownership unresolved" },
    { id: "start", key: "s", title: "Start worker session", reason: startDisabled(props.quest()) },
    { id: "progress", key: "p", title: "Check progress / agent log" },
    { id: "nudge", key: "n", title: "Nudge giver", reason: giverID(props.quest()) ? undefined : "Create a giver conversation first" },
    { id:"archive", key:"z", title:"Archive Quest", reason:uncertainRuns(props.quest()).length?"Reconcile active or uncertain workers before archiving":undefined },
    { id: "turn", key: "t", title: props.quest().archive ? "Reopen Quest" : "Review and accept", reason: props.quest().archive ? undefined : turnInDisabled(props.quest()) },
  ]
  const perform = async (id: string) => {
    if (busy()) return
    const action = actions().find(a=>a.id===id)!
    if (action.reason) { setMessage(action.reason); return }
    setBusy(true); setMessage("")
    try {
      const q = props.store.read(props.quest().id)!
      if (id === "giver") { if (giverID(q)) await talkToGiver(props.context, q); else await createGiver(props.context, props.store, q) }
      if (id === "create") await createGiver(props.context, props.store, q)
      if (id === "progress") { props.refresh(); await inspectProgress(props.context, q) }
      if (id === "nudge") await nudgeGiver(props.context, q)
      if (id === "start") {
        const reason = startDisabled(q); if (reason) throw new Error(reason)
        const model = nextQuestStep(q)?.commandID ? "" : await props.context.ui.dialog.prompt({ title: "Start worker session", placeholder: "Exact provider/model#reasoning; blank uses configured policy" })
        if (model === undefined || model === null) return
        if (typeof model !== "string") throw new Error("Host returned an unsupported route input; no worker was started")
        const api = await workflowAPI(props.context, props.store, q)
        const run = await api.run(q.id, typeof model === "string" && model.trim() ? { model: model.trim() } : {})
        setMessage(`Work ${run.state}. Open Activity for details.`)
      }
      if (id === "archive") {
        if(await props.context.ui.dialog.confirm({title:"Archive Quest",message:"Archive without accepting completion? All work and history are retained.",label:"Archive"})===true)(await workflowAPI(props.context,props.store,q)).update(q.id,{archive:{accepted:false,reason:"User archived from Quest board"}})
      }
      if (id === "turn") {
        const ok = await props.context.ui.dialog.confirm({ title: action.title, message: q.archive ? "Reopen this Quest and retain its history?" : "Have you reviewed the reward and accept the completed work? This explicitly turns in the Quest; it does not publish changes.", label: action.title })
        if (ok !== true) return
        const api = await workflowAPI(props.context, props.store, q)
        api.update(q.id, { archive: q.archive ? null : { accepted: true, reason: "User explicitly accepted the Quest reward in the board" } })
      }
      props.refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const primary = () => actions().find(a => a.id === (props.quest().archive || !turnInDisabled(props.quest()) ? "turn" : "giver"))!
  const more = async () => {
    const choices = actions().filter(a => a.id !== primary().id && (!props.quest().archive || a.id === "progress" || a.id === "giver" && giverID(props.quest())))
    const picked = await props.context.ui.dialog.select({ title:"Quest actions", options:choices.map(a=>({value:a.id,title:a.title,description:a.reason})) })
    if(picked) await perform(picked)
  }
  props.context?.keymap?.layer?.(() => ({ mode:"global", commands:[
    ...actions().map(a=>({id:"quests.action."+a.id,title:a.title,group:"Quests",bind:a.key,run:()=>void perform(a.id)})),
    {id:"quests.action.more",title:"More Quest actions",bind:"m",run:()=>void more()},
  ] }))
  return <box flexDirection="column" flexShrink={0}>
    <box flexDirection="row" flexWrap="wrap" gap={2}>
      <text fg={busy()?C.muted:C.cyan} attributes={TextAttributes.BOLD} onMouseUp={(e:any)=>activate(e,()=>void perform(primary().id))}>[{primary().key}] {primary().title}</text>
      <text fg={C.cyan} onMouseUp={(e:any)=>activate(e,()=>void more())}>[m] More</text>
      <text fg={C.muted} onMouseUp={(e:any)=>activate(e,()=>void perform("archive"))}>[z] Archive Quest</text>
      <text fg={C.green} onMouseUp={(e:any)=>activate(e,()=>void perform("turn"))}>[t] {props.quest().archive?"Reopen":"Turn in Quest"}</text>
    </box>
    <Show when={busy() || message()}><text fg={C.orange} wrapMode="word">{busy()?"Waiting for host…":message()}</text></Show>
  </box>
}
