import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const src = readFileSync(join(root, "quest", "tui-active", "quests.tsx"), "utf8")
const board = readFileSync(join(root, "quest", "tui-active", "quest-board.tsx"), "utf8")
const code = `${src}\n${board}`.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

test("quests uses beta-18684 slots and a mounted /quests command", () => {
  expect(code).toMatch(/Plugin\.define\s*\(\s*\{[\s\S]*?id:\s*["']quests["']/)
  expect(code).toMatch(/ui\.slot\(\{\s*append:\s*["']app["']/)
  expect(code).toMatch(/ui\.slot\(\{\s*append:\s*["']prompt\.footer["']/)
  expect(code).toMatch(/append:\s*["']sidebar\.content["']/)
  expect(code).toMatch(/keymap\.layer\s*\(/)
  expect(code).toMatch(/slash:\s*\{\s*name:\s*["']quests["']/)
  expect(code).not.toMatch(/slots\.register|keymap\.registerLayer|slashName/)
})

test("quests is a full-screen route opened on demand, not a session-shaped picker dialog", () => {
  expect(code).toMatch(/ui\.router\.register\(\{\s*name:\s*["']quests["']/)
  expect(code).toMatch(/router\.navigate\(\{\s*type:\s*["']plugin["'],\s*name:\s*["']quests["']/)
  expect(code).not.toMatch(/router\.navigate\(\{[^}]*id:\s*["']quests["']/)
  // It no longer opens itself at startup: the host composer is the primary surface.
  expect(code).not.toMatch(/primary-route/)
  // dialog.replace was never real (see SKILL.md host invariants); the board still
  // routes to itself via router.navigate, not by wrapping itself in a dialog.
  expect(code).not.toMatch(/dialog\.replace/)
})

test("a worker's session id on the board is clickable and jumps through navigateQuestSession, with a documented fallback when there's nothing to route to", () => {
  expect(code).toMatch(/navigateQuestSession/)
  expect(code).toMatch(/onMouseUp=\{\(event: any\) => activate\(event, \(\) => openWorkerSession\(/)
  // The graceful fallback: no live OpenCode route means a dialog with what we know, not a dead click.
  expect(code).toMatch(/dialog\?\.alert/)
})

test("/session is the click-equivalent for a ses_… id seen in chat, since the host has no hook to linkify transcript text", () => {
  expect(src).toMatch(/slash:\s*\{\s*name:\s*["']session["']/)
  expect(src).toMatch(/dialog\?\.select/)
})

test("the loaded TUI bootstrap registers as id quests so the host can resolve the route", () => {
  const bootstrap = readFileSync(join(root, "tui-bootstrap", "quests", "tui.tsx"), "utf8")
  expect(bootstrap).toMatch(/id:\s*["']quests["']/)
  expect(bootstrap).not.toMatch(/quests-generation-bootstrap/)
})

test("Quest click targets activate on release and consume the release", () => {
  expect(code).toMatch(/function activate\(/)
  expect(code).toMatch(/event\?\.stopPropagation\?\.\(\)/)
  expect(code).not.toMatch(/onMouseDown=/)
})


test("the Image 1 board is real-ledger driven with no screenshot-title fixtures", () => {
  for (const fake of ["Repair loader fallback", "PR #1842", "demoQuests", "screenshot-faithful", "quest.title.includes"]) expect(code).not.toContain(fake)
  expect(code).toMatch(/stageRows\(q\(\)\)/)
  expect(code).toMatch(/q\(\)\.setbacks/)
  expect(code).toMatch(/q\(\)\.usageInstructions/)
  expect(code).toMatch(/q\(\)\.sessions/)
  expect(code).not.toMatch(/ORCHESTRATOR|WORKER \$\{/)
  const capture = readFileSync(join(root, "scripts", "quest-board-demo-capture.tsx"), "utf8")
  expect(capture).toContain('import { QuestBoard } from "../quest/tui-active/quest-board"')
  expect(capture).not.toMatch(/function (?:Board|LeftRow|RightPane)\b/)
})

test("the detail pane follows the selected Quest reactively and never snapshots it", () => {
  // The old Detail did `const q = props.quest` once, so clicking another row
  // highlighted it while the right pane kept showing the first Quest.
  expect(code).toMatch(/function LegacyDetail\(props: \{ context: any; store: QuestStore; quest: \(\) => Quest; refresh: \(\) => void \}\)/)
  expect(code).toMatch(/<LegacyDetail context=\{props\.context\} store=\{store\} quest=\{q\} refresh=\{refresh\} \/>/)
  expect(code).toMatch(/const p = \(\) => questProgress\(props\.quest\)/)
  expect(code).toMatch(/progressGlyph\(p\(\)\)/)
  expect(code).not.toMatch(/scrollbarOptions=\{\{ visible: true \}\}/)
  expect(code).not.toMatch(/<box height=\{1\} backgroundColor=\{C\.line\}/)
  expect(code).not.toMatch(/model pending/)
  expect(code).not.toMatch(/reasoning pending/)
  expect(code).not.toMatch(/"unknown"/)
})

test("workerStatusLine renders '<emoji> <State> — <short title> — <model>[, <reasoning>][, fast]' for live states only, pre-fit to the footer width with word-boundary ellipsis, and liveWorkerLines flattens every quest's sessions newest-quest-first capped at two rows", () => {
  expect(code).toMatch(/export function workerStatusLine\(/)
  expect(code).toMatch(/export function liveWorkerLines\(/)
  expect(code).toMatch(/export function fitTitle\(/)
  expect(code).toMatch(/FOOTER_MAX_LINES/)
})

test("Footer teleports live worker lines from the ledger into the chat footer slot — one source, no giver-typed status — and each line is 1:1 clickable to its own Quest", () => {
  expect(src).toMatch(/liveWorkerLines\(all\(\), footerWidth\(props\.context\)\)/)
  // Each row is a click target to the one Quest it came from, same activate()/openBoard convention as the count line above it.
  expect(src).toMatch(/onMouseUp=\{\(event: any\) => activate\(event, \(\) => openBoard\(props\.context, row\.questID\)\)\}/)
  expect(src).toMatch(/<For each=\{lines\(\)\}>/)
})

test("back returns to the route that was live before the board opened, not always a new chat", () => {
  // Esc/"back to chat" used to hardcode router.navigate({type:"home"}), which
  // always opened a new chat instead of returning to a subagent session or
  // another plugin route. Every openBoard() entry point (footer, sidebar,
  // /quests) must snapshot the current route as data.returnRoute, and the
  // board's back() must read it back — mirroring the host's own
  // opencode.diffs plugin (confirmed against the live beta-19086 binary).
  expect(code).toMatch(/router\.current\s*\(\s*\)/)
  expect(code).toMatch(/returnRoute:\s*currentRoute\(context\)/)
  expect(code).toMatch(/returnRoute=\{route\.data\?\.returnRoute\}/)
  expect(code).toMatch(/props\.context\?\.ui\?\.router\?\.navigate\?\.\(props\.returnRoute\s*\?\?\s*\{\s*type:\s*"home"\s*\}\)/)
})

test("the host composer is the Quest Giver conversation; the board carries no chat and never opens itself", () => {
  const plugin = readFileSync(join(root, "quest", "tui-active", "quests.tsx"), "utf8")
  expect(existsSync(join(root, "quest", "giver-session.ts"))).toBe(false)
  expect(code).not.toMatch(/<textarea|talkToQuestGiver|session\.create|api\.prompt/)
  expect(plugin).not.toMatch(/primary-route|openBoard\(props\.context\)\s*\}\s*\}\)/)
  expect(plugin).toMatch(/slash:\s*\{\s*name:\s*"quests"/)
  expect(plugin).toMatch(/sidebar\.content/)
  expect(code).toMatch(/type:\s*"home"/)
})
