import { useWorkerObservations } from "./worker-observation"
import { nudgeGiver } from "../tui-workflow"
/** @jsxImportSource @opentui/solid */
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { activeSessionID } from "../../scripts/runtime-contract.mjs"
import { boardProject,projectQuests,resolveBoardProject } from "../board-project"
import { readAllQuests } from "../index"
import type { Quest, QuestSession, QuestStage } from "../types"
import { questIndicator,filterQuests,QUEST_FILTERS,type QuestFilter } from "../tui-model"
import { questChanges } from "../change-view"
import { redact } from "../privacy"
import { createGiver, rememberBoardView } from "../tui-workflow"
import { WorkflowActions, inspectRun } from "./workflow-actions"
import { questLane } from "../board"
import { watchQuests } from "../watcher"
import { progressGlyph, progressRing, questProgress, ringTone } from "../steps"
import { artifactChain, artifactLine } from "../artifacts"
import { subagentChipLabel as liveChipLabel } from "../../orchestration/dispatch"
import { questRoot } from "../root"
import { QuestStore } from "../store"
import { questView } from "../contract"
import { QuestWorkspaces } from "../workspaces"
import { nextStepAction } from "../steps"
import { navigateQuestSession } from "../tui-navigation"

export const C = {
  bg: "#101417", panel: "#171d21", selected: "#21343c", line: "#35434b",
  text: "#e2e5e6", muted: "#a5afb5", dim: "#82919a", yellow: "#e5c477",
  cyan: "#79cfde", green: "#9acb84", orange: "#e5b96f", red: "#e78d93",
}

export function projectRoot(_context: any): string {
  return questRoot()
}

export function quests(root: string): Quest[] {
  return readAllQuests(root, { includeArchived: true }).flatMap((entry) => entry.quest ? [entry.quest] : [])
}

export function activate(event: any, action: () => void) { try { event?.stopPropagation?.() } catch {}; action() }

function repo(q: Quest): string {
  const value = q.project?.root ?? q.scope.repos[0] ?? "workspace"
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
}

function integrationSession(q: Quest) {
  return q.sessions.find((session) => session.sessionID === q.integrationOwner || session.openCodeSessionId === q.integrationOwner)
    ?? q.sessions.find((session) => session.role === "integration-owner" || session.agentRole === "orchestrator")
}

function branch(q: Quest): string { const run=q.sessions.at(-1);return integrationSession(q)?.branch ?? run?.branch ?? (run?.scope as any)?.branch ?? "Branch not recorded" }

function status(q: Quest): { label: string; color: string } {
  if (q.state === "Working") return { label: "RUNNING", color: C.green }
  if (q.state === "Needs attention") return { label: "STOPPED", color: C.red }
  if (q.state === "Verifying") return { label: "VERIFYING", color: C.orange }
  if (q.state === "Ready to complete" || q.state === "Complete") return { label: "READY", color: C.green }
  if (q.state === "Archived") return { label: "ARCHIVED", color: C.muted }
  return { label: "WAITING", color: C.muted }
}

function stageRows(q: Quest): QuestStage[] {
  if (q.stages.length) return q.stages
  return q.deliverables.map((item) => ({
    id: item.id, title: item.title, status: item.status, needs: [], todos: [],
    claim: { repos: q.scope.repos, include: [], exclude: [] }, proofs: [], attempt: 1,
  }))
}

function badge(q: Quest): string {
  if (q.state === "Working") return "ACCEPTED"
  if (q.state === "Needs attention") return "NEEDS ATTENTION"
  if (q.state === "Ready to complete" || q.state === "Complete") return "TURN IN"
  return q.state.toUpperCase()
}

/**
 * The provider/model that actually answered, else an honest placeholder. Jk's
 * rule: the model is named everywhere a worker is shown, a fast variant says
 * "fast" (never a plain/default variant), and the reasoning level sits next
 * to it — never silently dropped.
 */
export function workerLabel(session: QuestSession): string {
  const base = session.providerID && session.modelID ? `${session.providerID}/${session.modelID}` : session.model
  if (!base) return session.agentRole && session.agentRole !== "worker" ? session.agentRole : "worker"
  const tags = [session.fast ? "fast" : undefined, session.reasoningEffort ? `${session.reasoningEffort} reasoning` : undefined].filter(Boolean)
  return tags.length ? `${base} (${tags.join(" · ")})` : base
}

/**
 * The exact, bare chip Jk asked for beside a subagent session: quest title,
 * model, reasoning level, and "fast" only when true — nothing else, no
 * "AGENT LOG" or state narration. Single source is the shared helper in
 * orchestration/dispatch: native dispatches set their host-chip description
 * to this exact string, so the host's own background chip carries the live
 * line instead of its generic "General Subagent" fallback.
 */
