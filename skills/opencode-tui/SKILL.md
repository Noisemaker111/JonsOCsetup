---
name: opencode-tui
description: Use when building or polishing TUI chrome for OpenCode2 plugins — slot chrome, dialogs, theme/colors, layout, and making it look good. Covers the host bridge (Plugin.define, slots, keymap.layer, dialog) + the OpenTUI beauty layer (flexbox, Box/Text, tables, scroll, testing).
---

# OpenCode TUI — build UI that looks good

This skill is the **bridge** between the generic `opentui` skill (OpenTUI primitives) and the **OpenCode2 host** that actually loads your plugin. Use both together:

- `opentui` — Yoga flexbox, Box/Text/Select/ScrollBox, colors, testing via `testRender`/`createTestRenderer`.
- `opencode-tui` (this file) — how to mount inside the host without silently failing, and how to make it *look good* in the tiny slots OpenCode gives you.

If you only read one section, read **Host brick invariants** — breaking any of those makes the UI mount nowhere and no error is shown.

## Recorded host contracts — revalidate after host updates

These notes combine observations from multiple historical beta builds. Read the installed package versions and isolated host receipts before relying on them. Check host behavior and SDK types together; neither a stale version in this skill nor a type declaration alone proves runtime support.

- **Export shape:** `export default Plugin.define({ id, setup })` where `id` === filename stem. `{ id, tui }` without `setup` is rejected as *Invalid V2 TUI plugin module* (verify by loading the plugin in the installed host).
- **Mount chrome via `context.ui.slot({ <placement>: "<slot>", render })`** where placement is exactly one of `prepend | append | before | after | replace`. Two or none throws *Slot claim requires exactly one placement key*. `context.slots.register` / `context.keymap.registerLayer` / `ui.dialog.replace` are **gone** — each throws and takes the rest of `setup()` down. Grep `tui-usage.log` for `undefined is not an object (evaluating 'context.slots.register')`.
- **Slot names are dotted** (host renderer paths): `app` · `home.footer` · `prompt.footer` · `prompt.footer.file` · `prompt.footer.status` · `session.composer.top` · `sidebar.content` · `sidebar.footer`. Underscored `app_bottom` / `sidebar_content` never matches. Inspect the current installed renderer when the host changes.
  - `app` renders nothing itself; mount a component there **just to get a render context** for `keymap.layer()`.
  - `prompt.footer` is the always-present composer footer (count/badge lives here).
  - `sidebar.content` / `sidebar.footer` render beside Subagents and receive `{ sessionID }`.
  - Native Quest workers use real root sessions in owned workspaces. Open their native sessions through the board or /session. The role strip and session titles distinguish workers from the one giver; /giver returns to that same conversation. Native subagent chips remain the host's own navigation for native child sessions.
  - **beta-19059+:** `cli.json` `plugins` entries must be plugin **directories** (`./tui-bootstrap/quests`), resolved by the host as `<dir>/tui.tsx` (`Host.resolve` in `@opencode-ai/plugin/host`). An entry that names a **file** is skipped silently — no toast, no log line, the plugin just never appears (this is how the Quest board vanished after the 18999 -> 19059 auto-update). `tui.json` is dead: the host only reads it to seed a missing `cli.json`. Failures that do surface show as a toast plus `/plugins`.
- **Commands via `context.keymap.layer(() => ({ mode, commands }))` from a *mounted* component.** Calling from `setup()` throws `Keymap.Provider is missing` and no slash ever appears. Live keys: `active,commands,dispatch,layer,mode,pending,shortcuts`. Slash is `slash: { name, aliases? }` — flat `slashName` string is gone (host reads `command.slash.name` for palette). Colliding with host `/sessions` hides your command.
- **Dialog is `{ alert, clear, confirm, prompt, select, set, show }`.** `replace` is gone — guarding on it turns every command into a silent no-op. Use:
  - `dialog.show(render, onClose?)` — raw JSX dialog (body of `/usage`, live sessions, quest detail).
  - `dialog.select({ title, placeholder, options, current })` → `option.value | undefined` — free filtering/scroll/keyboard/mouse. Option: `{ value, title, category?, searchText?, details?, description?, footer?, disabled? }`, `category` = group header.
  - `dialog.confirm({ title, message, label })` → `true/false/undefined`.
  - `openTuiDialog(dialog, render, onError)` in `usage/tui-dialog.ts` — bounded wrapper that checks `dialog.show` exists.
