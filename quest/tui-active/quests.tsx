import { ensureUserGiver, userGiverID } from "../user-giver"
import { QuestStore } from "../store"
import { questRoot } from "../root"
import { useWorkerObservations } from "./worker-observation"
/** @jsxImportSource @opentui/solid */
import {workspaceSettings,setWorkspaceMode} from "../workspace-settings"
import { Plugin } from "../../tui-legacy"
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { questIndicator, filterQuests, QUEST_FILTERS, type QuestFilter } from "../tui-model"
import { boardProject, projectQuests, resolveBoardProject } from "../board-project"
import { activeSessionID } from "../../scripts/runtime-contract.mjs"
import { createGiver, hasQuestReturn, returnToQuest } from "../tui-workflow"
import type { Quest, QuestSession } from "../types"
import { watchQuests } from "../watcher"
import { progressGlyph, questProgress } from "../steps"
import { C, QuestBoard, activate, footerWidth, openWorkerSession, projectRoot, quests, workerLabel } from "./quest-board"

/**
 * Snapshot of the route live right now, shaped the way the host's own router
 * hands it back on `navigate()` — `{type:"session",sessionID}` /
 * `{type:"plugin",id,name,data?}` / `{type:"home"}`. Mirrors the
 * `opencode.diffs` plugin's own pre-navigate snapshot (confirmed against the
 * live beta-19086 binary): drop everything but what a future `navigate()`
 * needs, so a stale `data.returnRoute` we captured to nest inside doesn't ride
 * along.
 */
function currentRoute(context: any): unknown {
  const current = typeof context?.ui?.router?.current === "function" ? context.ui.router.current() : undefined
  if (!current || current.type === "home") return { type: "home" }
  if (current.type === "session") return { type: "session", sessionID: current.sessionID }
  return { type: "plugin", id: current.id, name: current.name, ...(current.data ? { data: { ...current.data } } : {}) }
}

/**
 * The host composer IS the Quest Giver conversation: quest-giver is the
 * default agent for intake. Worker sessions retain their assigned native agent;
 * the giver has the normal slash commands
 * and one context for every Quest. The board is a view: `/quests`, the footer
 * count, or a sidebar row opens it; Esc returns to the chat. It never opens
 * itself at startup and never carries its own chat.
 *
 * Esc used to hardcode `router.navigate({type:"home"})`, which always opened
 * a *new* chat instead of returning to whatever was live (a subagent session,
 * another plugin route) — every entry point here snapshots that route as
 * `data.returnRoute` before navigating in, so the board's back action can
 * navigate back to it instead.
 */
function openBoard(context: any, questID?: string, filter: QuestFilter = "all") {
  if (typeof context?.ui?.router?.navigate === "function") {
    context.ui.router.navigate({ type: "plugin", name: "quests", data: { ...(questID ? { questID } : {}), filter, returnRoute: currentRoute(context) } })
    return
  }
  context?.ui?.dialog?.show?.(() => <QuestBoard context={context} initialQuestID={questID} />)
}

/**
 * Every ses_… a Quest knows about, across every Quest, newest first. Backs
 * the /session picker below.
 */
function allWorkerSessions(context: any, projectID?: string, allProjects = false): Array<{ quest: Quest; session: QuestSession }> {
  const root = projectRoot(context)
  return projectQuests(quests(root),projectID,allProjects)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .flatMap((quest) => quest.sessions.map((session) => ({ quest, session })))
}

/**
 * The host renders chat transcript text itself — a plugin has no hook to
 * turn a bare "ses_…" a model prints in its own prose into a click target
 * (confirmed against the beta-19086 host binary: no href/internal-link
 * scheme reaches transcript text). So when Jk sees an id in chat, the
 * closest real thing is this picker: `/session`, then paste or type the id
 * (or any part of the task/model) to filter and jump — the same
 * navigateQuestSession→router.navigate({type:"session"}) path the board's
 * clickable rows use, with the same graceful fallback if the session
 * turns out to be an external harness or is gone.
 */
/** A key that always round-trips back to one row, even for sessions with no OpenCode id yet. */
function sessionKey(quest: Quest, session: QuestSession): string {
  return `${quest.id}:${session.callID}`
}