export function subagentChipLabel(quest: Quest, session: QuestSession): string {
  return liveChipLabel(quest, session)
}

/**
 * Live (non-terminal) session states only, in the exact words Jk asked for:
 * Running=executing, Waiting=waiting, Blocked=blocked, Planned=planned.
 * Terminal states (completed/failed/cancelled/missing/stale) never show
 * here — a live status line is for work happening right now.
 */
const LIVE_STATE: Record<string, { label: string; emoji: string }> = {
  executing: { label: "Running", emoji: "🟢" },
  waiting: { label: "Waiting", emoji: "🟡" },
  blocked: { label: "Blocked", emoji: "🔴" },
  planned: { label: "Planned", emoji: "⚪" },
}

/**
 * Short-title form for the footer: trim a quest title to at most `max`
 * characters, cutting only at a word boundary and marking the cut with a
 * single "…" — never mid-word. A single word longer than the budget is the
 * only case that hard-cuts (nothing else fits). The footer row keeps
 * `truncate` as a backstop, but a pre-fit line never reaches it, so the host
 * can no longer slice a word in half ("plugin f...2").
 */
export function fitTitle(title: string, max: number): string {
  const clean = title.replace(/\s+/g, " ").trim()
  if (max <= 1) return "…"
  if (clean.length <= max) return clean
  const words = clean.split(" ")
  let out = ""
  for (const word of words) {
    const next = out ? `${out} ${word}` : word
    if (next.length > max - 1) break
    out = next
  }
  if (!out) out = clean.slice(0, max - 1)
  return `${out}…`
}

/** Footer rows are capped so the live block never collides with the composer hint row. */
export const FOOTER_MAX_LINES = 2

/** Real footer width from the live renderer; falls back to a narrow 80-col budget. */
export function footerWidth(context: any): number {
  const raw = context?.renderer?.width ?? context?.ui?.renderer?.width
  return Math.max(40, (typeof raw === "number" && raw > 0 ? raw : 80) - 2)
}

/**
 * One line, straight off the ledger: `<emoji> <State> — <short title> —
 * <model>[, <reasoning>][, fast]`. The title is pre-fit to `maxWidth` at a
 * word boundary, so the whole-line ellipsis is the only cut — never mid-word.
 * A session with no model/reasoning yet omits those parts instead of leaking
 * a raw "model pending"/"reasoning pending" placeholder onto the face.
 */
export function workerStatusLine(quest: Quest, session: QuestSession, maxWidth = 120): string | undefined {
  const state = LIVE_STATE[session.state]
  if (!state) return undefined
  const model = session.providerID && session.modelID ? `${session.providerID}/${session.modelID}` : session.model
  const details = [model, session.reasoningEffort].filter(Boolean) as string[]
  if (session.fast) details.push("fast")
  const head = `${state.emoji} ${state.label} — `
  const tail = details.length ? ` — ${details.join(", ")}` : ""
  return `${head}${fitTitle(quest.title, Math.max(1, maxWidth - head.length - tail.length))}${tail}`
}

/** One footer row: the rendered line, paired with the one Quest it is 1:1 with — click it and you land on that Quest, nothing else. */
export type LiveWorkerLine = { questID: string; line: string }

/** Every live worker line across every Quest, newest quest first — the whole board's live status, teleported. Capped at `maxLines` (default 2) so the footer block stays clear of the composer hint row. */
export function liveWorkerLines(quests: Quest[], maxWidth = 120, maxLines = FOOTER_MAX_LINES): LiveWorkerLine[] {
  return quests
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .flatMap((quest) => quest.sessions
      .map((session) => workerStatusLine(quest, session, maxWidth))
      .filter((line): line is string => line !== undefined)
      .map((line) => ({ questID: quest.id, line })))
    .slice(0, Math.max(0, maxLines))
}

/** The id worth showing/clicking: short enough for a footer row, long enough to be unambiguous. */
export function shortSessionID(id?: string): string | undefined {
  if (!id) return undefined
  return id.length > 20 ? `${id.slice(0, 20)}…` : id
}

/**
 * Click-to-jump for a worker's session id. Native (bridge-backed) sessions
 * resolve to a real `{type:"session"}` route via navigateQuestSession; an
 * external harness session or a pruned one has nothing to route to, so the
 * closest real thing is a dialog with what we know about it instead of a
 * dead click (the desktop app exposes no other way to address a session
 * that no longer has a live OpenCode transcript).
 */