- **Router + client:** `context.ui.router.navigate({ type: "home" } | { type: "session", sessionID } | { type: "plugin", id, name, data? })`. `context.client.session.create({ title?, agent?, model?, location })` + `session.prompt({ sessionID, text })`. `context.theme` + `context.renderer.height/width` are live; no mock.
  - **`context.ui.router.current()`** returns the live route in the same shape `navigate()` takes. **Hardcoding `navigate({type:"home"})` for a "back" action always opens a *new* chat** instead of returning to whatever was live (a subagent session, another plugin route) — this is how the Quest board's Esc/"back to chat" broke. Snapshot the route *before* navigating away (`opencode.diffs` does this, confirmed against the live beta-19086 binary): `const r = t.type==="home" ? {type:"home"} : t.type==="session" ? {type:"session",sessionID:t.sessionID} : {type:"plugin",id:t.id,name:t.name,...(t.data?{data:{...t.data}}:{})}`, pass it as `data.returnRoute` on the route you navigate *to*, and have that route's own back/close action do `navigate(route.data?.returnRoute ?? {type:"home"})`. `quest/tui-active/quests.tsx`'s `currentRoute()`/`openBoard()` + `quest-board.tsx`'s `back()` are the worked example.
- **Never `import { test } from "bun:test"` under `plugins-active/` or `tui-active/`** — loader evaluates siblings and throws *Cannot use test outside test runner*.

## Slot decision tree

```
What are you building?
├─ Slash/palette command (+ optional count/badging)
│  └─ mount on `app` (keymap.layer) + `prompt.footer` (count chip)
├─ Always-visible footer hint (context tokens, queue depth)
│  └─ `prompt.footer`
├─ In-session panel next to Subagents
│  └─ `sidebar.content` (receives { sessionID }) — split mine vs others
├─ Global overlay / dialog
│  └─ `dialog.show` / `dialog.select` / `dialog.confirm` — never custom absolute overlay
├─ Composer header decoration
│  └─ `session.composer.top` or `prompt.footer.file/status`
└─ Home-only landing footer
   └─ `home.footer` — rarely; prefer prompt.footer which works everywhere
```

Example skeleton (mirrors `usage/tui-active/usage.tsx` + `quest/tui-active/quests.tsx`):

```tsx
/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode-ai/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { createSignal, onMount, onCleanup, For, Show } from "solid-js"
import { openTuiDialog } from "../tui-dialog"

function ThemeColors(ctx: any) {
  const t = ctx?.theme?.current ?? ctx?.theme ?? {}
  return {
    text: t.text?.default ?? t.text ?? "#c0caf5",
    muted: t.text?.muted ?? t.textMuted ?? "#565f89",
    ok: t.success ?? "#9ece6a",
    warn: t.warning ?? "#e0af68",
    cap: t.error ?? "#f7768e",
    primary: t.primary ?? "#7aa2f7",
  }
}

function MyFooter() {
  const ctx: any = usePlugin()
  return <text fg={ThemeColors(ctx).muted} truncate wrapMode="none" onMouseUp={(e:any)=>{e?.stopPropagation?.(); ctx.ui.dialog.show(()=> <MyDialog ctx={ctx}/>)}}>● my-plugin</text>
}
function MyCommands(props:{ctx:any}) {
  props.ctx.keymap.layer(()=>({
    mode: "global",
    commands: [{ id:"my.show", title:"My panel", group:"System", palette:true, suggested:true, slash:{name:"my"}, run:()=> props.ctx.ui.dialog.show(()=> <MyDialog ctx={props.ctx}/>) }],
  }))
  return null
}
export default Plugin.define({
  id: "my-plugin",
  setup(ctx){
    ctx.ui.slot({ append:"app", render: ()=> <MyCommands ctx={ctx}/> })
    ctx.ui.slot({ append:"prompt.footer", render: ()=> <MyFooter/> })
    // optional: ctx.ui.slot({ append:"sidebar.content", render:(p:{sessionID:string})=> <MyPanel ctx={ctx} sessionID={p.sessionID}/> })
  }
})
```

## Making it look good — the beauty layer

### 1. Steal the proven patterns (don't invent)

