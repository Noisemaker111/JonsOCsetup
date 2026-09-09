/** @jsxImportSource @opentui/solid */
/**
 * UI lab renderer: every quest / usage surface, headless, from one fixture.
 *
 *   bun --preload @opentui/solid/preload ui-lab/render.tsx            # all surfaces
 *   bun --preload @opentui/solid/preload ui-lab/render.tsx sidebar footer
 *   bun --preload @opentui/solid/preload ui-lab/render.tsx board --width 160 --height 50
 *   bun --preload @opentui/solid/preload ui-lab/render.tsx --real         # your real ledger, accounts, telemetry
 *
 * Output goes to ui-lab/out/: <surface>.png / .svg / .txt / .html plus
 * paper/<surface>.html (fragments for Paper's write_html) and index.html, a
 * gallery you can open in a browser. Everything renders through the real
 * components (QuestBoard, Sidebar, Footer, UsageDialog, ContextFooter) on the
 * real OpenTUI test renderer; only the data is fixture. No host, no network,
 * no touch to the real ledger.
 *
 * Sizes mirror Jk's real terminal (about 200 columns × 50 rows at the host's
 * cell size) so a lab capture and a host screenshot line up 1:1. The slot
 * surfaces (sidebar, footer) are wrapped in a static mock of the host chrome
 * around them — composer box, the host's own footer items — traced from host
 * screenshots, so the plugin content is seen exactly where the host puts it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { Resvg } from "@resvg/resvg-js"
import { HOST_DIALOG_PALETTE, HOST_PALETTE, QUEST_PALETTE, frameToHtml, frameToPaperHtml, frameToSvg, type Frame, type Palette } from "./frame-html"
import { IDS, labProject, seedQuestLedger, seedUsageFixture } from "./fixture"
import { surfacesToPen, type PenSurface } from "./pen"

const ROOT = join(import.meta.dir, "..")
export const OUT = join(import.meta.dir, "out")

/** Jk's host terminal, measured from screenshots (1900×998 px at ~9.5×20 px cells). */
export const HOST_COLS = 200
export const HOST_ROWS = 50
/** The host sidebar column, measured from screenshots (~372 px wide). */
export const SIDEBAR_COLS = 40

/** Host theme as seen in screenshots: near-black ground, gray composer panel, yellow accent. */
const HOST = { bg: HOST_PALETTE.bg, panel: HOST_DIALOG_PALETTE.bg, text: HOST_PALETTE.fg, muted: "#8a8a8a", accent: "#f2cf45", orange: "#e9a23b" }
/** The host /usage dialog frame, measured from a screenshot: about 60 columns wide (563 px of content plus frame), 36 rows leaves room for every configured source. */
export const DIALOG_COLS = 60
export const DIALOG_ROWS = 36

type Ledger = "seeded" | "empty"

type Surface = {
  id: string
  title: string
  /** Which source file draws it; shown in the gallery so the tweak target is one click away. */
  source: string
  note: string
  width: number
  height: number
  /** Milliseconds to let async data (usage view, project lookup) settle before the capture. */
  settle?: number
  /** "empty" renders against a second, empty ledger instead of the seeded one. */
  ledger?: Ledger
  /** Route the surfaces read for "current session"; home means no session (the gauge says unavailable, like the host does). */
  route?: "session" | "home"
  /** What the host paints under cells the component leaves transparent. */
  palette: Palette
  /** Needs a specific fixture Quest or the empty ledger, so it is skipped in --real mode. */
  fixtureOnly?: boolean
  render: (context: any) => any
}