async function openSessionPicker(context: any, allProjects = Boolean(userGiverID())) {
  const dialog = context?.ui?.dialog
  if (typeof dialog?.select !== "function") return
  const project=await resolveBoardProject(context,activeSessionID(context))
  const rows = allWorkerSessions(context,project.id,allProjects)
  const byKey = new Map(rows.map((row) => [sessionKey(row.quest, row.session), row]))
  const options = [...byKey.entries()].map(([key, { quest, session }]) => {
    const id = session.openCodeSessionId ?? session.sessionID
    const task = session.task ?? session.taskDescription ?? "delegated work"
    return {
      value: key,
      title: `${workerLabel(session)} · ${task}`,
      category: quest.title,
      searchText: `${id ?? ""} ${workerLabel(session)} ${task}`,
      description: id,
      footer: session.state.toUpperCase(),
    }
  })
  const picked = await dialog.select({ title: `Worker sessions · ${allProjects?"All projects":"current project"}`, placeholder: "Paste or search a ses_… id", options:[{value:"scope",title:allProjects?"Show current project":"Show All projects",description:project.error},...options] })
  if (!picked) return
  if(picked==="scope")return openSessionPicker(context,!allProjects)
  const row = byKey.get(picked)
  if (row) await openWorkerSession(context, row.session)
}

async function chooseWorkspaceMode(context:any) {
 const current=workspaceSettings().workspaceMode
 const choice=await context.ui.dialog.select({title:"Quest workspace mode · all future runs",options:[{value:"worktree",title:"Separate worktrees"+(current==="worktree"?" (current)":"")},{value:"shared",title:"Shared project checkout"+(current==="shared"?" (current)":"")}]})
 if(choice==="worktree"||choice==="shared")setWorkspaceMode(choice)
}
function Commands(props: { context: any }) {
  // Native New Session returns home. Reuse the one giver before a new prompt can create another.
  createEffect(() => {
    const route=props.context.ui.router.current()
    if(route?.type!=="home")return
    // Let the native composer create the first session and retain its focus/model.
    if(!userGiverID()&&!quests(projectRoot(props.context)).some(q=>q.integrationOwner?.startsWith("ses_")))return
    let cancelled=false
    onCleanup(()=>{cancelled=true})
    void ensureUserGiver(new QuestStore(questRoot()),props.context.client.session,undefined,props.context.location?.directory??props.context.state?.path?.directory??process.cwd()).then(row=>{
      if(!cancelled&&props.context.ui.router.current()?.type==="home")props.context.ui.router.navigate({type:"session",sessionID:row.id})
    }).catch(error=>{if(!cancelled)void props.context.ui.dialog.alert({title:"Your Quest Giver",message:String(error)})})
  })
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      { id: "quests.workspace-mode", title: "Quest workspace mode (global)", group: "System", palette: true, slash: { name: "quest-workspace" }, run: () => chooseWorkspaceMode(props.context).catch(error=>props.context.ui.dialog.alert({title:"Quest workspace mode",message:String(error)})) },
      { id: "quests.open", title: "Open Quest board", group: "System", palette: true, suggested: true, slash: { name: "quests", aliases: ["quest", "board"] }, run: () => openBoard(props.context) },
      { id: "quests.session", title: "Jump to worker session", group: "System", palette: true, suggested: false, slash: { name: "session", aliases: ["jump"] }, run: () => openSessionPicker(props.context) },
      { id: "quests.giver", title: "Go to your Quest Giver", group: "Quests", palette: true, suggested: true, slash: { name: "giver" }, bind: "ctrl+alt+g", run: () => createGiver(props.context).catch(error => props.context.ui.dialog.alert({title:"Quest Giver unavailable",message:String(error)})) },
      { id: "quests.new", title: "Plan a Quest with your giver", group: "Quests", palette: true, slash: { name: "quest-new" }, run: () => createGiver(props.context).catch(error => props.context.ui.dialog.alert({title:"Start Quest",message:String(error)})) },
      { id: "quests.return", title: "Return to Quest", group: "Quests", palette: true, slash: { name: "quest-back" }, bind:"ctrl+alt+q", run: () => returnToQuest(props.context) },
    ],
  }))
  return null
}