Read these three files before writing new chrome — they already solved the hard parts:

- `usage/tui-active/usage.tsx` — table dialog with `COL`/`TABLE_WIDTH`/`DIALOG_INNER` budget, `ColText` cell, `contentHeight()` capping, skeleton fallback, `openDialog` via `openTuiDialog`, `activateOnMouseUp` consume-release, `themeColors`.
- `quest/tui-active/quests.tsx` + `quest/tui-active/quest-board.tsx` — count in `prompt.footer`, sidebar entry, full-screen plugin route, and one persistent user Quest Giver across projects. The full-width board composer opens the native giver prompt. Each `AGENT LOG` row shows live observation separately from saved state and a clickable recorded model; `w` opens the same native worker picker: `navigateQuestSession` (`quest/tui-navigation.ts`) resolves it to `router.navigate({type:"session", sessionID})` for native (bridge-backed) workers once a live `session.get` confirms the id, else falls back to `dialog.alert` with what's known (external harness session, or pruned). The host renders chat transcript text itself with no hook to linkify a bare `ses_…` a model prints in prose (confirmed against the beta-19086 binary — no href/internal-link scheme reaches transcript text), so the `/session` command (`quests.tsx`) is the click-equivalent for ids seen in chat: a searchable `dialog.select` picker over every Quest's sessions that jumps through the same path.
- `usage/tui-usage-format.ts` / `usage/tui-dialog.ts` — pure formatters (`formatWindowRow`, `fmtMoney`, `sourceState`, `sourceHint`) and dialog gate.

### 2. Layout — Yoga flexbox in terminal cells

Terminal = grid of cells, not pixels. Core docs: `@opentui` skill → `docs/core-concepts/layout.mdx` + `docs/components/box.mdx`.

Rules that matter for host plugins:

- **Budget first.** Pick `DIALOG_INNER` (e.g. 44) and `TABLE_WIDTH` (sum `COL.win + COL.bar + COL.pct + COL.reset + gaps`) and keep `TABLE_WIDTH ≤ DIALOG_INNER ≤ ~72`. Inspect the real terminal at the intended widths.toBeLessThanOrEqual(DIALOG_INNER)`). Use `pad(value, w, align)` from `tui-usage-format.ts` for fixed columns.
- **Row = no-wrap.** Every `<box flexDirection="row" flexWrap="no-wrap" gap={2}>` + each `<text truncate wrapMode="none" flexShrink={0} width={w}>`. Wrapping chrome bleeds into host composer. Use `scrollbox` when content must exceed viewport (`height={contentHeight(lines, ctx)}`, `scrollbarOptions={{ visible: lines > 12 }}`).
- **Cap height.** `contentHeight(lines, ctx)` = `min(maxHeightCap, min(max(lines, 3), floor(renderer.height) - 12))`. Without cap, dialog grows off-screen on small terminals.
- **Skeleton while loading.** `UsageSkeleton` (muted `░░░░` bars) + `<Show when={view()} fallback={<UsageSkeleton/>}>` — instant chrome, no pop.
- **Bar helper:** `Bar = "█".repeat(filled) + "░".repeat(10-filled)` with `filled = round(pct/10)` and edge guard `pct>0→≥1`, `pct<100→≤9` (see `tui-usage-format.ts:fmtBar`).
- **Common Yoga pitfalls:** numeric `width` defaults `flexShrink=0` (set `flexShrink={1}` if it must contract); `overflow:"scroll"` clips but doesn't add scroll state — use `<scrollbox>`; `gap` only on `<box>`; `visible={false}` removes from layout; absolute children don't grow parent auto size.

### 3. Colors — use the host theme, never hardcode

Host theme drifts per user. Hardcoded `#00ff00` looks cheap and clashes.

```ts
function themeColors(ctx:any){
  const c = ctx?.theme?.current ?? ctx?.theme ?? {}
  return {
    text: c.text?.default ?? c.text ?? "#c0caf5",
    muted: c.text?.muted ?? c.textMuted ?? "#565f89",
    ok: c.success ?? "#9ece6a",
    warn: c.warning ?? "#e0af68",
    cap: c.error ?? "#f7768e",
    primary: c.primary ?? "#7aa2f7",
  }
}
function toneFg(tone:"ok"|"warn"|"cap"|"none", colors:any){
  if(tone==="ok") return colors.ok
  if(tone==="warn") return colors.warn
  if(tone==="cap") return colors.cap
  return colors.muted
}
```

