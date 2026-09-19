/** @jsxImportSource @opentui/solid */
/**
 * /duration-graph — where the live session's wall clock went, as a screen instead of a script.
 *
 * Everything here is read through duration-graph/duration-graph.ts, the same module
 * scripts/duration-audit.ts reads through, so the screen and the CLI cannot report different
 * numbers for the same session.
 *
 * Every figure on this screen is a recorded timestamp, not an estimate: assistant turn envelopes,
 * per-tool created/ran/completed, per-reasoning created/completed. The window is partitioned, so
 * the timeline is literally the session: each cell of the bar is a real slice of the elapsed time
 * and the segments sum to the total. Time no span covers gets its own segment and its own colour
 * rather than being folded into whichever neighbour would hide it.
 */
import { Plugin } from "../../tui-legacy"
import { TextAttributes } from "@opentui/core"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { activeSessionID } from "../../scripts/runtime-contract.mjs"
import { stackedBar } from "../../context-graph/context-graph"
import { durationGroups, formatDuration, readSessionDurations, type DurationKind, type DurationSegment, type SessionDuration } from "../duration-graph"

const ROUTE = "duration-graph"
const REFRESH_MS = 2000
const BAR_CELLS = 44
const SEGMENT_ROWS = 14
const TURN_ROWS = 12

/**
 * Theme roles, as colour strings.
 *
 * The host theme nests these (`text.default`, `background.panel`) and several roles that read like
 * a colour are objects of variants. Handing an object to `fg` or `borderColor` takes the whole
 * screen down inside the route, where the error boundary swallows it and leaves a blank screen with
 * nothing in the log, so a role is taken only when it really is a string and otherwise falls back.
 */
const colour = (value: unknown, fallback: string) => (typeof value === "string" && value ? value : fallback)
function themeColors(context: any) {
  const current = context?.theme?.current ?? context?.theme ?? {}
  return {
    bg: colour(current?.background?.default ?? current?.background, "#0b1012"),
    text: colour(current?.text?.default ?? current?.text, "#e2e5e6"),
    muted: colour(current?.text?.muted ?? current?.textMuted, "#a5afb5"),
    dim: colour(current?.text?.subdued ?? current?.text?.dim, "#82919a"),
    panel: colour(current?.background?.panel ?? current?.backgroundPanel, "#101619"),
    line: colour(current?.border?.default ?? current?.border, "#35434b"),
    ok: colour(current?.success, "#9acb84"),
    warn: colour(current?.warning, "#efd06a"),
    cap: colour(current?.error, "#e78d93"),
    primary: colour(current?.primary, "#79cfde"),
    accent: colour(current?.accent, "#bb9af7"),
    info: colour(current?.info, "#7dcfff"),
  }
}

type Colors = ReturnType<typeof themeColors>

const KIND_LABEL: Record<DurationKind, string> = {
  tool: "inside tools",
  dispatch: "writing tool calls",
  reasoning: "reasoning",
  model: "model response",
  gap: "unrecorded",
  waiting: "idle",
}

function kindFg(kind: DurationKind, colors: Colors) {
  if (kind === "tool") return colors.info
  if (kind === "dispatch") return colors.primary
  if (kind === "reasoning") return colors.accent
  if (kind === "model") return colors.ok
  // The gaps are the point of the screen, so they get the loudest role the theme has.
  if (kind === "gap") return colors.cap
  return colors.muted
}

const pct = (share: number) => Math.round(share * 100) + "%"
function pad(value: string, width: number, align: "left" | "right" = "left") {
  const text = value.length > width ? value.slice(0, Math.max(0, width - 1)) + "…" : value
  return align === "right" ? text.padStart(width) : text.padEnd(width)
}

function activate(event: any, action: () => void) {
  try { event?.stopPropagation?.() } catch {}
  action()
}

function Cell(props: { w: number; align?: "left" | "right"; fg: unknown; bold?: boolean; value: string }) {
  return (
    <text fg={props.fg} attributes={props.bold ? TextAttributes.BOLD : undefined} wrapMode="none" truncate flexShrink={0} width={props.w} minWidth={props.w}>
      {pad(props.value, props.w, props.align ?? "left")}
    </text>
  )
}