export async function openWorkerSession(context: any, session: QuestSession) {
  try {
    if (await navigateQuestSession(context, session)) return
  } catch {}
  const dialog = context?.ui?.dialog
  if (typeof dialog?.alert !== "function") return
  const id = session.openCodeSessionId ?? session.sessionID
  const message = session.runtime === "claude-code" || session.harness
    ? `${id ?? "This worker"} ran on an external ${session.harness ?? "harness"} process, not a native OpenCode session — there is no transcript to open.`
    : `Could not open a live session for ${id ?? "this worker"}. It may have finished and been pruned from the host.`
  try { await dialog.alert({ title: "Can't open session", message: `${message} ${workerLabel(session)} · ${session.task ?? session.taskDescription ?? "delegated work"}` }) } catch {}
}

function sessionColor(state: string): string {
  if (state === "executing") return C.green
  if (state === "failed" || state === "missing" || state === "stale") return C.red
  if (state === "blocked") return C.orange
  if (state === "completed") return C.cyan
  return C.muted
}

function stepMark(status: string): string {
  if (status === "done") return "☑"
  if (status === "working") return "◐"
  if (status === "blocked") return "⊘"
  return "☐"
}

function stepColor(status: string): string {
  if (status === "done") return C.green
  if (status === "working") return C.orange
  if (status === "blocked") return C.red
  return C.dim
}

/** A one-row hairline instead of a filled bar. */
function Rule() {
  return <box height={1} width="100%" border={["bottom"]} borderColor={C.line} flexShrink={0} />
}

export function questStatus(q: Quest): { label: string; color: string; rank: number } {
  const lane = questLane(q)
  if (lane === "archived") return { label: "Archived", color: C.muted, rank: 5 }
  if (lane === "attention") return { label: "Needs attention", color: C.orange, rank: 0 }
  if (lane === "ready") return { label: "Ready for review", color: C.green, rank: 1 }
  if (lane === "verifying") return { label: "Verifying", color: C.cyan, rank: 2 }
  if (q.stages.some(s => s.status === "working") || q.executingCount > 0) return { label: "Work recorded", color: C.cyan, rank: 3 }
  return { label: "Planned", color: C.muted, rank: 4 }
}

function Row(props: { quest: Quest; selected: boolean; select: () => void; allProjects?: boolean }) {
  const p = () => questProgress(props.quest)
  return <box id={"quest-row-" + props.quest.id} flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={1}
    border={["left"]} borderColor={props.selected ? C.green : C.panel} backgroundColor={props.selected ? C.selected : "transparent"} flexShrink={0} onMouseUp={(event:any)=>activate(event,props.select)}>
    <text fg={props.selected ? C.cyan : C.text} attributes={TextAttributes.BOLD} wrapMode="word">{props.quest.title}</text>
    <text fg={C.dim} wrapMode="none" truncate>{repo(props.quest)} · {branch(props.quest)}</text>
    <text fg={questStatus(props.quest).color} wrapMode="none" truncate>{questStatus(props.quest).label} · {p().done}/{p().total} steps</text>
    <text fg={C.green} wrapMode="none">{"━".repeat(p().total?Math.round(16*p().done/p().total):0)}<span fg={C.line}>{"─".repeat(16-(p().total?Math.round(16*p().done/p().total):0))}</span></text>
  </box>
}

function SectionHeader(props: { label: string; count: number; open: boolean; toggle: () => void }) {
  return <text fg={C.muted} paddingLeft={1} paddingTop={1} wrapMode="none" truncate onMouseUp={(event: any) => activate(event, props.toggle)}>{props.open ? "⌄" : "›"} {props.label} · {props.count}</text>
}

