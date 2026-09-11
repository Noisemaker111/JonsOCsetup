/** @jsxImportSource @opentui/solid */
/**
 * /context-graph — where the live session's tokens went, as a screen instead of a script.
 *
 * Everything here is read through context-graph/context-graph.ts, the same module
 * scripts/context-audit.ts reads through, so the screen and the CLI cannot report different
 * numbers for the same session.
 *
 * Two kinds of figure are shown and are never added together:
 *  - Recorded (cold start, per-turn sent/cached/out/cost, session totals) come straight from the
 *    provider's own counters in the host database. They are measurements.
 *  - Attributed (the stacked bar and the ranked list) are derived from the stored parts at
 *    4 chars/token. Every line carrying them says so.
 *
 * Tool metadata is stored for the TUI and never sent to the model, so it is reported on its own
 * line below the breakdown rather than as a share of the context.
 */
import { Plugin } from "../../tui-legacy"
import { TextAttributes } from "@opentui/core"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { activeSessionID } from "../../scripts/runtime-contract.mjs"
import { readSessionContexts, sliceGroups, stackedBar, type ContextSlice, type SessionContext, type SliceKind } from "../context-graph"

const ROUTE = "context-graph"
const REFRESH_MS = 2000
const BAR_CELLS = 40
const RANKED_ROWS = 14
const TURN_ROWS = 12

/**
 * Theme roles, as colour strings.
 *
 * The host theme nests these (`text.default`, `background.panel`) and several roles that read like
 * a colour are objects of variants. Handing an object to `fg` or `borderColor` takes the whole
 * screen down, so a role is taken only when it really is a string and otherwise falls back here.
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

const KIND_LABEL: Record<SliceKind, string> = {
  instructions: "injected instructions",
  prompts: "your prompts",
  assistant: "assistant text",
  reasoning: "assistant reasoning",
  "tool-input": "tool call inputs",
  "tool-result": "tool results",
  other: "other parts",
  stored: "stored, not sent",
}

function kindFg(kind: SliceKind, colors: Colors) {
  if (kind === "instructions") return colors.warn
  if (kind === "prompts") return colors.primary
  if (kind === "assistant") return colors.ok
  if (kind === "reasoning") return colors.accent
  if (kind === "tool-input") return colors.info
  if (kind === "tool-result") return colors.cap
  return colors.muted
}

const num = (value: number) => value.toLocaleString("en-US")
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

/** One horizontal bar, split proportionally by kind — the shape of the context at a glance. */
function StackedBar(props: { colors: Colors; view: SessionContext; width: number }) {
  const groups = createMemo(() => sliceGroups(props.view.slices))
  const segments = createMemo(() => stackedBar(groups(), props.width).map(segment => ({ ...segment, run: "█".repeat(segment.cells) })))
  return (
    <box flexDirection="column" flexShrink={0}>
      {/* One <text> per segment, not coloured <span>s inside one <text>: a span's fg did not
          survive into the rendered run, and the whole bar came out a single flat colour. */}
      <box flexDirection="row" flexWrap="no-wrap" flexShrink={0}>
        <For each={segments()}>{segment => (
          <text fg={kindFg(segment.kind, props.colors)} wrapMode="none" truncate flexShrink={0}>{segment.run}</text>
        )}</For>
      </box>
      <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0}>
        <For each={segments()}>{segment => (
          <box flexDirection="row" flexWrap="no-wrap" flexShrink={0}>
            <text fg={kindFg(segment.kind, props.colors)} wrapMode="none" flexShrink={0}>■ </text>
            <text fg={props.colors.muted} wrapMode="none" truncate flexShrink={0}>{KIND_LABEL[segment.kind]} {pct(segment.share)}</text>
          </box>
        )}</For>
      </box>
    </box>
  )
}

function RankedRow(props: { colors: Colors; slice: ContextSlice }) {
  const filled = () => Math.max(props.slice.share > 0 ? 1 : 0, Math.round(props.slice.share * 10))
  return (
    <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
      <Cell w={9} align="right" fg={props.colors.text} value={num(props.slice.tokens)} />
      <Cell w={4} align="right" fg={props.colors.muted} value={pct(props.slice.share)} />
      <text fg={kindFg(props.slice.kind, props.colors)} wrapMode="none" truncate flexShrink={0} width={10} minWidth={10}>
        {"█".repeat(filled()) + "░".repeat(10 - filled())}
      </text>
      <text fg={props.colors.text} wrapMode="none" truncate flexShrink={1} minWidth={0}>{props.slice.label}</text>
    </box>
  )
}