function Stat(props: { colors: Colors; label: string; value: string; hint?: string; fg?: unknown }) {
  return (
    <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
      <Cell w={12} fg={props.colors.muted} value={props.label} />
      <text fg={props.fg ?? props.colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexShrink={0}>{props.value}</text>
      <Show when={props.hint}>
        <text fg={props.colors.dim} wrapMode="none" truncate flexShrink={1} minWidth={0}>· {props.hint}</text>
      </Show>
    </box>
  )
}

/** One horizontal timeline, split proportionally by kind — where the clock went, at a glance. */
function TimelineBar(props: { colors: Colors; view: SessionDuration; width: number; includeWaiting?: boolean }) {
  const groups = createMemo(() => durationGroups(props.view, { includeWaiting: props.includeWaiting }))
  const segments = createMemo(() => stackedBar(groups(), props.width).map(segment => ({ ...segment, run: "█".repeat(segment.cells) })))
  return (
    <box flexDirection="column" flexShrink={0}>
      {/* One <text> per segment, not coloured <span>s inside one <text>: a span's fg does not
          survive into the rendered run, and the whole bar comes out a single flat colour. */}
      <box flexDirection="row" flexWrap="no-wrap" flexShrink={0}>
        <For each={segments()}>{segment => (
          <text fg={kindFg(segment.kind, props.colors)} wrapMode="none" truncate flexShrink={0}>{segment.run}</text>
        )}</For>
      </box>
      <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0}>
        <For each={segments()}>{segment => (
          <box flexDirection="row" flexWrap="no-wrap" flexShrink={0}>
            <text fg={kindFg(segment.kind, props.colors)} wrapMode="none" flexShrink={0}>■ </text>
            <text fg={props.colors.muted} wrapMode="none" truncate flexShrink={0}>{KIND_LABEL[segment.kind]} {formatDuration(segment.ms)} {pct(segment.share)}</text>
          </box>
        )}</For>
      </box>
    </box>
  )
}

function SegmentRow(props: { colors: Colors; segment: DurationSegment }) {
  const share = () => props.segment.activeShare || props.segment.share
  const filled = () => Math.max(share() > 0 ? 1 : 0, Math.round(share() * 10))
  return (
    <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
      <Cell w={9} align="right" fg={props.colors.text} value={formatDuration(props.segment.ms)} />
      <Cell w={4} align="right" fg={props.colors.muted} value={pct(props.segment.share)} />
      <text fg={kindFg(props.segment.kind, props.colors)} wrapMode="none" truncate flexShrink={0} width={10} minWidth={10}>
        {"█".repeat(filled()) + "░".repeat(10 - filled())}
      </text>
      <text fg={props.colors.text} wrapMode="none" truncate flexShrink={1} minWidth={0}>
        {props.segment.label + (props.segment.calls ? "  (" + props.segment.calls + " calls)" : "")}
      </text>
    </box>
  )
}

function TurnRow(props: { colors: Colors; turn: SessionDuration["turns"][number]; peak: number }) {
  const filled = () => Math.max(props.turn.ms > 0 ? 1 : 0, Math.round((props.turn.ms / (props.peak || 1)) * 12))
  return (
    <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
      <Cell w={5} align="right" fg={props.colors.dim} value={"#" + props.turn.seq} />
      <text fg={props.colors.primary} wrapMode="none" truncate flexShrink={0} width={12} minWidth={12}>
        {"█".repeat(filled()) + "░".repeat(12 - filled())}
      </text>
      <Cell w={8} align="right" fg={props.colors.text} value={formatDuration(props.turn.ms)} />
      <Cell w={8} align="right" fg={props.colors.info} value={formatDuration(props.turn.toolMs)} />
      <Cell w={8} align="right" fg={props.colors.ok} value={formatDuration(props.turn.modelMs)} />
      <Cell w={4} align="right" fg={props.colors.dim} value={String(props.turn.tools)} />
    </box>
  )
}

function useSessionDuration(sessionID: () => string | undefined) {
  const [view, setView] = createSignal<SessionDuration>()
  const [failure, setFailure] = createSignal<string>()
  const refresh = () => {
    const id = sessionID()
    if (!id) { setView(undefined); setFailure("Open a conversation to graph where its time went."); return }
    try {
      const found = readSessionDurations({ sessionID: id }).sessions[0]
      if (!found) { setView(undefined); setFailure("This conversation has no recorded turns yet."); return }
      setView(found)
      setFailure(undefined)
    } catch (error) {
      setFailure("Duration unavailable: " + (error instanceof Error ? error.message : String(error)))
    }
  }
  onMount(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    onCleanup(() => clearInterval(timer))
  })
  return { view, failure, refresh }
}