function labContext(dir: string, size: { width: number; height: number }, route: "session" | "home" = "session") {
  const navigated: unknown[] = []
  const current = route === "session" ? { type: "session", sessionID: "ses_lab_giver" } : { type: "home" }
  return {
    location: { directory: ROOT },
    renderer: size,
    client: { session: { context: async () => ({ data: [] }) } },
    ui: {
      router: { current: () => current, navigate: (r: unknown) => navigated.push(r), register: () => {} },
      dialog: { clear: () => {}, show: () => {}, alert: async () => {}, confirm: async () => false, select: async () => undefined },
      slot: () => {},
      toast: { show: () => {} },
    },
    keymap: { layer: () => {}, register: () => {} },
    // No `theme` on purpose: the live host hands the usage plugin none either (themeColors falls through to the
    // default foreground), which is why /usage is grayscale in the host. Adding one here would make the lab lie.
    navigated,
    questDir: dir,
  }
}

/**
 * Static stand-in for the host's composer + footer row, traced from a session
 * screenshot: yellow-barred composer with the agent/model line, then one row
 * with the cwd on the left and, right-aligned, the host's token/cost readout,
 * the ctrl+p hint, and the two plugin `prompt.footer` slots inline.
 */
function HostComposer(props: { width: number; footer: any }) {
  return <box flexDirection="column" width={props.width} backgroundColor={HOST.bg} paddingLeft={2} paddingRight={2} paddingTop={1}>
    <box flexDirection="row" backgroundColor={HOST.panel} flexShrink={0}>
      <box width={1} backgroundColor={HOST.accent} flexShrink={0} />
      <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexGrow={1}>
        <text fg={HOST.text} backgroundColor={HOST.panel}><span fg={HOST.text} bg={HOST.text}> </span></text>
        <text fg={HOST.muted} backgroundColor={HOST.panel}> </text>
        <text fg={HOST.muted} backgroundColor={HOST.panel} wrapMode="none" truncate><span fg={HOST.accent}>Quest-Giver</span> · <span fg={HOST.text} attributes={TextAttributes.BOLD}>Muse Spark 1.3 Free</span> <span fg={HOST.muted}>OpenCode Zen</span> · <span fg={HOST.orange}>medium</span></text>
      </box>
    </box>
    <box flexDirection="row" justifyContent="space-between" paddingTop={1} flexShrink={0}>
      <text fg={HOST.muted} flexShrink={0}>~</text>
      <box flexDirection="row" gap={2} flexShrink={1} minWidth={0} alignItems="flex-start">
        <text fg={HOST.muted} flexShrink={0}>22.0K (4%) · $0.08</text>
        <text fg={HOST.muted} flexShrink={0}><span fg={HOST.text} attributes={TextAttributes.BOLD}>ctrl+p</span> commands</text>
        {props.footer}
      </box>
    </box>
  </box>
}

/** The host sidebar column as a plain dark panel; only the plugin's `sidebar.content` slot is real. */
function HostSidebar(props: { children: any }) {
  return <box width={SIDEBAR_COLS} flexDirection="column" backgroundColor={HOST.bg} paddingLeft={1} paddingRight={1} paddingTop={1}>{props.children}</box>
}