- Tone mapping: `pctTone(pct)` → `ok <70, warn 70-89, cap ≥90` (`tui-usage-format.ts:pctTone`). Use `sourceState()` + `sourceStateTone()` for provider health.
- Text colors: `fg={toneFg(row.pctTone, colors)}` + `attributes={TextAttributes.BOLD}` for cap only. Muted for labels (`WIN`, `RESET`, hints).
- Box borders: `borderStyle:"rounded"` for dialogs, `borderColor` from theme muted, not white bright.
- Parse safety: `parseColor()` logs warning and returns magenta on invalid — keep literal hexes lowercase 6-digit.

### 4. Typography — Solid text modifiers

Inside `<text>`, use inline modifiers, not props (see `@opentui` skill `docs/components/text.mdx`):

```tsx
<text fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
  Subscription usage
</text>
<text fg={colors.muted} wrapMode="none" truncate>{hint}</text>
<box flexDirection="row" gap={1}>
  <text fg={colors.ok}>▸ {label}</text>      // selectable action
  <text fg={colors.muted}>· {meta}</text>    // secondary
</box>
```

- `t` template literals (`t`${bold(fg(accent)(title))}``) for Core imperative; for Solid prefer `<span fg>`, `<strong>`, `<em>`, `<u>`, `<br/>`, `<a href>`.
- `wrapMode="none"` + `truncate` on every footer/count line. Without it, host wrapping pushes footer to next row.
- Never dump `block.doc` raw — use `sourceHint(id, doc)` which strips `edit me` placeholders and truncates to `HINT_WIDTH` (42). Test asserts `src` does not contain `{ block.doc }`.

### 5. Tables without TextTable (Solid has no JSX TextTable)

Solid has no `<text_table>` intrinsic — build tables manually like `UsageTable`:

```tsx
function ColText(p:{w:number; align:"left"|"right"; fg:unknown; bold?:boolean; value:string}){
  return <text fg={p.fg} attributes={p.bold?TextAttributes.BOLD:undefined} truncate wrapMode="none" width={p.w} minWidth={p.w} flexShrink={0}>{pad(p.value, p.w, p.align)}</text>
}
function Row(p:{row:UsageRowOut, colors:any}){
  return <box flexDirection="row" flexWrap="no-wrap" gap={2} flexShrink={0} minWidth={TABLE_WIDTH}>
    <ColText w={COL.win} align="left" fg={p.colors.text} value={p.row.window}/>
    <Show when={p.row.showBar}>
      <ColText w={COL.bar} align="left" fg={toneFg(p.row.pctTone,p.colors)} value={p.row.bar}/>
      <ColText w={COL.pct} align="right" fg={toneFg(p.row.pctTone,p.colors)} bold={p.row.pctTone!=="none"} value={p.row.pct}/>
    </Show>
    <Show when={!p.row.showBar}><ColText w={MONEY_WIDTH} align="left" fg={p.colors.text} value={p.row.metric}/></Show>
    <ColText w={COL.reset} align="right" fg={p.colors.muted} value={p.row.reset}/>
  </box>
}
```

- Header: `WIN BAR % RESET` with `gap={2}`, each header `ColText` using `colors.muted`.
- Money column: collapse `BAR+PCT+gaps` → `MONEY_WIDTH` (= `COL.bar + gap + COL.pct`).
- Assert: `formatRowLine(row).length ≤ 72` (see `tui-usage.test.ts`).

### 6. Interactions — clicks, dialogs, keys

- **Consume the release:** OpenTUI delivers mouse-up after tree changes. Opening on `onMouseDown` lets the same release hit the new dialog's dismiss layer and it vanishes. Always:
  ```ts
  function activateOnMouseUp(e:any, fn:()=>void){ try{e?.stopPropagation?.()}catch{}; fn() }
  <text onMouseUp={(e:any)=> activateOnMouseUp(e, ()=> ctx.ui.dialog.show(()=> <Dlg ctx={ctx}/>))}>open</text>
  ```
  Test asserts `function activateOnMouseUp` and `stopPropagation` and `not match /onMouseDown/`.