function StageList(props: { quest: Quest }) {
  const rows = () => stageRows(props.quest)
  const p = () => questProgress(props.quest)
  return <box flexDirection="column" flexShrink={0}>
    <text fg={C.cyan} attributes={TextAttributes.BOLD}>QUEST STEPS <span fg={C.muted}>· {p().done}/{p().total} done</span></text>
    <Show when={rows().length > 0} fallback={<text fg={C.dim} paddingTop={1}>No steps planned yet. Ask the Quest Giver to plan this Quest.</text>}>
      <For each={rows()}>{(stage, index) => <box flexDirection="column" paddingTop={1} flexShrink={0}>
        <box flexDirection="row" gap={1} flexWrap="no-wrap">
          <text fg={stepColor(stage.status)} width={2} flexShrink={0}>{stepMark(stage.status)}</text>
          <text fg={C.muted} width={3} flexShrink={0}>{String(index() + 1).padStart(2, "0")}</text>
          <text fg={stage.status === "done" ? C.muted : C.text} wrapMode="word" flexGrow={1} flexShrink={1}>{stage.title}</text>
          <text fg={stepColor(stage.status)} flexShrink={0}>{(stage.status ?? "pending") === "pending" ? (stage.attempt > 1 ? `ATTEMPT ${stage.attempt}` : "") : String(stage.status).toUpperCase()}</text>
        </box>
        <For each={stage.todos}>{(todo) => <text fg={C.muted} paddingLeft={7} wrapMode="word">{todo.status === "done" ? "✓" : "·"} {todo.title}</text>}</For>
        <For each={stage.proofs.filter((proof) => proof.attempt === stage.attempt)}>{(proof) => <text fg={proof.verdict === "FAIL" || proof.result === "failed" ? C.red : C.muted} paddingLeft={7} wrapMode="word">Evidence: {proof.kind} · {proof.verdict ?? proof.result ?? "recorded"}{proof.reason ? ` · ${proof.reason}` : ""}</text>}</For>
      </box>}</For>
    </Show>
  </box>
}

/** Border cells tone/dim by fill; the centered done/total digits stay readable text. */
function ringCellColor(row: number, col: number, width: number, lit: boolean, tone: string): string {
  const border = row !== 1 || col === 0 || col === width - 1
  if (!border) return C.text
  return lit ? tone : C.dim
}

function ProgressRing(props: { quest: Quest }) {
  const drawn = createMemo(() => { const p = questProgress(props.quest); return { ring: progressRing(p), tone: ringTone(p, C) } })
  return <box flexDirection="column" flexShrink={0}>
    <For each={drawn().ring.rows}>{(row, r) => <text wrapMode="none" truncate>
      <For each={row}>{(cell, c) => <span fg={ringCellColor(r(), c(), row.length, cell.lit, drawn().tone)}>{cell.char}</span>}</For>
    </text>}</For>
  </box>
}

function AgentLog(props: { context: any; quest: Quest }) {
  const st = () => status(props.quest)
  return <box flexDirection="column" flexShrink={0}>
    <box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
      <ProgressRing quest={props.quest} />
      <text fg={st().color} attributes={TextAttributes.BOLD} wrapMode="none" truncate>{st().label}</text>
      <text fg={C.cyan} attributes={TextAttributes.BOLD} wrapMode="none" truncate>AGENT LOG <span fg={C.muted}>· {props.quest.executingCount} running</span></text>
    </box>
    <Show when={props.quest.sessions.length > 0} fallback={<text fg={C.dim} paddingTop={1}>No delegated work yet</text>}>
      <For each={props.quest.sessions}>{(session) => {
        const id = () => shortSessionID(session.openCodeSessionId ?? session.sessionID)
        return <box flexDirection="column" paddingTop={1} flexShrink={0}>
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <text fg={C.text} flexGrow={1} flexShrink={1} wrapMode="word"><span fg={C.yellow}>{workerLabel(session)}</span> · {session.task ?? session.taskDescription ?? "delegated work"}</text>
            <text fg={sessionColor(session.state)} flexShrink={0} onMouseUp={(event:any)=>activate(event,()=>void inspectRun(props.context,props.quest,session.callID).catch(error=>props.context.ui.dialog.alert({title:"Run details",message:String(error)})))}>{session.state.toUpperCase()} · details / reason</text>
          </box>
          <Show when={session.result ?? session.evidence.at(-1)}>{(line) => <text fg={C.muted} paddingLeft={2} wrapMode="word">{redact(line(),300)}</text>}</Show>
          <Show when={id()}>{(value) => <text fg={C.cyan} paddingLeft={2} wrapMode="none" truncate onMouseUp={(event: any) => activate(event, () => openWorkerSession(props.context, session))}>↳ {value()}</text>}</Show>
        </box>
      }}</For>
    </Show>
  </box>
}