function useQuests(context: any) {
  const root = projectRoot(context)
  const [all, setAll] = createSignal<Quest[]>([])
  const [error,setError]=createSignal<string>()
  let project = boardProject(context?.location?.directory ?? context?.state?.path?.directory)
  let request=0
  const refresh = () => { try { setAll(projectQuests(quests(root), project.id,Boolean(userGiverID()))) } catch {} }
  createEffect(()=>{const sessionID=activeSessionID(context),version=++request;project=boardProject(undefined);setAll([]);setError("Checking current project");void resolveBoardProject(context,sessionID).then(p=>{if(version===request){project=p;setError(p.error);refresh()}})})
  onMount(() => { const stop = watchQuests(root, refresh); onCleanup(stop) })
  onCleanup(()=>{request++})
  return Object.assign(all,{error})
}

/**
 * Live worker status, teleported straight from the Quest ledger — this is
 * the one source of truth Jk asked for: "the chat status and the agent's
 * quick-look at the board should be the same 1:1... immediately brought
 * from that rather than duplicated or having 2 different sources." The
 * giver reports each step via the `quest` tool (action=step); the moment
 * that lands, this slot reflects it — the giver never retypes status lines
 * the footer already shows (see AGENTS.md FACE DISCLOSURE bullet).
 *
 * Each row is 1:1 with the one Quest it came from and is a click target,
 * same convention as the count line above it and the board's own rows:
 * activate() + openBoard(context, questID) → router.navigate({type:"plugin",
 * name:"quests", data:{questID, returnRoute}}), landing straight on that Quest.
 */
export function Footer(props: { context: any }) {
  const all = useQuests(props.context)
  const observation=useWorkerObservations(props.context,()=>all().flatMap(q=>q.sessions))
  const lines=()=>all().flatMap(quest=>quest.sessions.map(session=>({quest,session}))).sort((a,b)=>b.session.updatedAt.localeCompare(a.session.updatedAt)).slice(0,2)
  const counts = async () => {
    const picked=await props.context.ui.dialog.select({title:all.error()??"Quest counts · all projects",options:QUEST_FILTERS.filter(f=>f.id!=="all").map(f=>({value:f.id,title:`${filterQuests(all(),f.id).length} ${f.label}`}))})
    if(picked)openBoard(props.context,undefined,picked)
  }
  return <box flexDirection="column" flexShrink={0}>
    <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
      <Show when={hasQuestReturn(props.context)}><text fg={C.cyan} flexShrink={0} onMouseUp={(event:any)=>activate(event,()=>returnToQuest(props.context))}>↩ Return to Quest</text></Show>
      <Show when={(props.context?.renderer?.width ?? 80)>=150&&!all.error()} fallback={<text fg={C.yellow} flexShrink={0} onMouseUp={(event:any)=>activate(event,()=>void counts())}>Quests · all projects {all.error()?"?":filterQuests(all(),"open").length} ▾</text>}>
        <text fg={C.yellow} flexShrink={0} onMouseUp={(event:any)=>activate(event,()=>openBoard(props.context))}>Quests · all projects</text>
        <For each={QUEST_FILTERS.filter(f=>!["open","all","archived"].includes(f.id))}>{f=><text fg={C.cyan} onMouseUp={(event:any)=>activate(event,()=>openBoard(props.context,undefined,f.id))}>{filterQuests(all(),f.id).length} {f.label.toLowerCase()}</text>}</For>
      </Show>
    </box>
    <For each={lines()}>{row=><text fg={C.muted} wrapMode="none" truncate onMouseUp={(event:any)=>activate(event,()=>void openWorkerSession(props.context,row.session))}>↳ {observation(row.session).state} · {row.quest.title} · {workerLabel(row.session)} · Open worker (/session)</text>}</For>
  </box>
}