async function surfaces(): Promise<Surface[]> {
  const { QuestBoard } = await import("../quest/tui-active/quest-board")
  const { Footer, Sidebar } = await import("../quest/tui-active/quests")
  const { UsageDialog, ContextFooter } = await import("../usage/tui-active/usage")
  const board = (id: string, title: string, source: string, note: string, quest?: string, ledger: Ledger = "seeded"): Surface => ({
    id, title, source, note, width: HOST_COLS, height: HOST_ROWS, settle: 300, ledger, palette: QUEST_PALETTE, fixtureOnly: id !== "board",
    render: (context) => <QuestBoard context={context} initialQuestID={quest} />,
  })
  const footerRow = (context: any) => <>
    <ContextFooter context={context} />
    <Footer context={context} />
  </>
  return [
    board("board", "Quest board · /quests · legacy Quest selected", "quest/tui-active/quest-board.tsx (QuestBoard, Row, LegacyDetail, StageList, AgentLog, ActionBar)",
      "Full-screen route at the host's terminal size. Left: lanes + rows. Right: LegacyDetail for a v1 Quest with steps, todos, agent log, artifacts and payout.", IDS.working),
    board("board-contract", "Quest board · v2 contract Quest selected", "quest/tui-active/quest-board.tsx (ContractDetail)",
      "Same board, right pane is ContractDetail: STEPS / AGENT LOG / CHANGES / ARTIFACTS / QUEST REWARD.", IDS.contract),
    board("board-attention", "Quest board · Needs attention Quest selected", "quest/tui-active/quest-board.tsx (LegacyDetail, status/badge)",
      "Blocked step + failed worker: the red path.", IDS.attention),
    board("board-empty", "Quest board · empty ledger", "quest/tui-active/quest-board.tsx (QuestBoard fallback)",
      "What /quests shows today with no Quests: the state in the host screenshot.", undefined, "empty"),
    {
      id: "sidebar", title: "Sidebar · sidebar.content slot", source: "quest/tui-active/quests.tsx (Sidebar, laneColor)",
      note: "The host sidebar column beside the chat, at its real width. Header line, + Start Quest, one row per active Quest.",
      width: SIDEBAR_COLS, height: 16, palette: HOST_PALETTE, render: (context) => <HostSidebar><Sidebar context={context} /></HostSidebar>,
    },
    {
      id: "sidebar-empty", title: "Sidebar · empty ledger", source: "quest/tui-active/quests.tsx (Sidebar fallback)",
      note: "Same slot with no Quests: the state in the host screenshot.",
      width: SIDEBAR_COLS, height: 8, ledger: "empty", palette: HOST_PALETTE, fixtureOnly: true, render: (context) => <HostSidebar><Sidebar context={context} /></HostSidebar>,
    },
    {
      id: "footer", title: "Bottom bar · prompt.footer slot", source: "quest/tui-active/quests.tsx (Footer) + usage/tui-active/usage.tsx (ContextFooter)",
      note: "The composer and the host footer row are a static mock traced from a host screenshot; the two plugin slots (↓ gauge, Quests counts + live worker lines) are the real components, inline where the host puts them.",
      width: HOST_COLS, height: 10, palette: HOST_PALETTE, render: (context) => <HostComposer width={HOST_COLS} footer={footerRow(context)} />,
    },
    {
      id: "footer-empty", title: "Bottom bar · empty ledger, no session", source: "quest/tui-active/quests.tsx (Footer) + usage/tui-active/usage.tsx (ContextFooter)",
      note: "Same row with no Quests and no active session: the state in the host screenshot (↓ unavailable, all counts 0).",
      width: HOST_COLS, height: 8, ledger: "empty", route: "home", palette: HOST_PALETTE, fixtureOnly: true, render: (context) => <HostComposer width={HOST_COLS} footer={footerRow(context)} />,
    },
    {
      id: "usage", title: "/usage dialog", source: "usage/tui-active/usage.tsx (UsageDialog, ConversationTelemetry, UsageTable) + usage/tui-usage-format.ts",
      note: "Dialog opened by /usage or by clicking the footer gauge, at the host dialog's real width and gray frame. Telemetry block on top, one block per subscription source below.",
      width: DIALOG_COLS, height: DIALOG_ROWS, settle: 1200, palette: HOST_DIALOG_PALETTE, render: (context) => <UsageDialog context={context} />,
    },
  ]
}

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }

async function capture(surface: Surface, context: any, width: number, height: number): Promise<{ frame: Frame; text: string }> {
  const setup = await testRender(() => surface.render(context), { width, height })
  try {
    await setup.renderOnce()
    await Bun.sleep(surface.settle ?? 60)
    await setup.renderOnce()
    await Bun.sleep(30)
    await setup.renderOnce()
    return { frame: setup.captureSpans(), text: setup.captureCharFrame().replace(/[ \t]+$/gm, "") }
  } finally {
    setup.renderer.destroy()
  }
}