function TurnRow(props: { colors: Colors; turn: SessionContext["turns"][number]; peak: number }) {
  const filled = () => Math.max(props.turn.input > 0 ? 1 : 0, Math.round((props.turn.input / (props.peak || 1)) * 12))
  return (
    <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
      <Cell w={5} align="right" fg={props.colors.dim} value={"#" + props.turn.seq} />
      <text fg={props.colors.primary} wrapMode="none" truncate flexShrink={0} width={12} minWidth={12}>
        {"█".repeat(filled()) + "░".repeat(12 - filled())}
      </text>
      <Cell w={9} align="right" fg={props.colors.text} value={num(props.turn.input)} />
      <Cell w={9} align="right" fg={props.colors.ok} value={num(props.turn.cached)} />
      <Cell w={7} align="right" fg={props.colors.muted} value={num(props.turn.output)} />
      <Cell w={9} align="right" fg={props.colors.dim} value={"$" + props.turn.cost.toFixed(5)} />
    </box>
  )
}

function useSessionContext(context: any, sessionID: () => string | undefined) {
  const [view, setView] = createSignal<SessionContext>()
  const [failure, setFailure] = createSignal<string>()
  const refresh = () => {
    const id = sessionID()
    if (!id) { setView(undefined); setFailure("Open a conversation to graph its context."); return }
    try {
      const found = readSessionContexts({ sessionID: id }).sessions[0]
      if (!found) { setView(undefined); setFailure("This conversation has no recorded requests yet."); return }
      setView(found)
      setFailure(undefined)
    } catch (error) {
      setFailure("Context unavailable: " + (error instanceof Error ? error.message : String(error)))
    }
  }
  onMount(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    onCleanup(() => clearInterval(timer))
  })
  return { view, failure, refresh }
}

