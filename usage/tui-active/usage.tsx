import { extensionInventoryText } from "../../scripts/extension-inventory.mjs"
import { UsageEvidencePanel } from "./usage-evidence"
import { sessionTokenLine } from "../session-count"
import { activeSessionID, requestManagedRestart } from "../../scripts/runtime-contract.mjs"
/** @jsxImportSource @opentui/solid */
// /usage (and palette live-sessions) as TUI dialogs — never a synthetic chat turn.
//
// Load shape required by the opencode2 TUI: default export is an object with a
// non-empty `id` and a `setup` function. Plugin.define({ id, setup }) matches.
// The TUI finds this file through `plugins` in cli.json — NOT through
// tui.json, whose `plugin` array the host stopped reading in beta-18684 and
// now only reads when migrating a config that has no cli.json at all.
//
// Slash autocomplete reads entry.command.slash — an object, `{ name }` — from
// keymap.getCommandEntries({ visibility: "reachable" }). The pre-18684 host
// read a flat `slashName` string; that field is gone, and a command carrying
// only slashName registers into the palette but never gets a slash trigger,
// which is exactly how /usage disappeared. Commands need name + slash +
// namespace "palette". Do not collide with host /sessions (session.list).
import { Plugin } from "../../tui-legacy"
import { TextAttributes } from "@opentui/core"
import { createSignal, onCleanup, onMount, For, Show } from "solid-js"
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import {
  COL,
  DIALOG_INNER,
  MONEY_WIDTH,
  TABLE_WIDTH,
  formatSubtitle,
  formatWindowRow,
  formatForecast,
  formatSparkline,
  fmtBar,
  MISSING,
  pad,
  pctTone,
  sourceHint,
  sourceTitle,
  sourceState,
  sourceStateLabel,
  sourceStateTone,
  sourceUsesMoney,
  type SourceState,
  type PctTone,
  type UsageRowOut,
} from "../tui-usage-format"
import { openTuiDialog } from "../tui-dialog"
import { usageCache as sharedUsageCache, ensureUsageCache } from "../usage-lib"
import { getUsageStatus } from "../status-api"
import { aggregateTelemetry } from "../telemetry"
import { readRequests } from "../telemetry-store"
import { timelineLines } from "../timeline"
import { telemetryLines } from "../telemetry-view"