/** Role comes from the bound giver and worker receipts, never the selected composer agent. */
function SessionRole(props: { context: any; sessionID: string }) {
  const all = useQuests(props.context)
  const assignment = () => all().flatMap(quest => quest.sessions.map(session => ({quest,session}))).find(row => (row.session.openCodeSessionId ?? row.session.sessionID) === props.sessionID)
  const observation = useWorkerObservations(props.context, () => assignment() ? [assignment()!.session] : [])
  const giver = () => userGiverID() === props.sessionID
  const go = () => void createGiver(props.context).catch(error => props.context.ui.dialog.alert({title:"Quest Giver unavailable",message:String(error)}))
  const native = () => props.context.data?.session?.get(props.sessionID)
  createEffect(() => {
    const row = native(), role = giver() ? 'Quest Giver' : assignment() ? 'Worker' : undefined
    if (!row || !role || !props.context.client.session.rename) return
    const title = role === 'Quest Giver' ? 'Quest Giver' : 'Worker · ' + assignment()!.quest.title
    if (row.title === title) return
    void props.context.client.session.rename({sessionID:props.sessionID,title}).then(() => props.context.data.session.sync(props.sessionID)).catch(error => console.error('[quests] session role title:',String(error)))
  })
  return <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1} backgroundColor={giver()?"#262416":"#18262e"}>
    <box flexDirection="row" gap={2}>
      <text fg={giver()?C.yellow:C.cyan} flexShrink={0}>{giver()?"◆ YOUR QUEST GIVER":assignment()?"↳ QUEST WORKER":"SESSION HISTORY"}</text>
      <Show when={!giver()}><text fg={C.yellow} onMouseUp={(event:any)=>activate(event,go)}>◆ Go to giver · /giver</text></Show>
    </box>
    <Show when={assignment()}>{row => <>
      <text fg={C.text} wrapMode="none" truncate>{row().quest.title} · {observation(row().session).state}</text>
      <text fg={C.muted} wrapMode="none" truncate>{workerLabel(row().session)} · {observation(row().session).lastActivityAt ? 'Last activity '+new Date(observation(row().session).lastActivityAt).toLocaleTimeString() : 'Activity unconfirmed'}</text>
    </>}</Show>
    <Show when={giver()}><text fg={C.muted} wrapMode="none" truncate>Your one conversation across all projects · Workers report here</text></Show>
  </box>
}

function laneColor(q: Quest): string {
  if (q.state === "Working") return C.green
  if (q.state === "Needs attention") return C.red
  if (q.state === "Ready to complete" || q.state === "Complete") return C.cyan
  return C.muted
}

/** Every active Quest beside the session, so the chat always has the whole board in view. */
export function Sidebar(props: { context: any }) {
  const all = useQuests(props.context)
  const active = () => all().filter((q) => q.state !== "Archived").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12)
  return <box flexDirection="column" flexShrink={0}>
    <text fg={C.yellow} onMouseUp={(event:any)=>activate(event,()=>void createGiver(props.context).catch(error=>props.context.ui.dialog.alert({title:"Quest Giver unavailable",message:String(error)})))}>◆ Your Quest Giver · /giver</text>
    <text fg={C.yellow} wrapMode="none" truncate onMouseUp={(event: any) => activate(event, () => openBoard(props.context))}>Quests · all projects · open board</text>
    <Show when={all.error()}>{message=><text fg={C.orange} wrapMode="word">{message()}</text>}</Show>
    <text fg={C.cyan} onMouseUp={(event:any)=>activate(event,()=>void createGiver(props.context).catch(error=>props.context.ui.dialog.alert({title:"Start Quest",message:String(error)})))}>+ Start Quest</text>
    <Show when={active().length > 0} fallback={<text fg={C.dim} wrapMode="word">None yet. Tell the Quest Giver what you want done.</text>}>
      <For each={active()}>{(q) => {
        const p = questProgress(q)
        return <text fg={C.text} wrapMode="none" truncate onMouseUp={(event: any) => activate(event, () => openBoard(props.context, q.id))}><span fg={laneColor(q)}>{progressGlyph(p)}</span> {q.title} <span fg={C.dim}>{p.done}/{p.total}</span></text>
      }}</For>
    </Show>
  </box>
}

export default Plugin.define({
  id: "quests",
  setup(context) {
    context.ui.router.register({ name: "quests", render: (route: any) => <QuestBoard context={context} initialQuestID={route.data?.questID} initialFilter={route.data?.filter} initialAllProjects={route.data?.allProjects} initialProjectDirectory={route.data?.projectDirectory} returnRoute={route.data?.returnRoute} /> })
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
    context.ui.slot({ append: "session.composer.top", render: (input:any) => <SessionRole context={context} sessionID={input.sessionID} /> })
    context.ui.slot({ append: "prompt.footer", render: () => <Footer context={context} /> })
    // One worker face: the host's own background chip already carries the live
    // line (dispatch descriptions are set to the chip format), so the sidebar
    // stays the general board list — a second chip here would render the same
    // line twice beside the session.
    context.ui.slot({ append: "sidebar.content", render: () => <Sidebar context={context} /> })
  },
})