function LegacyDetail(props: { context: any; store: QuestStore; quest: () => Quest; refresh: () => void }) {
  const q = props.quest
  const p = () => questProgress(q())
  const rows = () => stageRows(q())
  return <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingTop={1} gap={1} backgroundColor={C.bg}>
    <box flexDirection="column" gap={0} flexShrink={0}>
      <text fg={C.yellow} attributes={TextAttributes.BOLD} wrapMode="word">{q().title}</text>
      <text fg={status(q()).color} flexShrink={0}>{badge(q())}</text>
    </box>
    <text fg={C.cyan} wrapMode="word">{progressGlyph(p())} {p().done}/{p().total} steps <span fg={C.muted}>· {repo(q())} · {branch(q())} · {q().sessions.length} sessions · {q().evidence.tests.length} checks</span></text>
    <WorkflowActions context={props.context} store={props.store} quest={q} refresh={props.refresh} />
    <Rule />
    <scrollbox flexGrow={1} flexShrink={1}>
      <box flexDirection="column" gap={1} flexShrink={0} paddingRight={1}>
        <text fg={C.text} wrapMode="word">{q().objective}</text>
        <text fg={C.muted} wrapMode="word">Next: {q().nextAction}</text>
        <Rule />
        <StageList quest={q()} />
        <Show when={q().setbacks.length > 0}>
          <text fg={C.red} attributes={TextAttributes.BOLD}>SETBACKS</text>
          <For each={q().setbacks}>{(item) => <text fg={C.muted} wrapMode="word">Attempt {item.attempt} · {item.stageID} · {item.reason}</text>}</For>
        </Show>
        <Rule />
        <AgentLog context={props.context} quest={q()} />
        <Rule />
        <text fg={C.cyan} attributes={TextAttributes.BOLD}>ARTIFACTS <span fg={C.muted}>· {q().evidence.artifacts.length}</span></text>
        <Show when={q().evidence.artifacts.length > 0} fallback={<text fg={C.dim}>No captures yet — record a before shot before the first edit, then revision N / after shots.</text>}>
          <For each={artifactChain([...q().evidence.artifacts])}>{(artifact) => <text fg={C.muted} wrapMode="word">· {artifactLine(artifact)}</text>}</For>
        </Show>
        <Show when={q().usageInstructions.length > 0}>
          <Rule />
          <text fg={C.cyan} attributes={TextAttributes.BOLD}>QUEST PAYOUT</text>
          <For each={q().usageInstructions}>{(line) => <text fg={C.text} wrapMode="word">▸ {line}</text>}</For>
        </Show>
        <Show when={rows().length === 0 && q().acceptanceCriteria.length > 0}>
          <Rule />
          <text fg={C.cyan} attributes={TextAttributes.BOLD}>ACCEPTANCE</text>
          <For each={q().acceptanceCriteria}>{(item) => <text fg={item.satisfied ? C.green : C.muted} wrapMode="word">{item.satisfied ? "☑" : "☐"} {item.text}</text>}</For>
        </Show>
      </box>
    </scrollbox>
  </box>
}

