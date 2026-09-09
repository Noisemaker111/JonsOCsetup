/** @jsxImportSource @opentui/solid */
// Run with: bun --preload @opentui/solid/preload scripts/quest-board-demo-capture.tsx
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { Resvg } from "@resvg/resvg-js"
import { frameToSvg } from "./opencode-visual-e2e"
import { QuestBoard } from "../quest/tui-active/quest-board"

async function main() {
  const root = join(import.meta.dir, "..")
  const context = {
    location: { directory: root },
    client: { session: {} },
    ui: { router: {}, dialog: {} },
  }
  const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
  const label = option("--label") ?? "quest-board"
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid capture label")
  const width = Number(option("--width") ?? 132), height = Number(option("--height") ?? 72)
  if (!Number.isInteger(width) || width < 40 || width > 240 || !Number.isInteger(height) || height < 20 || height > 200) throw new Error("Capture dimensions must be 40–240 columns and 20–200 rows")
  const setup = await testRender(() => <QuestBoard context={{...context,renderer:{width,height}}} initialQuestID={option("--quest")} />, { width, height })
  try {
    await setup.renderOnce()
    await Bun.sleep(50)
    await setup.renderOnce()
    const scroll = Math.max(0, Math.min(200, Number(option("--scroll") ?? 0)))
    for (let i = 0; i < scroll; i++) { await setup.mockMouse.scroll(Math.max(1, width - 10), Math.min(height - 2, 30), "down"); await setup.renderOnce() }
    const frame = setup.captureCharFrame().replace(/[ \t]+$/gm, "")
    const spans = setup.captureSpans()
    if (!option("--label")) {
      mkdirSync(join(root, "tmp"), { recursive: true })
      writeFileSync(join(root, "tmp", "quest-board.txt"), frame, "utf8")
      writeFileSync(join(root, "tmp", "quest-board-spans.json"), JSON.stringify(spans, null, 2), "utf8")
    }
    const out = join(root, ".visual-e2e", "quest-redesign")
    mkdirSync(out, { recursive: true })
    const svg = frameToSvg(spans, `Quest board: ${label}`)
    writeFileSync(join(out, `${label}.svg`), svg)
    writeFileSync(join(out, `${label}.png`), new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng())
    writeFileSync(join(out, `${label}.txt`), frame)
    console.log(JSON.stringify({capture: join(out, `${label}.png`), source: "Actual QuestBoard component and canonical ledger, headless OpenTUI renderer", width: spans.cols, height: spans.rows}))
  } finally {
    setup.renderer.destroy()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
