/**
 * Terminal frames → a pen.dev `.pen` document.
 *
 * pen.dev (formerly Pencil) stores designs as plain JSON, so the lab writes
 * the file directly: no MCP calls, no quota, deterministic output that can be
 * committed. Open the file in Cursor/VS Code with the pen.dev extension (or
 * the desktop app) and every terminal row is a frame of text layers you can
 * move, recolour and retype; the pen.dev MCP then lets Claude read the same
 * canvas back.
 *
 * Mapping (schema 2.14, see references/pen-schema.md in the pencil-skill repo):
 *   surface  → frame, layout vertical, fixed size, fill = host ground
 *   row      → frame, layout horizontal, height = cell height (blank rows too, so rows stay aligned)
 *   run      → text node, `content`, monospace font, one fill colour; a run on a
 *              non-default background gets wrapped in a frame with that fill.
 * Surfaces are laid out left to right on a `layout: "none"` page with x/y.
 */
import { TextAttributes, type CapturedFrame } from "@opentui/core"
import { CELL_H, CELL_W, FONT_SIZE, PAD, type Palette } from "./frame-html"

export const PEN_FONT = "Cascadia Mono"
const GUTTER = 120

type PenNode = Record<string, unknown>

function color(value: { toInts(): [number, number, number, number] }, fallback: string): string {
  const [r, g, b, a] = value.toInts()
  if (a === 0) return fallback
  return `#${[r, g, b].map((part) => Math.max(0, Math.min(255, part)).toString(16).padStart(2, "0")).join("")}`.toUpperCase()
}

type Run = { text: string; fg: string; bg: string; bold: boolean; italic: boolean; underline: boolean; width: number }

function runs(frame: CapturedFrame, row: number, palette: Palette): Run[] {
  const out: Run[] = []
  for (const span of frame.lines[row]?.spans ?? []) {
    if (!span.text) continue
    const run: Run = {
      text: span.text, fg: color(span.fg, palette.fg), bg: color(span.bg, palette.bg), width: span.width,
      bold: (span.attributes & TextAttributes.BOLD) !== 0,
      italic: (span.attributes & TextAttributes.ITALIC) !== 0,
      underline: (span.attributes & TextAttributes.UNDERLINE) !== 0,
    }
    const last = out.at(-1)
    if (last && last.fg === run.fg && last.bg === run.bg && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline) { last.text += run.text; last.width += run.width }
    else out.push(run)
  }
  while (out.length && !/\S/.test(out.at(-1)!.text) && out.at(-1)!.bg.toUpperCase() === palette.bg.toUpperCase()) out.pop()
  return out
}

let counter = 0
const id = (prefix: string) => `${prefix}-${(counter++).toString(36)}`

/**
 * Every run gets the exact cell box it occupied (width = cells × CELL_W, height = one row) instead of
 * letting the font decide, so the grid survives whatever font metrics pen.dev's renderer applies.
 */
function textNode(run: Run, name: string): PenNode {
  return {
    type: "text", id: id("t"), name,
    content: run.text,
    fontFamily: PEN_FONT, fontSize: FONT_SIZE, fontWeight: run.bold ? "700" : "400", lineHeight: CELL_H / FONT_SIZE,
    width: Math.round(run.width * CELL_W), height: CELL_H, textGrowth: "fixed-width-height", textAlignVertical: "center", fill: run.fg,
    ...(run.italic ? { fontStyle: "italic" } : {}),
    ...(run.underline ? { textDecoration: "underline" } : {}),
  }
}

export function surfaceToPenFrame(frame: CapturedFrame, name: string, palette: Palette, x: number, y: number): PenNode {
  const width = Math.ceil(frame.cols * CELL_W + PAD * 2), height = frame.rows * CELL_H + PAD * 2
  const rows: PenNode[] = []
  for (let row = 0; row < frame.rows; row++) {
    const cells = runs(frame, row, palette)
    const label = `row ${String(row + 1).padStart(2, "0")}`
    const children = cells.map((run, i) => {
      // Whitespace on the default ground is spacing, not text: a fixed-width empty frame keeps the columns honest.
      if (!/\S/.test(run.text) && run.bg.toUpperCase() === palette.bg.toUpperCase()) return { type: "frame", id: id("g"), name: `${label} · ${i + 1} gap`, width: Math.round(run.width * CELL_W), height: CELL_H }
      const text = textNode(run, `${label} · ${i + 1}`)
      // A painted background (selected row, button, cursor) becomes a frame with that fill around the text.
      return run.bg.toUpperCase() === palette.bg.toUpperCase()
        ? text
        : { type: "frame", id: id("b"), name: `${label} · ${i + 1} bg`, layout: "horizontal", height: CELL_H, width: Math.round(run.width * CELL_W), fill: run.bg, alignItems: "center", children: [text] }
    })
    rows.push({ type: "frame", id: id("r"), name: cells.length ? label : `${label} (blank)`, layout: "horizontal", alignItems: "center", gap: 0, width: "fill_container", height: CELL_H, children })
  }
  return {
    type: "frame", id: id("s"), name,
    x, y, width, height, layout: "vertical", gap: 0, padding: PAD, clip: true, cornerRadius: 10, fill: palette.bg,
    children: rows,
  }
}

export type PenSurface = { frame: CapturedFrame; name: string; palette: Palette }

/** One page, surfaces side by side, largest first row. */
export function surfacesToPen(surfaces: PenSurface[], title: string): string {
  counter = 0
  let x = 0
  const children = surfaces.map((s) => {
    const node = surfaceToPenFrame(s.frame, s.name, s.palette, x, 0)
    x += (node.width as number) + GUTTER
    return node
  })
  const doc = {
    // The installed extension (0.6.70) ships its own documents as 2.6; newer editors migrate older files, older ones reject newer versions.
    version: "2.6",
    variables: {
      questBg: { type: "color", value: "#07111B" }, hostBg: { type: "color", value: "#0F0F0F" }, dialogBg: { type: "color", value: "#1C1C1C" },
    },
    children: [
      { type: "note", id: id("n"), name: "About", x: 0, y: -80, content: `${title}. Generated by ui-lab from the real quest/usage components; one frame per terminal row, one text layer per colour run. Re-run bun run ui:lab to regenerate.`, fontSize: 14, fill: "#8A8A8A" },
      ...children,
    ],
  }
  return JSON.stringify(doc, null, 2)
}