function galleryHtml(cards: Array<Surface & { png: string; cols: number; rows: number }>): string {
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  return `<!doctype html>
<meta charset="utf-8">
<title>OpenCode2 quest UI lab</title>
<style>
  body{margin:0;padding:32px;background:#0d1720;color:#d8d4ca;font:14px/1.5 "Cascadia Mono",Consolas,monospace}
  h1{font-size:18px;margin:0 0 4px} .sub{color:#8f8a82;margin:0 0 28px}
  section{margin:0 0 40px} h2{font-size:15px;margin:0 0 4px;color:#f2cf45}
  .meta{color:#8f8a82;font-size:12px;margin:0 0 10px} .meta code{color:#20c7e8}
  img{display:block;max-width:100%;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5)}
  .links{font-size:12px;margin:8px 0 0} .links a{color:#20c7e8;margin-right:14px}
</style>
<h1>OpenCode2 quest UI lab</h1>
<p class="sub">Every surface of the quests + usage plugins, rendered headless from one fixture at the host's terminal size (${HOST_COLS}×${HOST_ROWS}). Edit the source file named under each card, re-run <code>bun run ui:lab</code>, refresh. Images are inlined, so this file can be sent or opened anywhere on its own.</p>
${cards.map((c) => `<section>
  <h2>${esc(c.title)}</h2>
  <p class="meta">${c.cols}×${c.rows} cells · source: <code>${esc(c.source)}</code><br>${esc(c.note)}</p>
  <img src="data:image/png;base64,${readFileSync(join(OUT, c.png)).toString("base64")}" alt="${esc(c.title)}" width="${Math.ceil(c.cols * 9.6 + 32)}">
  <p class="links"><a href="${c.id}.html">html</a><a href="${c.id}.svg">svg</a><a href="${c.id}.txt">text</a><a href="paper/${c.id}.html">paper fragment</a></p>
</section>`).join("\n")}
`
}

/**
 * `real: true` renders against Jk's actual data instead of the fixture: the
 * shared Quest ledger under the home directory (read-only here), the real
 * accounts and telemetry, and a copy of the real usage cache stamped fresh so
 * the dialog does not spawn the network collector. That is the capture to hold
 * next to a host screenshot.
 */