export function DurationGraphScreen(props: { context: any; returnRoute?: unknown; sessionID?: string }) {
  const colors = themeColors(props.context)
  const id = () => props.sessionID ?? activeSessionID(props.context)
  const { view, failure, refresh } = useSessionDuration(id)
  const [width, setWidth] = createSignal<number>(props.context?.renderer?.width ?? 120)
  const [height, setHeight] = createSignal<number>(props.context?.renderer?.height ?? 40)
  const narrow = () => width() < 100
  const back = () => props.context?.ui?.router?.navigate?.(props.returnRoute ?? { type: "home" })
  onMount(() => {
    const renderer = props.context?.renderer
    const resize = () => { setWidth(renderer?.width ?? 120); setHeight(renderer?.height ?? 40) }
    renderer?.on?.("resize", resize)
    onCleanup(() => renderer?.off?.("resize", resize))
  })
  props.context?.keymap?.layer?.(() => ({
    mode: "global",
    commands: [
      { id: "duration-graph.close", title: "Back", bind: "escape", run: back },
      { id: "duration-graph.refresh", title: "Re-read the session", bind: "r", run: refresh },
    ],
  }))

  // Rows the terminal can actually show below this screen's fixed chrome.
  const budget = (cap: number, chrome: number) => Math.max(3, Math.min(cap, Math.floor(height()) - chrome))
  const segmentRows = () => budget(SEGMENT_ROWS, narrow() ? 32 : 20)
  const turnRows = () => budget(TURN_ROWS, 12)

  const turns = () => view()?.turns ?? []
  const peak = () => turns().reduce((n, turn) => Math.max(n, turn.ms), 0)
  const slowest = () => [...turns()].sort((a, b) => b.ms - a.ms).slice(0, turnRows())
  const segments = () => view()?.segments ?? []
  const tail = () => segments().slice(segmentRows())
  const barWidth = () => Math.max(20, Math.min(BAR_CELLS, width() - (narrow() ? 6 : 66)))

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.bg}>
      <box flexDirection="row" flexShrink={0} paddingLeft={2} paddingRight={2} backgroundColor={colors.panel} border={["bottom"]} borderColor={colors.line}>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>OPENCODE</text>
        <text fg={colors.dim}>  |  </text>
        <text fg={colors.text}>duration graph</text>
        <Show when={width() >= 120}><text fg={colors.dim}>  |  // where this conversation's time went</text></Show>
        <box flexGrow={1} />
        <text fg={colors.primary} onMouseUp={(event: any) => activate(event, refresh)}>r · Refresh  </text>
        <text fg={colors.primary} onMouseUp={(event: any) => activate(event, back)}>Esc · Back to chat</text>
      </box>

      <Show when={failure()}><text fg={colors.warn} paddingLeft={2} wrapMode="word">{failure()}</text></Show>

      <Show when={view()}>{live => (
        <box flexDirection={narrow() ? "column" : "row"} flexGrow={1} flexShrink={1} minHeight={0} gap={narrow() ? 0 : 2} paddingLeft={2} paddingRight={2}>

          <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0}>
            <text fg={colors.text} wrapMode="none" truncate flexShrink={0}>{live().title || "Untitled conversation"}</text>
            <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>{(live().agent ?? "agent not recorded") + " · " + live().sessionID}</text>
            <box height={1} flexShrink={0} />
            <Stat colors={colors} label="SESSION" value={formatDuration(live().durationMs)} hint={live().turns.length + " turns · " + live().toolCalls + " tool calls"} />
            <Stat colors={colors} label="WORKING" value={formatDuration(live().activeMs)} hint={pct(live().durationMs ? live().activeMs / live().durationMs : 0) + " of the session was actually running"} />
            <Stat colors={colors} label="IDLE" value={formatDuration(live().waitingMs)} hint="waiting on you, or on an injected input" fg={colors.muted} />
            <box height={1} flexShrink={0} />

            <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexShrink={0}>WHERE THE WORKING TIME WENT</text>
            <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>{formatDuration(live().activeMs)} on one timeline — recorded timestamps, not estimates</text>
            <box height={1} flexShrink={0} />
            <TimelineBar colors={colors} view={live()} width={barWidth()} />
            <box height={1} flexShrink={0} />

            <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
              <Cell w={9} align="right" fg={colors.muted} value="TIME" />
              <Cell w={4} align="right" fg={colors.muted} value="%" />
              <Cell w={10} fg={colors.muted} value="SHARE" />
              <text fg={colors.muted} wrapMode="none" truncate flexShrink={1} minWidth={0}>SEGMENT</text>
            </box>
            {/* Both lists are cut to the terminal's own row budget, so the screen never needs a
                scroll region — a scrollbox drew its bars over the layout even with nothing to scroll. */}
            <box flexDirection="column" flexShrink={1} minHeight={0}>
              <For each={segments().slice(0, segmentRows())}>{segment => <SegmentRow colors={colors} segment={segment} />}</For>
              <Show when={tail().length}>
                <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>
                  {pad(formatDuration(tail().reduce((n, segment) => n + segment.ms, 0)), 9, "right")}  {tail().length} smaller segments
                </text>
              </Show>
            </box>
            <box flexGrow={1} flexShrink={1} minHeight={0} />
            <text fg={colors.cap} wrapMode="none" truncate flexShrink={0}>
              {formatDuration(live().gapMs) + " unaccounted in " + live().gapCount + " gaps — median " + live().medianGapMs + "ms, longest " + formatDuration(live().longestGapMs)}
            </text>
            <Show when={live().concurrentToolMs}>
              <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>
                {"parallel calls overlapped by " + formatDuration(live().concurrentToolMs) + " — more tool work was done than the clock spent in tools"}
              </text>
            </Show>
          </box>

          <Show when={!narrow()}><box width={1} border={["left"]} borderColor={colors.line} flexShrink={0} /></Show>

          <box flexDirection="column" flexShrink={0} width={narrow() ? undefined : 52} minHeight={0}>
            <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexShrink={0}>SLOWEST TURNS</text>
            <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>each turn from its first token to its last result</text>
            <box height={1} flexShrink={0} />
            <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
              <Cell w={5} align="right" fg={colors.muted} value="SEQ" />
              <Cell w={12} fg={colors.muted} value="ELAPSED" />
              <Cell w={8} align="right" fg={colors.muted} value="TOTAL" />
              <Cell w={8} align="right" fg={colors.muted} value="TOOLS" />
              <Cell w={8} align="right" fg={colors.muted} value="MODEL" />
              <Cell w={4} align="right" fg={colors.muted} value="N" />
            </box>
            <box flexDirection="column" flexShrink={1} minHeight={0}>
              <For each={slowest()}>{turn => <TurnRow colors={colors} turn={turn} peak={peak()} />}</For>
              <Show when={!turns().length}>
                <text fg={colors.muted} wrapMode="word">No turn has been recorded for this conversation yet.</text>
              </Show>
            </box>
            <Show when={turns().length > turnRows()}>
              <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>… {turns().length - turnRows()} faster turns not shown</text>
            </Show>
            <box flexGrow={1} flexShrink={1} minHeight={0} />
          </box>

        </box>
      )}</Show>

      <text fg={colors.muted} paddingLeft={2} backgroundColor={colors.panel} flexShrink={0} wrapMode="none" truncate>
        r Refresh · Esc Back · live every {REFRESH_MS / 1000}s · same numbers as bun scripts/duration-audit.ts
      </text>
    </box>
  )
}

