/** Demo: Before (ugly/broken) vs After (polished) using @opentui/core
 * Run: bun --preload @opentui/solid/preload scripts/tui-before-after-demo.ts
 * But this file uses only Core imperative so no preload needed: bun scripts/tui-before-after-demo.ts
 */
import { BoxRenderable, TextRenderable, RGBA, TextAttributes } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { COL, COL_GAP, TABLE_WIDTH, DIALOG_INNER, pad, fmtBar, fmtPct, fmtReset, sourceHint, formatDoc } from "../usage/tui-usage-format"

// --- Helpers that mirror the polished skill ---
function themeColors() {
  return {
    text: "#c0caf5",
    muted: "#565f89",
    ok: "#9ece6a",
    warn: "#e0af68",
    cap: "#f7768e",
    primary: "#7aa2f7",
  }
}
function toneFg(tone: "ok" | "warn" | "cap" | "none", c: ReturnType<typeof themeColors>) {
  if (tone === "ok") return c.ok
  if (tone === "warn") return c.warn
  if (tone === "cap") return c.cap
  return c.muted
}
function pctTone(pct: number | null): "ok" | "warn" | "cap" | "none" {
  if (pct == null) return "none"
  if (pct >= 90) return "cap"
  if (pct >= 70) return "warn"
  return "ok"
}

// ---- BEFORE: what people did when UI looked bad ----
async function renderBefore() {
  const setup = await createTestRenderer({ width: 56, height: 18 })
  const r = setup.renderer
  // Prose container, no budget, hardcoded bright colors, wrapping, n/a placeholder, raw doc dump, onMouseDown
  const root = new BoxRenderable(r, {
    id: "before-root",
    width: 56,
    height: 18,
    flexDirection: "column",
    padding: 1,
    border: true,
    borderStyle: "single",
    borderColor: "#FFFFFF",
    title: "BEFORE — broken",
    titleColor: "#FF0000",
  })

  // Hardcoded bright white title, no theme
  root.add(new TextRenderable(r, { content: "Subscription usage — refreshing...", fg: "#FFFFFF", attributes: TextAttributes.BOLD }))

  // Hardcoded bright red for cap, no tone mapping, prose row with spaces that wrap
  root.add(new TextRenderable(r, { content: "OPENCODE GO · usage reached", fg: "#FF0000", attributes: TextAttributes.BOLD }))
  root.add(new TextRenderable(r, { content: " 5h  ██████░░░░ 61% 12m  | 7d  ██████████ 100% 3d 18h", fg: "#FFFFFF" }))

  // n/a placeholder, wrapping label, STATUS column that host never had
  root.add(new TextRenderable(r, { content: "WIN  BAR         %    STATUS  RESET", fg: "#888888" }))
  root.add(new TextRenderable(r, { content: "5h   ██████░░░░ 61%  cap     12m", fg: "#FFFF00" }))
  root.add(new TextRenderable(r, { content: "7d   ██████████ 100% cap     3d 18h", fg: "#FF0000" }))
  root.add(new TextRenderable(r, { content: "grok n/a         n/a  none    n/a", fg: "#AAAAAA" }))

  // Raw doc dump — wraps, no filtering of placeholder, no HINT_WIDTH truncation
  root.add(
    new TextRenderable(r, {
      content: "Go: server rolling 5h AND weekly AND monthly caps apply with detailed paragraph that wraps across the dialog and looks messy",
      fg: "#AAAAAA",
    }),
  )
  // Another raw placeholder that should have been omitted
  root.add(new TextRenderable(r, { content: "edit me - SuperGrok limits (placeholder leaked)", fg: "#AAAAAA" }))

  // onMouseDown bug — not visible in static frame but noted
  const btn = new BoxRenderable(r, { width: 20, height: 1, flexDirection: "row", border: false })
  btn.add(new TextRenderable(r, { content: "▸ click (onMouseDown)", fg: "#00FF00" }))
  root.add(btn)

  r.root.add(root)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  const spans = setup.captureSpans()
  setup.renderer.destroy()
  return { frame, spans }
}