function ContractDetail(props: { context: any; store: QuestStore; quest: () => Quest; refresh: () => void }) {
 const view=createMemo(()=>questView(props.quest()))
 const observation=useWorkerObservations(props.context,()=>props.quest().sessions)
 const [expanded,setExpanded]=createSignal<string>()
 const [descriptionOpen,setDescriptionOpen]=createSignal(false)
 const [failure,setFailure]=createSignal<string>()
 let scroll:ScrollBoxRenderable|undefined
 const sessions=()=>props.quest().sessions
 const links=()=>view().artifacts.filter(a=>/https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+/.test(a.uri??''))
 const open=async()=>{const rows=sessions();const key=rows.length===1?rows[0].callID:await props.context.ui.dialog.select({title:'Quest worker sessions',options:rows.map(s=>({value:s.callID,title:workerLabel(s),description:observation(s).state+' · '+(s.task??'assigned work')}))});const run=rows.find(s=>s.callID===key);if(run)await openWorkerSession(props.context,run)}
 const compose=()=>void nudgeGiver(props.context,props.quest()).catch(e=>setFailure(String(e)))
 props.context?.keymap?.layer?.(()=>({mode:'global',commands:[
  {id:'quests.worker',title:'Open worker session',bind:'w',run:()=>void open()},
  {id:'quests.description',title:'Expand description',bind:'d',run:()=>setDescriptionOpen(!descriptionOpen())},
  {id:'quests.detail-down',title:'Scroll detail down',bind:'pagedown',run:()=>scroll?.scrollBy(10)},
  {id:'quests.detail-up',title:'Scroll detail up',bind:'pageup',run:()=>scroll?.scrollBy(-10)},
 ]}))
 return <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
  <text fg={C.yellow} attributes={TextAttributes.BOLD} flexShrink={0} wrapMode="word">{view().title}</text>
  <text fg={C.dim} flexShrink={0} wrapMode="word">{repo(props.quest())} · {branch(props.quest())}</text>
  <text fg={questStatus(props.quest()).color} flexShrink={0} wrapMode="word">[ {questStatus(props.quest()).label.toUpperCase()} ] <span fg={C.dim}> Created {props.quest().createdAt} · Updated {props.quest().updatedAt}</span></text>
  <Rule/>
  <scrollbox ref={scroll} flexGrow={1} flexShrink={1} minHeight={0} scrollX={false}>
   <box flexDirection="column" flexShrink={0} gap={1} paddingRight={1}>
    <text fg={C.cyan} attributes={TextAttributes.BOLD}>LINKED PULL REQUESTS</text>
    <Show when={links().length} fallback={<text fg={C.dim}>No pull requests recorded</text>}><For each={links()}>{a=><text fg={C.cyan} wrapMode="word"><a href={a.uri!}>{a.name} · {a.uri}</a></text>}</For></Show>
    <text fg={C.cyan} attributes={TextAttributes.BOLD} onMouseUp={(e:any)=>activate(e,()=>setDescriptionOpen(!descriptionOpen()))}>DESCRIPTION · [d] {descriptionOpen()?"Collapse":"Expand"}</text>
    <text fg={C.text} wrapMode="word">{descriptionOpen()?view().description:fitTitle(view().description,Math.max(160,((props.context.renderer?.width??120)*0.65)*3))}</text>
    <Rule/>
    <text fg={C.cyan} attributes={TextAttributes.BOLD}>QUEST STEPS · {view().progress.done}/{view().progress.total} complete</text>
    <For each={view().steps}>{(step,index)=><box flexDirection="column" flexShrink={0}>
     <text fg={stepColor(step.state)} wrapMode="word" onMouseUp={(e:any)=>activate(e,()=>setExpanded(expanded()===step.id?undefined:step.id))}>{stepMark(step.state)} {index()+1}. {step.title}</text>
     <Show when={expanded()===step.id||step.state==='working'||step.state==='blocked'}><text fg={C.muted} paddingLeft={4} wrapMode="word">{step.note??step.detail??'No further detail recorded'}</text></Show>
    </box>}</For>
    <Rule/>
    <box flexDirection={(props.context.renderer?.width??120)>=140?'row':'column'} gap={2} flexShrink={0}>
     <box flexDirection="column" flexBasis="35%" flexGrow={1} flexShrink={1} minWidth={0}>
      <text fg={C.yellow} attributes={TextAttributes.BOLD}>REWARD / ARTIFACTS</text>
      <text fg={C.text} wrapMode="word">{view().reward||'No deliverable recorded yet'}</text>
      <For each={view().artifacts}>{artifact=><text fg={C.muted} wrapMode="word">{artifactLine(artifact)}</text>}</For>
     </box>
     <box flexDirection="column" flexBasis="65%" flexGrow={1} flexShrink={1} minWidth={0}>
      <text fg={C.cyan} attributes={TextAttributes.BOLD}>AGENT LOG · [w] Open session</text>
      <text fg={C.dim}>WORKER / MODEL · LIVE STATE · ACTIVITY</text>
      <Show when={sessions().length} fallback={<text fg={C.dim}>No worker sessions recorded</text>}>
       <For each={sessions()}>{run=><box flexDirection="column" paddingTop={1} flexShrink={0}>
        <text fg={C.yellow} wrapMode="word" onMouseUp={(e:any)=>activate(e,()=>void openWorkerSession(props.context,run))}>↳ {workerLabel(run)} · Open session</text>
        <text fg={observation(run).state==='running'?C.green:observation(run).state==='completed'?C.cyan:C.orange} wrapMode="word">{observation(run).state.toUpperCase()} <span fg={C.dim}>· Saved: {run.state}</span></text>
        <text fg={C.muted} wrapMode="word">{observation(run).reason}</text>
        <text fg={C.dim} wrapMode="word">Activity: {observation(run).lastActivityAt??'unknown'} · Checked: {observation(run).checkedAt??'pending'}</text>
        <Show when={run.result}><text fg={C.muted} wrapMode="word">{redact(run.result!,450)}</text></Show>
       </box>}</For>
      </Show>
     </box>
    </box>
   </box>
  </scrollbox>
  <Rule/>
  <WorkflowActions context={props.context} store={props.store} quest={props.quest} refresh={props.refresh}/>
  <Show when={failure()}><text fg={C.red} wrapMode="word">{failure()}</text></Show>
  <box border borderColor={C.line} paddingLeft={1} flexShrink={0} onMouseUp={(e:any)=>activate(e,compose)}><text fg={C.muted} wrapMode="word">› [n] Message this Quest's giver…</text></box>
 </box>
}