/**
 * The route is opened from a mounted component, and the route live right now is snapshotted first
 * so Esc returns to whatever was on screen instead of opening a new chat.
 */
function currentRoute(context: any): unknown {
  const current = typeof context?.ui?.router?.current === "function" ? context.ui.router.current() : undefined
  if (!current || current.type === "home") return { type: "home" }
  if (current.type === "session") return { type: "session", sessionID: current.sessionID }
  return { type: "plugin", id: current.id, name: current.name, ...(current.data ? { data: { ...current.data } } : {}) }
}

function openGraph(context: any) {
  try {
    const route = context.ui.router.current()
    if (route?.type === "plugin" && route.name === ROUTE) return
    const sessionID = activeSessionID(context)
    // The host's own plugin screens close the open dialog before navigating. Without this the
    // command palette that ran the command stays over the new screen and keeps the keyboard.
    context.ui.dialog.clear()
    context.ui.router.navigate({ type: "plugin", name: ROUTE, data: { ...(sessionID ? { sessionID } : {}), returnRoute: currentRoute(context) } })
  } catch (error) {
    // A command that silently does nothing is the worst outcome: say what broke.
    context?.ui?.dialog?.alert?.({ title: "Duration graph", message: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  }
}

/** keymap.layer() reads a render context, so it is called from a component mounted on "app". */
function DurationGraphCommands(props: { context: any }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "duration-graph.show",
        title: "Duration graph · where this conversation's time went",
        group: "System",
        palette: true,
        suggested: true,
        // No "time" alias: the host already owns /time, and typing it opened its Timeline dialog
        // instead of this screen.
        slash: { name: "duration-graph", aliases: ["duration"] },
        run: () => openGraph(props.context),
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "duration-graph",
  setup(context) {
    context.ui.router.register({ name: ROUTE, render: (route: any) => <DurationGraphScreen context={context} sessionID={route.data?.sessionID} returnRoute={route.data?.returnRoute} /> })
    context.ui.slot({ append: "app", render: () => <DurationGraphCommands context={context} /> })
  },
})