export function ContextGraphScreen(props: { context: any; returnRoute?: unknown; sessionID?: string }) {
  const colors = themeColors(props.context)
  const id = () => props.sessionID ?? activeSessionID(props.context)
  const { view, failure, refresh } = useSessionContext(props.context, id)
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
      { id: "context-graph.close", title: "Back", bind: "escape", run: back },
      { id: "context-graph.refresh", title: "Re-read the session", bind: "r", run: refresh },
    ],
  }))

  // Rows the terminal can actually show below this screen's fixed chrome.
  const budget = (cap: number, chrome: number) => Math.max(3, Math.min(cap, Math.floor(height()) - chrome))
  const rankedRows = () => budget(RANKED_ROWS, narrow() ? 30 : 18)
  const turnRows = () => budget(TURN_ROWS, 10)

  const turns = () => view()?.turns ?? []
  const peak = () => turns().reduce((n, turn) => Math.max(n, turn.input), 0)
  const shown = () => turns().slice(-turnRows())
  const latest = () => turns().at(-1)
  const sent = () => view()?.sentTokens ?? 0
  const ranked = () => (view()?.slices ?? []).filter(slice => !slice.stored)
  const tail = () => ranked().slice(rankedRows())
  const barWidth = () => Math.max(20, Math.min(BAR_CELLS, width() - (narrow() ? 6 : 66)))

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.bg}>
      <box flexDirection="row" flexShrink={0} paddingLeft={2} paddingRight={2} backgroundColor={colors.panel} border={["bottom"]} borderColor={colors.line}>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>OPENCODE</text>
        <text fg={colors.dim}>  |  </text>
        <text fg={colors.text}>context graph</text>
        <Show when={width() >= 120}><text fg={colors.dim}>  |  // where this conversation's tokens went</text></Show>
        <box flexGrow={1} />
        <text fg={colors.primary} onMouseUp={(event: any) => activate(event, refresh)}>r · Refresh  </text>
        <text fg={colors.primary} onMouseUp={(event: any) => activate(event, back)}>Esc · Back to chat</text>
      </box>

      <Show when={failure()}><text fg={colors.warn} paddingLeft={2} wrapMode="word">{failure()}</text></Show>

      <Show when={view()}>{live => (
        <box flexDirection={narrow() ? "column" : "row"} flexGrow={1} flexShrink={1} minHeight={0} gap={narrow() ? 0 : 2} paddingLeft={2} paddingRight={2}>

          <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0}>
            <text fg={colors.text} wrapMode="none" truncate flexShrink={0}>
              {live().title || "Untitled conversation"} <span fg={colors.dim}>· {live().agent ?? "agent not recorded"} · {live().sessionID}</span>
            </text>
            <box height={1} flexShrink={0} />
            <Stat colors={colors} label="COLD START" value={num(live().coldStartTokens) + " tok"} hint="first request, before any work" />
            <Stat
              colors={colors}
              label="LAST TURN"
              value={latest() ? num(latest()!.input) + " sent · " + num(latest()!.cached) + " cached" : "no request yet"}
              hint={latest() && latest()!.input + latest()!.cached > 0 ? pct(latest()!.cached / (latest()!.input + latest()!.cached)) + " of the prompt was cached" : undefined}
            />
            <Stat colors={colors} label="RECORDED" value={num(live().recorded.input) + " in / " + num(live().recorded.output) + " out"} hint={"$" + live().recorded.cost.toFixed(4) + " · " + turns().length + " turns"} />
            <box height={1} flexShrink={0} />

            <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexShrink={0}>WHAT IS IN THE CONTEXT</text>
            <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>~{num(sent())} tok attributed from the stored parts at 4 chars/token — an estimate, not a counter</text>
            <box height={1} flexShrink={0} />
            <StackedBar colors={colors} view={live()} width={barWidth()} />
            <box height={1} flexShrink={0} />

            <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
              <Cell w={9} align="right" fg={colors.muted} value="TOK" />
              <Cell w={4} align="right" fg={colors.muted} value="%" />
              <Cell w={10} fg={colors.muted} value="SHARE" />
              <text fg={colors.muted} wrapMode="none" truncate flexShrink={1} minWidth={0}>SOURCE</text>
            </box>
            {/* Both lists are cut to the terminal's own row budget, so the screen never needs a
                scroll region — a scrollbox drew its bars over the layout even with nothing to scroll. */}
            <box flexDirection="column" flexShrink={1} minHeight={0}>
              <For each={ranked().slice(0, rankedRows())}>{slice => <RankedRow colors={colors} slice={slice} />}</For>
              <Show when={tail().length}>
                <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>
                  {pad(num(tail().reduce((n, slice) => n + slice.tokens, 0)), 9, "right")}  {tail().length} smaller sources
                </text>
              </Show>
            </box>
            <box flexGrow={1} flexShrink={1} minHeight={0} />
            <Show when={live().storedOnlyTokens}>
              <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>
                + {num(live().storedOnlyTokens)} tok of tool metadata stored for the TUI — never sent to the model, so not context
              </text>
            </Show>
          </box>

          <Show when={!narrow()}><box width={1} border={["left"]} borderColor={colors.line} flexShrink={0} /></Show>

          <box flexDirection="column" flexShrink={0} width={narrow() ? undefined : 56} minHeight={0}>
            <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexShrink={0}>TURNS · SENT vs CACHED</text>
            <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>recorded by the provider for each request</text>
            <box height={1} flexShrink={0} />
            <box flexDirection="row" flexWrap="no-wrap" gap={1} flexShrink={0}>
              <Cell w={5} align="right" fg={colors.muted} value="SEQ" />
              <Cell w={12} fg={colors.muted} value="GROWTH" />
              <Cell w={9} align="right" fg={colors.muted} value="SENT" />
              <Cell w={9} align="right" fg={colors.muted} value="CACHED" />
              <Cell w={7} align="right" fg={colors.muted} value="OUT" />
              <Cell w={9} align="right" fg={colors.muted} value="COST" />
            </box>
            <Show when={turns().length > turnRows()}>
              <text fg={colors.dim} wrapMode="none" truncate flexShrink={0}>… {turns().length - turnRows()} earlier turns</text>
            </Show>
            <box flexDirection="column" flexShrink={1} minHeight={0}>
              <For each={shown()}>{turn => <TurnRow colors={colors} turn={turn} peak={peak()} />}</For>
              <Show when={!turns().length}>
                <text fg={colors.muted} wrapMode="word">No request has been recorded for this conversation yet.</text>
              </Show>
            </box>
            <box flexGrow={1} flexShrink={1} minHeight={0} />
          </box>

        </box>
      )}</Show>

      <text fg={colors.muted} paddingLeft={2} backgroundColor={colors.panel} flexShrink={0} wrapMode="none" truncate>
        r Refresh · Esc Back · live every {REFRESH_MS / 1000}s · same numbers as bun scripts/context-audit.ts
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
    context?.ui?.dialog?.alert?.({ title: "Context graph", message: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  }
}

/** keymap.layer() reads a render context, so it is called from a component mounted on "app". */
function ContextGraphCommands(props: { context: any }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "context-graph.show",
        title: "Context graph · where this conversation's tokens went",
        group: "System",
        palette: true,
        suggested: true,
        slash: { name: "context-graph", aliases: ["tokens"] },
        run: () => openGraph(props.context),
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "context-graph",
  setup(context) {
    context.ui.router.register({ name: ROUTE, render: (route: any) => <ContextGraphScreen context={context} sessionID={route.data?.sessionID} returnRoute={route.data?.returnRoute} /> })
    context.ui.slot({ append: "app", render: () => <ContextGraphCommands context={context} /> })
  },
})