const DEBUG = join(homedir(), ".local", "state", "opencode", "tui-usage.log")
function dbg(msg: string): void {
  try {
    mkdirSync(dirname(DEBUG), { recursive: true })
    appendFileSync(DEBUG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

const CONFIG = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode")
const USAGE_PLANS = join(CONFIG, "usage", "usage-plans.json")
const USAGE_STALE_MS = 30_000
// The collector probes fallback endpoints concurrently, but the Go API still
// has an 8s request budget. Leave headroom for process startup and JSON I/O;
// 8s caused the TUI to kill otherwise successful refreshes.
const COLLECT_AWAIT_MS = 15_000

type UsageWindow = {
  label: string
  usedTokens: number
  used: number
  cap: number | null
  pct: number | null
  estimated?: boolean
  resetsInSeconds: number | null
  status?: string
  prediction?: { state?: string; horizonSeconds?: number | null }
}
type UsageSource = {
  id: string
  displayName?: string
  observedAt?: string
  accountID?: string
  kind?: string
  windows?: UsageWindow[]
  probe?: string
  probeDetail?: string
  apiCapHit?: boolean
  apiCapDetail?: string
}
type UsageCache = { updated: string; sources: UsageSource[] }
type UsageRow = UsageRowOut
type UsageBlock = { id: string; title?: string; doc?: string; rows: UsageRow[]; state: SourceState; sparkline?: string; forecast?: string; empty: boolean }
type UsageView = {
  updated: string
  age: string
  stale: boolean
  collectFailed: boolean
  blocks: UsageBlock[]
  error?: string
}
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function usageAgeMs(cache: UsageCache | undefined): number {
  if (!cache || typeof cache.updated !== "string") return Infinity
  const t = Date.parse(cache.updated)
  if (!Number.isFinite(t)) return Infinity
  return Date.now() - t
}

function formatAgeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms === Infinity) return "unknown"
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}

function themeColors(context: any) {
  const theme = context?.theme
  const current = theme?.current ?? theme
  const text = current?.text?.default ?? current?.text
  const muted = current?.text?.muted ?? current?.textMuted ?? text
  return {
    text,
    muted,
    ok: current?.success ?? text,
    warn: current?.warning ?? text,
    cap: current?.error ?? text,
  }
}

function toneFg(tone: PctTone, colors: ReturnType<typeof themeColors>) {
  if (tone === "ok") return colors.ok
  if (tone === "warn") return colors.warn
  if (tone === "cap") return colors.cap
  return colors.muted
}

// Sized to content: the box grows to fit every source block up to the terminal's
// real headroom, instead of an arbitrary 20-line cap that forced a scrollbar at
// the typical 9-10 source scale even when the terminal had room to show it all.
function contentHeight(lines: number, context: any): number {
  const height = Number(context?.renderer?.height)
  const cap = Number.isFinite(height) && height > 0 ? Math.max(6, Math.min(40, Math.floor(height) - 12)) : 24
  return Math.max(3, Math.min(cap, lines))
}

// Mirrors UsageTable's actual layout: one shared WIN/BAR/%/RESET header for
// every non-empty block (not one per block), and every fully-blank shell
// (see cacheToView's `empty`) packed into one grouped list at the bottom
// instead of a full header+rows table each — at the typical 9-10
// configured-source scale, several sources are unknown shells with nothing
// to show, and giving each its own 5-line table is what forced a scrollbar
// even though most of that height rendered nothing but dashes.
//
// The per-source hint (see sourceHint) rides on the title line instead of
// its own annotation line — folding it in is free since the title line is
// already charged, and at the common 10-source scale it was the difference
// between the dialog fitting ROWS=40's cap and forcing a scrollbar.
function usageLines(view: UsageView | undefined): number {
  if (!view) return 3
  let lines = view.error || view.collectFailed ? 1 : 0
  const nonEmpty = view.blocks.filter((b) => !b.empty)
  const empty = view.blocks.filter((b) => b.empty)
  if (nonEmpty.length) lines += 1 // shared header row
  for (const block of nonEmpty) {
    lines += 1 + block.rows.length // title line (carries the hint) + one line per window row
    if (block.sparkline || block.forecast) lines += 1 // sparkline/forecast annotation line
    lines += 1 // gap to the next top-level block
  }
  if (empty.length) lines += empty.length + 1 // one line per shell + trailing gap
  return Math.max(3, lines)
}

function keysOf(value: unknown): string {
  if (!value || typeof value !== "object") return "(none)"
  return Object.keys(value as object).sort().join(",")
}

function slashNameOf(command: Record<string, unknown>): string | undefined {
  if (typeof command.slashName === "string" && command.slashName) return command.slashName
  const slash = command.slash
  if (slash && typeof slash === "object" && typeof (slash as { name?: unknown }).name === "string") {
    return (slash as { name: string }).name
  }
  return undefined
}

function cacheToView(cache: UsageCache, collectFailed = false): UsageView {
  const plans = (readJson(USAGE_PLANS) as { plans?: Record<string, { doc?: string }> } | undefined) ?? {}
  const age = usageAgeMs(cache)
  const blocks: UsageBlock[] = []
  for (const source of cache.sources ?? []) {
    const ctx = { id: source.id, kind: source.kind }
    const allWindows = source.windows ?? []
    // Money-ledger sources (variation B): lead with 7d/30d spend, skip the
    // noisier 5h row, and surface a real spend sparkline + forecast built
    // from the already-collected windows — never a fabricated time series.
    const money = sourceUsesMoney(source.id, source.kind)
    const visibleWindows = money ? allWindows.filter((w) => w.label !== "5h") : allWindows
    const allRows: UsageRow[] = visibleWindows.map((w) => formatWindowRow(w, ctx))
    if (!allRows.length && !source.accountID) continue
    const sparkline = money ? formatSparkline(allWindows.map((w) => w.used)) : undefined
    const forecast = money
      ? formatForecast(allWindows.find((w) => w.label === "7d")?.prediction) ??
        formatForecast(allWindows.find((w) => w.label === "30d")?.prediction)
      : undefined
    const empty = allRows.every((r) => r.metric === MISSING && r.pct === MISSING) && !sparkline && !forecast
    // A blank window row (no pct, no money) costs a full line for zero signal.
    // Once the block has at least one informative row, drop the rest — the
    // empty-block collapse above already handles the all-blank case.
    const rows = empty ? allRows : allRows.filter((r) => r.metric !== MISSING || r.pct !== MISSING)
    blocks.push({
      id: source.id,
      title: source.displayName,
      doc: source.accountID ? source.probeDetail : plans.plans?.[source.id]?.doc,
      rows,
      state: sourceState(source, { stale: source.observedAt != null ? usageAgeMs({ updated: source.observedAt, sources: [] }) >= USAGE_STALE_MS : age >= USAGE_STALE_MS }),
      sparkline,
      forecast,
      empty,
    })
  }
  return {
    updated: cache.updated,
    age: formatAgeMs(age),
    stale: age >= USAGE_STALE_MS,
    collectFailed,
    blocks,
  }
}

function readCachedUsageView(): UsageView | undefined {
  const cache = sharedUsageCache() as UsageCache | undefined
  if (!cache || !Array.isArray(cache.sources)) return undefined
  return cacheToView(cache, false)
}

async function refreshUsageView(): Promise<UsageView> {
  const result = await ensureUsageCache()
  const collect = { ok: !result.collectFailed }
  const cache = result.cache as UsageCache | undefined
  if (!cache) {
    return {
      updated: "",
      age: "unknown",
      stale: true,
      collectFailed: !collect.ok,
      blocks: [],
      error: collect.ok ? "No usage data yet." : "No usage data yet. Collect failed or timed out.",
    }
  }
  return cacheToView(cache, !collect.ok)
}

/**
 * Open a dialog on the live host.
 *
 * beta-18684's ui.dialog is { alert, clear, confirm, prompt, select, set,
 * show } — `replace` is gone. `show(render, onClose?)` is its direct
 * replacement and is what alert/confirm/prompt/select are built on. Guarding
 * on the missing `replace` made every usage dialog invocation a silent
 * no-op: the command ran, found no method, and returned.
 */
function openDialog(context: any, render: () => unknown) {
  const dialog = context?.ui?.dialog
  openTuiDialog(dialog, render, (error) => dbg(`${error}; keys=${keysOf(dialog)}`))
}

function activateOnMouseUp(event: any, action: () => void): void {
  try { event?.stopPropagation?.() } catch {}
  action()
}

function inspectRegistered(keymap: any, when: string) {
  try {
    const raw = keymap?.commands
    const list = typeof raw === "function" ? raw() : raw
    const arr = Array.isArray(list) ? list : []
    const ours = arr.filter((cmd: Record<string, unknown>) => {
      const name = String(cmd?.name ?? cmd?.id ?? "")
      const slashName = slashNameOf(cmd) ?? ""
      return /usage|running|sessions|tasks/.test(`${name} ${slashName}`)
    })
    const hasUsageShow = arr.some((cmd: Record<string, unknown>) => {
      const name = String(cmd?.name ?? cmd?.id ?? "")
      return name === "usage.show" || cmd?.id === "usage.show"
    })
    const usageSlash = ours.find((cmd: Record<string, unknown>) => slashNameOf(cmd) === "usage")
    dbg(
      `${when} keymap.commands type=${typeof raw} count=${arr.length} ` +
        `usage.show=${hasUsageShow ? "yes" : "NO"} slashName=usage=${usageSlash ? "yes" : "NO"} ` +
        `firstKeys=${keysOf(arr[0])}`,
    )
    for (const cmd of ours) {
      const name = String(cmd?.name ?? cmd?.id ?? "")
      const slashName = slashNameOf(cmd) ?? ""
      dbg(
        `${when} registered name=${name} id=${cmd?.id ?? ""} slashName=${slashName || "(empty)"} ` +
          `slash=${JSON.stringify(cmd?.slash)} namespace=${cmd?.namespace ?? ""} ` +
          `palette=${String(cmd?.palette ?? "")} group=${cmd?.group ?? ""} keys=${keysOf(cmd)}`,
      )
    }
    if (!hasUsageShow) {
      const sample = arr
        .slice(0, 12)
        .map((cmd: Record<string, unknown>) => String(cmd?.id ?? cmd?.name ?? "?"))
        .join(",")
      dbg(`${when} usage.show missing; sample ids=${sample}`)
    }
  } catch (error) {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
    dbg(`${when} inspect registered failed: ${text}`)
  }
}

function ColText(props: { w: number; align: "left" | "right"; fg: unknown; bold?: boolean; value: string }) {
  return (
    <text
      fg={props.fg}
      attributes={props.bold ? TextAttributes.BOLD : undefined}
      wrapMode="none"
      truncate
      flexShrink={0}
      width={props.w}
      minWidth={props.w}
    >
      {pad(props.value, props.w, props.align)}
    </text>
  )
}

function UsageSkeleton(props: { colors: ReturnType<typeof themeColors> }) {
  const bar = "░░░░░░░░░░░░░░░░░░░░"
  return (
    <box flexDirection="column" gap={0} flexShrink={0} minWidth={TABLE_WIDTH}>
      <text fg={props.colors.muted} wrapMode="none" truncate flexShrink={0}>
        {bar}
      </text>
      <text fg={props.colors.muted} wrapMode="none" truncate flexShrink={0}>
        {bar}
      </text>
      <text fg={props.colors.muted} wrapMode="none" truncate flexShrink={0}>
        {bar}
      </text>
    </box>
  )
}

function UsageTable(props: { context: any; view: UsageView }) {
  const colors = themeColors(props.context)
  return (
    <box flexDirection="column" gap={1} minWidth={TABLE_WIDTH} flexShrink={0}>
      <Show when={props.view.collectFailed}>
        <text fg={colors.warn} wrapMode="none" truncate flexShrink={0}>
          update failed · last cache
        </text>
      </Show>
      <Show when={props.view.error}>
        <text fg={colors.cap} wrapMode="none" truncate flexShrink={0}>
          {props.view.error}
        </text>
      </Show>
      <Show when={props.view.blocks.some((b) => !b.empty)}>
        <box flexDirection="row" flexWrap="no-wrap" gap={2} flexShrink={0} minWidth={TABLE_WIDTH}>
          <ColText w={COL.win} align="left" fg={colors.muted} value="WIN" />
          <ColText w={COL.bar} align="left" fg={colors.muted} value="BAR" />
          <ColText w={COL.pct} align="right" fg={colors.muted} value="%" />
          <ColText w={COL.reset} align="right" fg={colors.muted} value="RESET" />
        </box>
      </Show>
      <For each={props.view.blocks.filter((b) => !b.empty)}>
        {(block) => {
          const hint = sourceHint(block.id, block.doc)
          return (
            <box flexDirection="column" gap={0} minWidth={TABLE_WIDTH} flexShrink={0}>
              <box flexDirection="row" gap={1} flexWrap="no-wrap" flexShrink={0}>
                <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexShrink={0}>
                  {block.title ?? sourceTitle(block.id)}
                </text>
                <text fg={toneFg(sourceStateTone(block.state), colors)} wrapMode="none" truncate flexShrink={0}>
                  · {sourceStateLabel(block.state)}
                </text>
                <Show when={hint}>
                  <text fg={colors.muted} wrapMode="none" truncate flexShrink={0}>
                    · {hint}
                  </text>
                </Show>
              </box>
              <For each={block.rows}>
                {(row) => (
                  <box flexDirection="row" flexWrap="no-wrap" gap={2} flexShrink={0} minWidth={TABLE_WIDTH}>
                    <ColText w={COL.win} align="left" fg={colors.text} value={row.window} />
                    <Show when={row.showBar}>
                      <ColText w={COL.bar} align="left" fg={toneFg(row.pctTone, colors)} value={row.bar} />
                      <ColText
                        w={COL.pct}
                        align="right"
                        fg={toneFg(row.pctTone, colors)}
                        bold={row.pctTone !== "none"}
                        value={row.pct}
                      />
                    </Show>
                    <Show when={!row.showBar}>
                      <ColText w={MONEY_WIDTH} align="left" fg={colors.text} value={row.metric} />
                    </Show>
                    <ColText
                      w={COL.reset}
                      align="right"
                      fg={row.reset.startsWith("reset") ? colors.muted : colors.text}
                      value={row.reset}
                    />
                  </box>
                )}
              </For>
              <Show when={block.sparkline || block.forecast}>
                <box flexDirection="row" gap={2} flexWrap="no-wrap" flexShrink={0}>
                  <Show when={block.sparkline}>
                    <text fg={colors.muted} wrapMode="none" truncate flexShrink={0}>
                      {block.sparkline}
                    </text>
                  </Show>
                  <Show when={block.forecast}>
                    <text fg={colors.warn} wrapMode="none" truncate flexShrink={0}>
                      {block.forecast}
                    </text>
                  </Show>
                </box>
              </Show>
            </box>
          )
        }}
      </For>
      <Show when={props.view.blocks.some((b) => b.empty)}>
        <box flexDirection="column" gap={0} minWidth={TABLE_WIDTH} flexShrink={0}>
          <For each={props.view.blocks.filter((b) => b.empty)}>
            {(block) => (
              <box flexDirection="row" gap={1} flexWrap="no-wrap" flexShrink={0} minWidth={TABLE_WIDTH}>
                <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate flexShrink={0}>
                  {block.title ?? sourceTitle(block.id)}
                </text>
                <text fg={toneFg(sourceStateTone(block.state), colors)} wrapMode="none" truncate flexShrink={0}>
                  · {sourceStateLabel(block.state)} · no usage tracked
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

export function ConversationTelemetry(props: { context: any }) {
  const colors = themeColors(props.context)
  const [summary, setSummary] = createSignal<Awaited<ReturnType<typeof getUsageStatus>>>()
  const [workers, setWorkers] = createSignal(false)
  const [history,setHistory]=createSignal(false),[offset,setOffset]=createSignal(0),[hours,setHours]=createSignal(0)
  const [scope,setScope]=createSignal<{kind:string;id?:string}>({kind:activeSessionID(props.context)?"session":"all"})
  const [choosingScope,setChoosingScope]=createSignal(false),[questID,setQuestID]=createSignal("")
  const applyScope=(value:{kind:string;id?:string})=>{setScope(value);setOffset(0);setChoosingScope(false);void refresh()}
  const [failure, setFailure] = createSignal("")
  let disposed = false
  const refresh = async () => {
    const sessionID = activeSessionID(props.context)
    if (!sessionID && scope().kind==="session") { setFailure("Select a conversation to inspect its usage."); return }
    try { const value = await getUsageStatus({ sessionID:scope().kind==="session"?sessionID:undefined,questID:scope().kind==="quest"?scope().id:undefined,accountID:scope().kind==="account"?scope().id:undefined,includeWorkers: workers(),offset:offset(),limit:10,from:hours()?Date.now()-hours()*3600000:undefined }); if (!disposed) { setSummary(value); setFailure("") } }
    catch { if (!disposed) setFailure("Conversation telemetry unavailable; retrying.") }
  }
  onMount(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); onCleanup(() => { disposed = true; clearInterval(timer) }) })
  return <box flexDirection="column" flexShrink={0}>
    <text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate>Usage · {scope().kind}</text>
    <text fg={colors.primary} wrapMode="none" truncate onMouseUp={(event: any) => activateOnMouseUp(event, () => { setWorkers(!workers()); void refresh() })}>{workers() ? "Including workers · click to exclude" : "Excluding workers · click to include"}</text>
    <box flexDirection="row" gap={2}>
      <text fg={colors.primary} onMouseUp={()=>setChoosingScope(!choosingScope())}>Choose scope</text>
      <text fg={colors.primary} onMouseUp={()=>{const values=[0,1,24,168];setHours(values[(values.indexOf(hours())+1)%values.length]);setOffset(0);void refresh()}}>{hours()?"Last "+hours()+"h":"All time"}</text>
      <text fg={colors.primary} onMouseUp={()=>setHistory(!history())}>{history()?"Hide history":"Show history"}</text>
    </box>
    <Show when={choosingScope()}>
      <box flexDirection="row" gap={2}>
        <text fg={colors.primary} onMouseUp={()=>applyScope({kind:"session"})}>Current conversation</text>
        <text fg={colors.primary} onMouseUp={()=>applyScope({kind:"all"})}>All recorded sessions</text>
      </box>
      <For each={summary()?.accounts??[]}>{account=><text fg={colors.primary} onMouseUp={()=>applyScope({kind:"account",id:account.id})}>{account.provider} · {account.id.slice(-6)}</text>}</For>
      <box flexDirection="row" gap={2}>
        <input width={30} placeholder="Quest ID" value={questID()} onInput={setQuestID} onSubmit={()=>{if(questID().trim())applyScope({kind:"quest",id:questID().trim()})}} />
        <text fg={colors.primary} onMouseUp={()=>{if(questID().trim())applyScope({kind:"quest",id:questID().trim()})}}>Apply Quest</text>
      </box>
    </Show>
    <Show when={failure()}><text fg={colors.warn} wrapMode="none" truncate>{failure()}</text></Show>
    <Show when={summary()}><For each={telemetryLines(summary()!.telemetry)}>{line => <text fg={colors.muted} wrapMode="none" truncate>{line}</text>}</For></Show>
    <Show when={history() && summary()}>
      <text fg={colors.muted}>UTC time · context / request / cumulative known tokens</text>
      <For each={timelineLines(summary()!.telemetry.timeline)}>{line=><text fg={colors.muted} wrapMode="word">{line}</text>}</For>
      <box flexDirection="row" gap={2}><text fg={colors.primary} onMouseUp={()=>{setOffset(Math.max(0,offset()-10));void refresh()}}>Previous</text><text fg={colors.primary} onMouseUp={()=>{const next=summary()?.telemetry.nextOffset;if(next!==null&&next!==undefined){setOffset(next);void refresh()}}}>Next</text></box>
    </Show>
  </box>
}

export function UsageDialog(props: { context: any }) {
  const colors = themeColors(props.context)
  return <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1} flexDirection="column" width="100%" backgroundColor={props.context.theme?.current?.background ?? props.context.theme?.background}>
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text} attributes={TextAttributes.BOLD}>Subscription usage</text>
      <text fg={colors.muted} onMouseUp={() => props.context.ui.dialog.clear()}>Esc</text>
    </box>
    <scrollbox height={contentHeight(40, props.context)} scrollbarOptions={{ visible: true }}>
      <UsageEvidencePanel context={props.context} />
    </scrollbox>
  </box>
}

// The last measured request context is separate from cumulative conversation usage.
function useContextGauge(context: any, sessionTotals = false) {
  const [text, setText] = createSignal<string>("unavailable")
  const [pct] = createSignal<number | null>(null)
  const refresh = () => {
    const sessionID = activeSessionID(context)
    if (!sessionID) { setText("unavailable"); return }
    try {
      const stored = readRequests(), current = aggregateTelemetry(stored.records, { sessionID }).context.current
      setText(sessionTotals ? sessionTokenLine(stored.records,sessionID) : current ? current.tokens.toLocaleString("en-US") + " at last request · " + Math.max(0, Math.floor((Date.now()-current.at)/1000)) + "s ago" : "unavailable")
    } catch { setText("unavailable · read failed") }
  }
  onMount(() => { refresh(); const timer = setInterval(refresh, 2000); onCleanup(() => clearInterval(timer)) })
  return { text, pct }
}

// Session token totals. The Quest count and the Quest Log belong to the quests
// plugin, which owns its own slots; this footer used to duplicate both, which
// reached across a plugin boundary and rendered the count twice once quests
// mounted its own chrome.
export function ContextFooter(props: { context: any }) {
  const context: any = props.context
  const { text: usage } = useContextGauge(context,true)
  const colors = themeColors(context)
  return <text fg={colors.muted} wrapMode="none" truncate aria-label="Open usage details" onMouseUp={(event: any) => activateOnMouseUp(event, () => openDialog(context, () => <UsageDialog context={context} />))}>↓ {usage()}</text>
}

// Cockpit header (variation C): the current session's context gauge, mounted
// at the top of the /usage dialog above the money ledger.
function ContextGauge(props: { context: any }) {
  const { text, pct } = useContextGauge(props.context)
  const colors = themeColors(props.context)
  return (
    <box flexDirection="row" gap={1} flexWrap="no-wrap" flexShrink={0} minWidth={DIALOG_INNER}>
      <text fg={colors.muted} wrapMode="none" truncate flexShrink={0}>
        Context
      </text>
      <Show when={pct() != null}>
        <text fg={toneFg(pctTone(pct()), colors)} wrapMode="none" truncate flexShrink={0}>
          {fmtBar(pct())}
        </text>
      </Show>
      <text fg={colors.text} wrapMode="none" truncate flexShrink={0}>
        {text()}
      </text>
    </box>
  )
}

/**
 * Commands are registered from a rendered component, never from setup().
 *
 * keymap.layer() reads the Keymap context, which only exists while something
 * is rendering: called from setup() it throws "Keymap.Provider is missing" and
 * no command is ever registered. Built-in /diff registers from a component
 * mounted at the "app" slot, so this does the same. The pre-18684 host had the
 * opposite shape — keymap.registerLayer() from setup() — and that method no
 * longer exists, which is how /usage disappeared.
 */
function runHostScript(context: any, args: string[], title: string, message: string) {
  try {
    const script = join(CONFIG, "scripts", "restart-opencode.ps1")
    const child = spawn("pwsh", ["-NoProfile", "-File", script, ...args], { windowsHide: true, stdio: "ignore", detached: true })
    child.unref?.()
    try { context.ui.toast?.show?.({ title, message, variant: "info" }) } catch {}
    try {
      context.ui.dialog?.show?.(() => (
        <box padding={1} flexDirection="column" gap={1}>
          <text>{title}</text>
          <text>{message}</text>
        </box>
      ))
      setTimeout(() => {
        try { context.ui.dialog.clear() } catch {}
      }, 1800)
    } catch {}
    dbg(`${title} spawned`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    try { context.ui.toast?.show?.({ title, message: `Failed: ${msg}`, variant: "error" }) } catch {}
    dbg(`${title} failed: ${msg}`)
  }
}

function runRestart(context: any) {
  const sessionID = activeSessionID(context)
  if (requestManagedRestart(sessionID)) {
    try { context.ui.toast?.show?.({ title: "Restarting", message: "Reloading the selected release and resuming this session.", variant: "info" }) } catch {}
    return
  }
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
  const command = "node " + quote(join(import.meta.dir, "../../scripts/opencode-runtime.mjs")) + " --no-deploy --cwd " + quote(process.cwd()) + (sessionID ? " --session " + quote(sessionID) : "")
  context.ui.dialog.alert({ title: "Restart this terminal safely", message: "Close only this OpenCode terminal, then run this command in PowerShell to reload the selected release and resume this conversation:\n\n" + command + "\n\nOther terminals can stay running." })
}

function runUpdate(context: any) {
  runHostScript(context, ["-Update"], "Updating", "Installing @opencode-ai/cli@latest, then relaunching opencode2.")
}

function UsageCommands(props: { context: any }) {
  try {
    props.context.keymap.layer(() => ({
      mode: "global",
      commands: [
        { id: "extensions.show", title: "Installed extensions and release", group: "System", palette: true, slash: { name: "extensions" }, run: () => props.context.ui.dialog.alert({ title: "Extensions and release", message: extensionInventoryText(join(import.meta.dir, "../..")) }) },
        {
          id: "usage.show",
          title: "Subscription usage",
          group: "System",
          palette: true,
          suggested: true,
          slash: { name: "usage" },
          run: () => openDialog(props.context, () => <UsageDialog context={props.context} />),
        },
        {
          id: "restart.service",
          title: "Reload this terminal’s selected release",
          group: "System",
          palette: true,
          suggested: true,
          slash: { name: "restart" },
          run: () => runRestart(props.context),
        },
        {
          id: "update.cli",
          title: "Update opencode2 CLI and relaunch",
          group: "System",
          palette: true,
          suggested: true,
          slash: { name: "update" },
          run: () => runUpdate(props.context),
        },
      ],
    }))
    dbg(`keymap.layer ok keymapKeys=${keysOf(props.context?.keymap)}`)
    inspectRegistered(props.context?.keymap, "after-layer")
  } catch (error) {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
    dbg(`keymap.layer failed: ${text}`)
    console.error("[usage] keymap.layer failed", error)
  }
  return null
}

/**
 * Slots are ui.slot({ append, render }) with dotted names ("app",
 * "prompt.footer", "sidebar.content", ...). The underscored
 * slots.register({ slots: { app_bottom } }) API is gone; calling it throws.
 */
export default Plugin.define({
  id: "usage",
  setup(context) {
    try {
      context.ui.slot({ append: "app", render: () => <UsageCommands context={context} /> })
      dbg("ui.slot(app) ok")
    } catch (error) {
      const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
      dbg(`ui.slot(app) failed: ${text}`)
      console.error("[usage] ui.slot(app) failed", error)
    }
    try {
      context.ui.slot({ append: "prompt.footer", render: () => <ContextFooter context={context} /> })
      dbg("ui.slot(prompt.footer) ok")
    } catch (error) {
      const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
      dbg(`ui.slot(prompt.footer) failed: ${text}`)
      console.error("[usage] ui.slot(prompt.footer) failed", error)
    }
  },
})
