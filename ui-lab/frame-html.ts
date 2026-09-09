/**
 * Terminal frame → SVG / HTML.
 *
 * A captured frame is a grid of cells with foreground/background colours. Cells
 * a component never painted are transparent; in the host they show the host
 * theme, so every renderer here takes a `palette` (the host's default bg/fg)
 * and paints transparent cells with it. That is what makes a lab capture line
 * up with a host screenshot instead of with a colour scheme of its own.
 *
 *  - `frameToSvg`        pixel capture (PNG via resvg) at the host cell size.
 *  - `frameToHtml`       standalone page for the local gallery.
 *  - `frameToPaperRows`  Paper write_html rules: inline styles, flex rows, no
 *    margin, one text colour per element, `layer-name` in the layer tree. One
 *    flex row per terminal row, one text element per colour run.
 */
import { TextAttributes, type CapturedFrame } from "@opentui/core"

export type Palette = { bg: string; fg: string }

/** Cell metrics shared by the SVG and the Paper fragment so both line up with the host (~9.6×20 px). */
export const CELL_W = 9.6
export const CELL_H = 20
export const PAD = 16
export const FONT = `'Cascadia Mono', Consolas, 'DejaVu Sans Mono', Menlo, monospace`  // single quotes: this lands inside style="…" attributes
export const FONT_SIZE = 16

/** The quest board paints its own ground; this is what its transparent cells would show. */
export const QUEST_PALETTE: Palette = { bg: "#07111b", fg: "#d8d4ca" }
/** The host's default theme as seen in screenshots: near-black ground, light gray text. */
export const HOST_PALETTE: Palette = { bg: "#0f0f0f", fg: "#e2e2e2" }
/** The host dialog frame (what /usage sits in): a lifted gray panel. */
export const HOST_DIALOG_PALETTE: Palette = { bg: "#1c1c1c", fg: "#e2e2e2" }

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function color(value: { toInts(): [number, number, number, number] }, fallback: string): string {
  const [r, g, b, a] = value.toInts()
  if (a === 0) return fallback
  return `#${[r, g, b].map((part) => Math.max(0, Math.min(255, part)).toString(16).padStart(2, "0")).join("")}`
}

type Run = { text: string; fg: string; bg: string; bold: boolean; italic: boolean; underline: boolean; width: number }

/** Merge adjacent spans with identical styling so the output stays small and Paper gets sane text layers. */
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
  return out
}

/** Drop trailing blank cells on the default ground; they carry nothing. */
function trimmed(cells: Run[], palette: Palette): Run[] {
  const out = cells.slice()
  while (out.length && !/\S/.test(out.at(-1)!.text) && out.at(-1)!.bg === palette.bg) out.pop()
  const last = out.at(-1)
  if (last && last.bg === palette.bg) { const t = last.text.replace(/\s+$/, ""); last.width -= last.text.length - t.length; last.text = t }
  return out
}

export function frameToSvg(frame: CapturedFrame, title: string, palette: Palette): string {
  const width = Math.ceil(frame.cols * CELL_W + PAD * 2)
  const height = Math.ceil(frame.rows * CELL_H + PAD * 2)
  const body: string[] = [`<rect width="100%" height="100%" fill="${palette.bg}" rx="10"/>`]
  for (let row = 0; row < frame.rows; row++) {
    let column = 0
    for (const run of runs(frame, row, palette)) {
      const x = PAD + column * CELL_W, y = PAD + row * CELL_H, w = Math.max(0, run.width) * CELL_W
      if (w > 0 && run.bg !== palette.bg) body.push(`<rect x="${x}" y="${y}" width="${w}" height="${CELL_H}" fill="${run.bg}"/>`)
      if (/\S/.test(run.text)) {
        const attrs = `${run.bold ? ' font-weight="700"' : ""}${run.italic ? ' font-style="italic"' : ""}${run.underline ? ' text-decoration="underline"' : ""}`
        body.push(`<text x="${x}" y="${y + 15}" fill="${run.fg}"${attrs} xml:space="preserve">${esc(run.text)}</text>`)
      }
      column += run.width
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${esc(title)}</title><style>text{font-family:${FONT};font-size:${FONT_SIZE}px}</style>${body.join("")}</svg>`
}

function textStyle(run: Run, palette: Palette): string {
  const parts = [`color:${run.fg}`, "white-space:pre", `font-family:${FONT}`, `font-size:${FONT_SIZE}px`, `line-height:${CELL_H}px`]
  if (run.bg !== palette.bg) parts.push(`background-color:${run.bg}`)
  if (run.bold) parts.push("font-weight:700")
  if (run.italic) parts.push("font-style:italic")
  if (run.underline) parts.push("text-decoration:underline")
  return parts.join(";")
}

/** One <div> per terminal row, flex-row, holding one text element per colour run. Blank rows become fixed-height spacers. */
export function frameToPaperRows(frame: CapturedFrame, palette: Palette): string[] {
  const rows: string[] = []
  for (let row = 0; row < frame.rows; row++) {
    const cells = trimmed(runs(frame, row, palette), palette)
    const label = `row ${String(row + 1).padStart(2, "0")}`
    if (!cells.length) { rows.push(`<div layer-name="${label} (blank)" style="display:flex;height:${CELL_H}px;flex-shrink:0"></div>`); continue }
    const inner = cells.map((run) => `<div style="${textStyle(run, palette)}">${esc(run.text)}</div>`).join("")
    rows.push(`<div layer-name="${label}" style="display:flex;flex-direction:row;height:${CELL_H}px;flex-shrink:0">${inner}</div>`)
  }
  return rows
}

export function paperArtboardSize(frame: CapturedFrame): { width: number; height: number } {
  return { width: Math.ceil(frame.cols * CELL_W + PAD * 2), height: frame.rows * CELL_H + PAD * 2 }
}

/** Whole capture as one Paper-ready fragment (artboard-like root + rows). paper.ts reads width/height/background-color off the root. */
export function frameToPaperHtml(frame: CapturedFrame, name: string, palette: Palette): string {
  const { width, height } = paperArtboardSize(frame)
  return [
    `<div layer-name="${esc(name)}" style="display:flex;flex-direction:column;width:${width}px;height:${height}px;padding:${PAD}px;box-sizing:border-box;background-color:${palette.bg};border-radius:10px">`,
    ...frameToPaperRows(frame, palette).map((row) => `  ${row}`),
    `</div>`,
  ].join("\n")
}

/** Standalone page for the local gallery. */
export function frameToHtml(frame: CapturedFrame, title: string, palette: Palette, note?: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  body{margin:0;padding:24px;background:#0d1720;color:#d8d4ca;font-family:${FONT}}
  h1{font-size:14px;font-weight:600;margin:0 0 12px;color:#8f8a82}
  .note{font-size:12px;color:#596675;margin:0 0 16px;max-width:${Math.ceil(frame.cols * CELL_W)}px}
</style>
<h1>${esc(title)}</h1>
${note ? `<p class="note">${esc(note)}</p>` : ""}
${frameToPaperHtml(frame, title, palette)}
`
}

export type Frame = CapturedFrame