// ---- AFTER: polished per opencode-tui skill ----
async function renderAfter() {
  const c = themeColors()
  const setup = await createTestRenderer({ width: 56, height: 18 })
  const r = setup.renderer

  const root = new BoxRenderable(r, {
    id: "after-root",
    width: DIALOG_INNER + 2 + 2, // border + padding = ~48, fits 56
    height: 18,
    flexDirection: "column",
    padding: 1,
    border: true,
    borderStyle: "rounded",
    borderColor: c.muted,
    title: "AFTER — polished",
    titleColor: c.primary,
    backgroundColor: "transparent",
  })

  // Title + subtitle with theme + age
  const header = new BoxRenderable(r, { flexDirection: "row", justifyContent: "space-between", width: "100%", flexShrink: 0 })
  header.add(new TextRenderable(r, { content: "Subscription usage", fg: c.text, attributes: TextAttributes.BOLD }))
  header.add(new TextRenderable(r, { content: "2s ago", fg: c.muted }))
  root.add(header)

  // Provider block — uses COL budget + tone
  const providerHeader = new BoxRenderable(r, { flexDirection: "row", gap: 1, flexShrink: 0, flexWrap: "no-wrap" as any })
  providerHeader.add(new TextRenderable(r, { content: "OPENCODE GO", fg: c.text, attributes: TextAttributes.BOLD }))
  providerHeader.add(new TextRenderable(r, { content: "· connected", fg: toneFg("ok", c) }))
  root.add(providerHeader)

  // Table header — compact, no STATUS, correct order % before RESET
  const hdr = new BoxRenderable(r, { flexDirection: "row", gap: COL_GAP, flexWrap: "no-wrap" as any, flexShrink: 0, width: TABLE_WIDTH })
  const hdrCells = [
    { w: COL.win, v: "WIN", fg: c.muted },
    { w: COL.bar, v: "BAR", fg: c.muted },
    { w: COL.pct, v: "%", fg: c.muted },
    { w: COL.reset, v: "RESET", fg: c.muted },
  ]
  for (const cell of hdrCells) {
    const t = new TextRenderable(r, {
      content: pad(cell.v, cell.w, cell.v === "%" || cell.v === "RESET" ? "right" : "left"),
      fg: cell.fg as any,
      width: cell.w,
    } as any)
    // force no-wrap via box; text itself is single line
    const wrapper = new BoxRenderable(r, { width: cell.w, flexShrink: 0 })
    wrapper.add(t)
    hdr.add(wrapper)
  }
  root.add(hdr)

  // Rows — fmtBar/pctTone, aligned, no-wrap
  const rows: Array<{ label: string; pct: number; reset: number; status: string }> = [
    { label: "5h", pct: 61, reset: 720, status: "ok" },
    { label: "7d", pct: 100, reset: 3 * 86400 + 18 * 3600, status: "rate-limited" },
  ]
  for (const row of rows) {
    const bar = fmtBar(row.pct)
    const pct = fmtPct(row.pct)
    const tone = pctTone(row.pct) === "cap" ? "cap" : pctTone(row.pct)
    const reset = fmtReset(row.reset)
    const line = new BoxRenderable(r, { flexDirection: "row", gap: COL_GAP, flexWrap: "no-wrap" as any, flexShrink: 0, width: TABLE_WIDTH })
    const cells: Array<{ w: number; v: string; fg: string; bold?: boolean; align: "left" | "right" }> = [
      { w: COL.win, v: pad(row.label, COL.win, "left"), fg: c.text, align: "left" },
      { w: COL.bar, v: pad(bar, COL.bar, "left"), fg: toneFg(tone, c), align: "left" },
      { w: COL.pct, v: pad(pct, COL.pct, "right"), fg: toneFg(tone, c), bold: tone !== "none", align: "right" },
      { w: COL.reset, v: pad(reset, COL.reset, "right"), fg: c.muted, align: "right" },
    ]
    for (const cell of cells) {
      const box = new BoxRenderable(r, { width: cell.w, flexShrink: 0 })
      box.add(new TextRenderable(r, { content: cell.v, fg: cell.fg as any, attributes: cell.bold ? TextAttributes.BOLD : 0 } as any))
      line.add(box)
    }
    root.add(line)
  }

  // Hint — filtered through sourceHint (truncated to HINT_WIDTH, no raw dump)
  const hint = sourceHint("opencode-go", "Go: server rolling 5h AND weekly AND monthly") ?? ""
  if (hint) {
    const hintBox = new BoxRenderable(r, { width: DIALOG_INNER, flexShrink: 0 })
    hintBox.add(new TextRenderable(r, { content: hint, fg: c.muted as any }))
    root.add(hintBox)
  }
  // placeholder correctly omitted — formatDoc returns undefined for "edit me..."
  const omitted = sourceHint("my-provider", "edit me - SuperGrok limits")
  if (omitted) {
    root.add(new TextRenderable(r, { content: omitted, fg: c.muted as any }))
  } else {
    // show that omission is intentional — no row added. For demo, add a muted note inside border:
    // (in real dialog this row simply wouldn't exist)
  }

  // Action with correct onMouseUp pattern (static frame shows ▸ with ok color)
  const action = new BoxRenderable(r, { flexDirection: "row", flexShrink: 0 })
  action.add(new TextRenderable(r, { content: "▸ Open details", fg: c.primary as any }))
  root.add(action)

  r.root.add(root)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  const spans = setup.captureSpans()
  setup.renderer.destroy()
  return { frame, spans }
}