export async function renderLab(only: string[] = [], size?: { width?: number; height?: number }, real = false) {
  const scratch = mkdtempSync(join(tmpdir(), "opencode-ui-lab-"))
  const questDir = join(scratch, "ledger"), emptyDir = join(scratch, "empty"), usageDir = join(scratch, "usage")
  mkdirSync(questDir, { recursive: true })
  mkdirSync(join(emptyDir, ".opencode", "quests"), { recursive: true })
  if (real) {
    delete process.env.OPENCODE_QUEST_ROOT
    const realCache = join(ROOT, "usage", "usage-cache.json")
    if (existsSync(realCache)) {
      mkdirSync(usageDir, { recursive: true })
      const cache = JSON.parse(readFileSync(realCache, "utf8"))
      // Stamp the copy fresh (cache + per-source observedAt): the dialog marks anything older than 30s "unknown"
      // and would otherwise spawn the collector. The numbers are still the real last collection.
      cache.updated = new Date().toISOString()
      for (const source of cache.sources ?? []) if (source.observedAt) source.observedAt = cache.updated
      process.env.OPENCODE_USAGE_CACHE_FILE = join(usageDir, "cache.json")
      writeFileSync(process.env.OPENCODE_USAGE_CACHE_FILE, JSON.stringify(cache))
    }
  } else {
    const project = labProject(ROOT)
    seedQuestLedger(questDir, project)
    seedUsageFixture(usageDir)
  }
  mkdirSync(join(OUT, "paper"), { recursive: true })
  const all = (await surfaces()).filter((s) => !real || !s.fixtureOnly)
  const chosen = only.length ? all.filter((s) => only.includes(s.id)) : all
  // A full run owns out/paper: drop fragments from surfaces this mode does not render, so a push never mixes fixture and real.
  if (!only.length) for (const file of readdirSync(join(OUT, "paper"))) if (!all.some((s) => file === `${s.id}.html`)) rmSync(join(OUT, "paper", file), { force: true })
  const unknown = only.filter((id) => !all.some((s) => s.id === id))
  if (unknown.length) throw new Error(`Unknown surface(s): ${unknown.join(", ")}. Known: ${all.map((s) => s.id).join(", ")}`)
  const cards: Array<Surface & { png: string; cols: number; rows: number }> = []
  const penSurfaces: PenSurface[] = []
  try {
    for (const surface of chosen) {
      const width = size?.width ?? surface.width, height = size?.height ?? surface.height
      // projectRoot() reads OPENCODE_QUEST_ROOT at mount, so the ledger is chosen per surface here.
      if (!real) process.env.OPENCODE_QUEST_ROOT = surface.ledger === "empty" ? emptyDir : questDir
      // Slot surfaces tell the plugin the *host* terminal size even when the capture is narrower: Footer picks its layout from renderer.width.
      const context = labContext(process.env.OPENCODE_QUEST_ROOT ?? "", { width: Math.max(width, HOST_COLS), height: Math.max(height, HOST_ROWS) }, surface.route)
      const { frame, text } = await capture(surface, context, width, height)
      const svg = frameToSvg(frame, surface.title, surface.palette)
      writeFileSync(join(OUT, `${surface.id}.txt`), text)
      writeFileSync(join(OUT, `${surface.id}.svg`), svg)
      writeFileSync(join(OUT, `${surface.id}.png`), new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng())
      writeFileSync(join(OUT, `${surface.id}.html`), frameToHtml(frame, surface.title, surface.palette, `${surface.note} Source: ${surface.source}`))
      writeFileSync(join(OUT, "paper", `${surface.id}.html`), frameToPaperHtml(frame, surface.title, surface.palette))
      cards.push({ ...surface, png: `${surface.id}.png`, cols: frame.cols, rows: frame.rows })
      penSurfaces.push({ frame, name: surface.title, palette: surface.palette })
      console.log(`${surface.id.padEnd(16)} ${String(frame.cols).padStart(3)}×${String(frame.rows).padEnd(3)} → ui-lab/out/${surface.id}.png`)
    }
    // Keep the gallery complete even on a partial run: cards for surfaces not re-rendered this time keep their last PNG.
    const gallery = only.length ? all.map((s) => cards.find((c) => c.id === s.id) ?? { ...s, png: `${s.id}.png`, cols: s.width, rows: s.height }).filter((c) => existsSync(join(OUT, c.png))) : cards
    writeFileSync(join(OUT, "index.html"), galleryHtml(gallery))
    writeFileSync(join(OUT, "surfaces.json"), JSON.stringify(all.map(({ render, ...rest }) => rest), null, 2))
    // pen.dev document: one file per run (fixture or real), every rendered surface side by side. Open it in Cursor/VS Code with the pen.dev extension.
    mkdirSync(join(OUT, "pen"), { recursive: true })
    const penFile = join(OUT, "pen", real ? "quest-ui-real.pen" : "quest-ui.pen")
    writeFileSync(penFile, surfacesToPen(penSurfaces, `OpenCode2 quest UI · ${real ? "real data" : "fixture"} · ${new Date().toISOString().slice(0, 16)}`))
    console.log(`pen.dev  → ui-lab/out/pen/${real ? "quest-ui-real.pen" : "quest-ui.pen"} (${penSurfaces.length} surfaces)`)
    console.log(`gallery → ui-lab/out/index.html${real ? " (real data)" : " (fixture)"}`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const only = process.argv.slice(2).filter((arg, i, list) => !arg.startsWith("--") && list[i - 1] !== "--width" && list[i - 1] !== "--height")
  const width = option("--width") ? Number(option("--width")) : undefined
  const height = option("--height") ? Number(option("--height")) : undefined
  renderLab(only, { width, height }, process.argv.includes("--real")).catch((error) => { console.error(error); process.exit(1) })
}