- **Dialog palette:** Prefer `dialog.select` for lists (Quests picker) — gives search, keyboard nav, scroll, mouse for free. Use custom JSX via `dialog.show` only for rich tables/detail pages. Guard missing API: `if(typeof dialog?.show!=="function") return`.

- **Back nav:** `Back to Quests` link inside detail → `clear()` then `openQuestDialog`. Delete → `confirm()` → `applyQuestAction` → `clear()` on delete.

- **Live refresh:** `readCachedView()` + `refreshView()` on mount + `watchQuests(root, refresh)` with `onCleanup(stop)` or `setInterval` + `onCleanup(clearInterval)`.

- **Navigation:** `navigateQuestSession(ctx, session)` → `router.navigate({type:"session", sessionID})`. No raw `client` writes.

### 7. Polish checklist (copy into PR description)

- [ ] `Plugin.define({ id: "<stem>", setup })` and file stem matches `id`.
- [ ] Chrome uses `ui.slot({ append:"app" })` for keymap + `prompt.footer` for footer + `sidebar.content` where needed; no underscored slots; no `slots.register`.
- [ ] `keymap.layer()` inside mounted component on `app`; slash = `slash:{name:"<name>"}`; `id:"<name>.show"`; palette true.
- [ ] Dialog via `dialog.show`/`select`/`confirm`; helper `openTuiDialog`; no `dialog.replace`.
- [ ] `activateOnMouseUp` + `onMouseUp` + `stopPropagation`; no `onMouseDown`.
- [ ] Theme via `themeColors(ctx)`; tone mapping via `pctTone`/`sourceStateTone`; muted for secondary; `TextAttributes.BOLD` only for cap.
- [ ] Layout budget: `TABLE_WIDTH ≤ DIALOG_INNER ≤ 72`; `flexWrap="no-wrap"`; `truncate` + `wrapMode="none"` + `flexShrink={0}` on every cell; `scrollbox` with `contentHeight` cap; skeleton fallback.
- [ ] No raw `block.doc` dump; `sourceHint` + `formatDoc` filtering; `pad()` for columns; `fmtBar`/`fmtMoney`/`fmtReset` for cells.
- [ ] Use the actual installed UI, capture its terminal output and reopen the saved result.

## Use the actual chrome

Follow docs/development-workflow.md. Load the candidate in the installed host,
use the affected controls, inspect the actual terminal capture, and reopen the
saved result. Do not add source-shape, unit or snapshot assertions. A temporary
PTY driver may operate and capture the real app; do not hand-draw expected frames.

## When to read what next

- Layout/recipes → `@opentui` skill: `docs/core-concepts/layout.mdx`, `docs/components/box.mdx`, `docs/components/text.mdx`, `docs/components/overview.mdx`.
- Slot deep-dive → `@opentui` skill: `docs/plugins/slots.mdx` + `docs/plugins/solid.mdx` + live log `~/.local/state/opencode/tui-usage.log`.
- Keymap scoping → `@opentui` skill: `docs/keymap/overview.mdx` + live keys `active,commands,dispatch,layer,mode,pending,shortcuts`.
- Visual checks: use this repository's headless capture or isolated standalone acceptance tools. Do not open or capture the user's live terminal or desktop.

## Quick upgrades for existing plugins

1. Extract inline styles into `themeColors(ctx)` + `toneFg`.
2. Replace `width:100%` prose tables with `COL` budget + `ColText` + `TABLE_WIDTH`.
3. Add `activateOnMouseUp` to every `onMouseUp` that opens a dialog.
4. Add `scrollbox` with `contentHeight` + `DIALOG_INNER` minWidth and `UsageSkeleton` fallback.
5. Switch list UIs from manual `<box>` lists to `dialog.select` with `category` + `searchText`.
6. Add `sidebar.content` panel if you only had `prompt.footer` count — users can't see quests from inside session without it (see `tui-slots.test.ts:quests mount the count on composer footer AND in sidebar`).

## Session roles

The bound user giver has the persistent title Quest Giver, yellow role chrome and
a /giver (Ctrl+Alt+G) entry from any session. Worker sessions have Worker titles
and cyan role chrome based on Quest receipts. Native worker agents are mode all
and visible so the host composer can restore their actual persisted identity;
hidden subagent-only agents caused the composer to fall back to the giver.
Worker permissions and exact agent/model/reasoning guards still apply.