async function main() {
  const before = await renderBefore()
  const after = await renderAfter()

  console.log("=".repeat(60))
  console.log("BEFORE — hardcoded colors, wrapping prose, n/a, raw doc dump")
  console.log("=".repeat(60))
  console.log(before.frame)
  console.log("\n" + "=".repeat(60))
  console.log("AFTER — theme, COL budget, tone, no-wrap, filtered hint")
  console.log("=".repeat(60))
  console.log(after.frame)

  // Also write to files for diff viewing
  const outDir = join(process.cwd(), "tmp")
  try { mkdirSync(outDir, { recursive: true }) } catch {}
  writeFileSync(join(outDir, "tui-before.txt"), before.frame, "utf8")
  writeFileSync(join(outDir, "tui-after.txt"), after.frame, "utf8")
  writeFileSync(join(outDir, "tui-before.json"), JSON.stringify(before.spans, null, 2), "utf8")
  writeFileSync(join(outDir, "tui-after.json"), JSON.stringify(after.spans, null, 2), "utf8")
  console.log("\nWrote tmp/tui-before.txt, tmp/tui-after.txt, tmp/tui-before.json, tmp/tui-after.json")

  // Also show the underlying formatter budgets
  console.log("\n" + "-".repeat(60))
  console.log(`BUDGET: COL=${JSON.stringify(COL)} TABLE_WIDTH=${TABLE_WIDTH} DIALOG_INNER=${DIALOG_INNER} (must be ≤72, TABLE≤DIALOG)`)
  console.log(`Hint check: sourceHint("opencode-go", long) = "${sourceHint("opencode-go", "Go: server rolling 5h AND weekly AND monthly caps apply with detailed paragraph that wraps across the dialog and looks messy")}"`)
  console.log(`Omitted placeholder: sourceHint("my-provider", "edit me - ...") = ${JSON.stringify(sourceHint("my-provider", "edit me - SuperGrok limits"))} (undefined = correctly hidden)`)
  console.log(`Curated hint still shows: sourceHint("grok-sub", "edit me - ...") = ${JSON.stringify(sourceHint("grok-sub", "edit me - SuperGrok limits"))} (curated, not raw)`)
  console.log(`Bar 61% = "${fmtBar(61)}"  fmtPct(61)="${fmtPct(61)}"  fmtReset(720)="${fmtReset(720)}"`)
  console.log("-".repeat(60))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