export function QuestBoard(props: { context: any; initialQuestID?: string; initialFilter?: QuestFilter; initialAllProjects?: boolean; returnRoute?: unknown }) {
  const store = new QuestStore(projectRoot(props.context))
  const [records,setRecords] = createSignal<Quest[]>([])
  const [allProjects,setAllProjects] = createSignal(props.initialAllProjects===true)
  const [project,setProject] = createSignal(boardProject(props.context?.location?.directory??props.context?.state?.path?.directory))
  const [filter,setFilter] = createSignal<QuestFilter>(props.initialFilter??"all")
  const [query,setQuery] = createSignal("")
  const [collapsed,setCollapsed]=createSignal<Record<string,boolean>>({})
  const group=(q:Quest)=>["Complete","Archived","Ready to complete"].includes(q.state)?"Completed Quests":q.sessions.length||q.stages.some(s=>s.status!=="pending")?"Current Quest":"New Quests"
  const [selectedID,setSelectedID] = createSignal(props.initialQuestID)
  const [detail,setDetail] = createSignal(Boolean(props.initialQuestID))
  const [width,setWidth] = createSignal(props.context?.renderer?.width??120)
  const narrow = () => width()<100
  let listScroll: ScrollBoxRenderable | undefined
  const scoped = createMemo(()=>projectQuests(records(),project().id,allProjects()))
  const rows = createMemo(()=>filterQuests(scoped(),filter()).filter(q=>!query() || (q.title+" "+q.description).toLowerCase().includes(query().toLowerCase()))
    .sort((a,b)=>questStatus(a).rank-questStatus(b).rank || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)))
  const selected = createMemo(()=>rows().find(q=>q.id===selectedID()))
  const refresh = () => { try {setRecords(quests(store.projectRoot))} catch {} }
  const reveal = () => { if(selectedID()) listScroll?.scrollChildIntoView("quest-row-"+selectedID()) }
  createEffect(()=>{if(!rows().some(q=>q.id===selectedID()))setSelectedID(rows()[0]?.id)})
  createEffect(()=>rememberBoardView(props.context,{questID:selectedID(),filter:filter(),allProjects:allProjects()}))
  onMount(()=>{
    refresh(); const stop=watchQuests(store.projectRoot,refresh);onCleanup(stop)
    const renderer=props.context?.renderer
    const resize=()=>setWidth(renderer?.width??120)
    renderer?.on?.("resize",resize);onCleanup(()=>renderer?.off?.("resize",resize))
    void resolveBoardProject(props.context,activeSessionID(props.context)??(props.returnRoute as any)?.sessionID).then(p=>{setProject(p);refresh()})
  })
  const select = (id:string, open=false) => {const q=rows().find(q=>q.id===id);if(q)setCollapsed({...collapsed(),[group(q)]:false});setSelectedID(id);if(open)setDetail(true);reveal()}
  const back = () => {if(narrow()&&detail()){setDetail(false);queueMicrotask(reveal)}else props.context?.ui?.router?.navigate?.(props.returnRoute??{type:"home"})}
  const label = (id:QuestFilter) => id==="ready"?"Ready for review":id==="waiting"?"Planned / idle":QUEST_FILTERS.find(f=>f.id===id)?.label??id
  const chooseFilter = async()=>{const picked=await props.context.ui.dialog.select({title:"Quest state filter",options:QUEST_FILTERS.map(f=>({value:f.id,title:`${label(f.id)} · ${filterQuests(scoped(),f.id).length}`})),current:filter()});if(picked){setFilter(picked);setDetail(false)}}
  const search = async()=>{const value=await props.context.ui.dialog.prompt({title:"Search Quests",placeholder:"Title or description; blank clears search",value:query()});if(typeof value==="string"){setQuery(value.trim());setDetail(false)}}
  const chooseQuest = async()=>{const id=await props.context.ui.dialog.select({title:"Select Quest",options:rows().map(q=>({value:q.id,title:q.title,description:questStatus(q).label}))});if(id)select(id,true)}
  const move = (delta:number)=>{const items=rows();if(!items.length)return;const index=Math.max(0,items.findIndex(q=>q.id===selectedID()));select(items[Math.max(0,Math.min(items.length-1,index+delta))].id)}
  const newQuest = ()=>void createGiver(props.context).catch(error=>props.context.ui.dialog.alert({title:"Start Quest",message:String(error)}))
  props.context?.keymap?.layer?.(()=>({mode:"global",commands:[
    {id:"quests.close",title:"Back",bind:"escape",run:back},
    {id:"quests.filter",title:"Filter Quests",bind:"f",run:chooseFilter},
    {id:"quests.choose",title:"Select Quest",bind:"q",run:chooseQuest},
    {id:"quests.search",title:"Search Quests",bind:"/",run:search},
    {id:"quests.clear-search",title:"Clear search",bind:"x",run:()=>{setQuery("");setDetail(false)}},
    {id:"quests.up",title:"Previous Quest",bind:"up",run:()=>move(-1)},
    {id:"quests.down",title:"Next Quest",bind:"down",run:()=>move(1)},
    {id:"quests.open",title:"Open selected Quest",bind:"return",run:()=>setDetail(true)},
    {id:"quests.scope",title:"Toggle project scope",bind:"a",run:()=>{setAllProjects(!allProjects());setDetail(false)}},
    {id:"quests.create",title:"Start Quest",bind:"+",run:newQuest},
  ]}))
  return <box flexDirection="column" width="100%" height="100%" backgroundColor={C.bg}>
    <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1} backgroundColor={C.panel}>
      <text fg={C.text} attributes={TextAttributes.BOLD}>Quests · {rows().length} matching</text>
      <box flexGrow={1}/>
      <text fg={C.cyan} onMouseUp={(e:any)=>activate(e,newQuest)}>+ New  </text>
      <text fg={C.cyan} onMouseUp={(e:any)=>activate(e,back)}>{narrow()&&detail()?"Esc · Back to Quests":"Esc · Back to chat"}</text>
    </box>
    <box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={0} paddingLeft={1} flexShrink={0}>
      <text fg={C.cyan} onMouseUp={(e:any)=>activate(e,()=>{setAllProjects(!allProjects());setDetail(false)})}>[a] {allProjects()?"All projects":"Current project"}</text>
      <text fg={C.cyan} onMouseUp={(e:any)=>activate(e,()=>void chooseFilter())}>[f] {label(filter())}</text>
      <For each={["attention","ready","archived"] as QuestFilter[]}>{id=><text fg={filter()===id?C.cyan:C.muted} onMouseUp={(e:any)=>activate(e,()=>{setFilter(id);setDetail(false)})}>{filterQuests(scoped(),id).length} {label(id)}</text>}</For>
    </box>
    <Show when={!allProjects()&&project().error}><text fg={C.orange} wrapMode="word">{project().error}</text></Show>
    <Rule/>
    <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0}>
      <Show when={!narrow()||!detail()}>
        <box width={narrow()?"100%":Math.max(28,Math.floor(width()*0.29))} flexShrink={0} flexDirection="column" backgroundColor={C.panel}>
          <text fg={C.cyan} paddingLeft={1} paddingBottom={1} wrapMode="word" onMouseUp={(e:any)=>activate(e,()=>void search())}>/ {query()?"Search: "+query():"Search quests"}</text>
          <Show when={query()}><text fg={C.cyan} paddingLeft={1} onMouseUp={(e:any)=>activate(e,()=>setQuery(""))}>[x] Clear search</text></Show>
          <scrollbox ref={listScroll} flexGrow={1} flexShrink={1} minHeight={0} scrollX={false}>
            <For each={['New Quests','Current Quest','Completed Quests']}>{name=><>
            <SectionHeader label={name} count={rows().filter(q=>group(q)===name).length} open={!collapsed()[name]} toggle={()=>setCollapsed({...collapsed(),[name]:!collapsed()[name]})}/>
            <Show when={!collapsed()[name]}><For each={rows().filter(q=>group(q)===name)}>{q=><Row quest={q} selected={q.id===selectedID()} select={()=>select(q.id,true)} allProjects={allProjects()}/>}</For></Show>
            </>}</For>
            <Show when={!rows().length}><text fg={C.muted} padding={1} wrapMode="word">No matching Quests. Clear search or change the filter.</text></Show>
          </scrollbox>
        </box>
        <Show when={!narrow()}><box width={1} backgroundColor={C.line} flexShrink={0}/></Show>
      </Show>
      <Show when={!narrow()||detail()}>
        <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0}>
          <Show when={selectedID()} keyed>{id=><Show when={selected()} fallback={<text fg={C.muted} padding={1}>Choose a Quest to view its details.</text>}>
            {q=><Show when={q().contractVersion===2} fallback={<LegacyDetail context={props.context} store={store} quest={q} refresh={refresh} />}><ContractDetail context={props.context} store={store} quest={q} refresh={refresh} /></Show>}
          </Show>}</Show>
        </box>
      </Show>
    </box>
    <text fg={C.muted} paddingLeft={1} backgroundColor={C.panel} flexShrink={0} wrapMode="none" truncate>↑↓ Select  Enter Open  / Search  f Filter  q Picker  w Worker  PgUp/PgDn Scroll</text>
  </box>
}
