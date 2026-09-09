/**
 * Push the UI lab captures into Paper (paper.design) as artboards.
 *
 *   bun ui-lab/paper.ts                 # every surface in ui-lab/out/paper
 *   bun ui-lab/paper.ts sidebar footer  # just these
 *   bun ui-lab/paper.ts --list-tools    # print what the running Paper exposes
 *   bun ui-lab/paper.ts --file <id>     # target a specific Paper file
 *   bun ui-lab/paper.ts --delete 1-0,1-1  # remove artboards by node id (e.g. a superseded push)
 *   bun ui-lab/paper.ts --replace         # delete earlier artboards of the same surfaces before pushing
 *   bun ui-lab/paper.ts --info            # file, page and artboard list with node ids
 *   bun ui-lab/paper.ts --inspect 1-3     # tree summary + fresh screenshot of one node
 *
 * Requires the Paper desktop app running; it serves an MCP endpoint at
 * http://127.0.0.1:29979/mcp (Streamable HTTP). This speaks JSON-RPC to it
 * directly, so no MCP client config is needed. If no file is open, a file
 * named "OpenCode2 quest UI lab" is created and opened.
 *
 * Each surface becomes one artboard: the terminal background as the artboard
 * fill, one flex row per terminal row, one text layer per colour run. Rows
 * are written in small batches so the canvas fills in visibly. After each
 * artboard a Paper screenshot is saved to ui-lab/out/paper-check/<id>.png so
 * the push can be verified without switching windows.
 *
 * Re-running adds new artboards (name suffixed with the run time) beside the
 * old ones so before/after stays side by side; delete what you no longer want.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PAD } from "./frame-html"

const ENDPOINT = process.env.PAPER_MCP_URL ?? "http://127.0.0.1:29979/mcp"
const OUT = join(import.meta.dir, "out")
const PAPER_DIR = join(OUT, "paper")
const CHECK_DIR = join(OUT, "paper-check")
const ROWS_PER_WRITE = 12

type Json = Record<string, unknown>
let nextID = 1
let sessionID: string | undefined
let fileID: string | undefined

async function rpc(method: string, params: Json = {}, notification = false): Promise<any> {
  const body: Json = { jsonrpc: "2.0", method, params }
  if (!notification) body.id = nextID++
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sessionID ? { "mcp-session-id": sessionID } : {}) },
    body: JSON.stringify(body),
  })
  const sid = response.headers.get("mcp-session-id")
  if (sid) sessionID = sid
  if (notification) return undefined
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status} ${await response.text()}`)
  const type = response.headers.get("content-type") ?? ""
  const text = await response.text()
  const message = type.includes("text/event-stream")
    ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5).trim())).find((m) => m.id === body.id)
    : JSON.parse(text)
  if (!message) throw new Error(`${method}: no response in stream`)
  if (message.error) throw new Error(`${method}: ${message.error.message ?? JSON.stringify(message.error)}`)
  return message.result
}

async function connect() {
  try {
    await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "opencode-ui-lab", version: "1" } })
    await rpc("notifications/initialized", {}, true)
  } catch (error) {
    throw new Error(`Paper is not reachable at ${ENDPOINT}. Open the Paper desktop app, then retry. (${error instanceof Error ? error.message : error})`)
  }
}

function textOf(result: any): string {
  return (result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
}

async function call(name: string, args: Json): Promise<any> {
  const result = await rpc("tools/call", { name, arguments: { ...(fileID ? { fileId: fileID } : {}), ...args } })
  if (result?.isError) throw new Error(`${name}: ${textOf(result) || JSON.stringify(result.content)}`)
  return result
}

/** Tool results are text; the payload is JSON when we are lucky, prose otherwise. */
function parsed(result: any): any {
  const text = textOf(result)
  try { return JSON.parse(text) } catch { return undefined }
}

function idFrom(result: any, ...keys: string[]): string | undefined {
  const data = parsed(result)
  for (const key of keys) { const value = data?.[key]; if (typeof value === "string" && value) return value }
  const text = textOf(result)
  for (const key of keys) { const hit = text.match(new RegExp(`"?${key}"?\\s*[:=]\\s*"?([A-Za-z0-9_:-]+)"?`)); if (hit) return hit[1] }
  return text.match(/\b([A-Za-z0-9]+-[A-Za-z0-9-]+|[A-Za-z0-9_]{8,})\b/)?.[1]
}

/** Make sure a Paper file is open; create the lab file if nothing is. */
async function ensureFile(explicit?: string) {
  if (explicit) { await call("open_file", { fileId: explicit }); fileID = explicit; return }
  try {
    const info = await call("get_basic_info", {})
    const data = parsed(info)
    if (data?.fileId ?? data?.file?.id) fileID = data.fileId ?? data.file.id
    console.log(`Paper file: ${data?.fileName ?? data?.file?.name ?? textOf(info).split("\n")[0]}`)
    return
  } catch (error) {
    console.log(`No open Paper file (${error instanceof Error ? error.message : error}); creating one.`)
  }
  const created = await call("create_file", { name: "OpenCode2 quest UI lab" })
  const id = idFrom(created, "fileId", "id")
  if (!id) throw new Error(`create_file returned no id: ${textOf(created)}`)
  await call("open_file", { fileId: id })
  fileID = id
  console.log(`Paper file: OpenCode2 quest UI lab (${id})`)
}

function saveScreenshot(result: any, file: string): boolean {
  const image = (result?.content ?? []).find((c: any) => c.type === "image" && typeof c.data === "string")
  if (!image) return false
  mkdirSync(CHECK_DIR, { recursive: true })
  writeFileSync(file, Buffer.from(image.data, "base64"))
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  await connect()
  if (args.includes("--list-tools")) {
    const tools = await rpc("tools/list")
    for (const tool of tools.tools ?? []) console.log(`${tool.name}\n  ${tool.description ?? ""}\n  ${JSON.stringify(tool.inputSchema?.properties ?? {})}`)
    return
  }
  if (args.includes("--info")) {
    await ensureFile(option("--file"))
    console.log(textOf(await call("get_basic_info", {})))
    return
  }
  if (option("--inspect")) {
    await ensureFile(option("--file"))
    const nodeId = option("--inspect")!
    console.log(textOf(await call("get_tree_summary", { nodeId, depth: 2 })))
    const shot = await call("get_screenshot", { nodeId, scale: 1 })
    const file = join(CHECK_DIR, `inspect-${nodeId}.png`)
    console.log(saveScreenshot(shot, file) ? `screenshot → ${file}` : `no image returned: ${textOf(shot)}`)
    return
  }
  if (option("--delete")) {
    await ensureFile(option("--file"))
    const nodeIds = option("--delete")!.split(",").map((s) => s.trim()).filter(Boolean)
    await call("delete_nodes", { nodeIds })
    console.log(`Deleted ${nodeIds.join(", ")}`)
    return
  }
  if (!existsSync(PAPER_DIR)) throw new Error("No captures yet: run `bun run ui:lab` first.")
  const surfaces = JSON.parse(readFileSync(join(OUT, "surfaces.json"), "utf8")) as Array<{ id: string; title: string }>
  const wanted = args.filter((a, i) => !a.startsWith("--") && !["--file", "--delete", "--inspect"].includes(args[i - 1]))
  const files = readdirSync(PAPER_DIR).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)).filter((id) => !wanted.length || wanted.includes(id))
  if (!files.length) throw new Error(`Nothing to push. Known surfaces: ${surfaces.map((s) => s.id).join(", ")}`)
  await ensureFile(option("--file"))
  if (args.includes("--replace")) {
    const info = parsed(await call("get_basic_info", {}))
    const titles = files.map((id) => surfaces.find((s) => s.id === id)?.title ?? id)
    const stale = (info?.artboards ?? []).filter((a: any) => titles.some((t) => String(a.name).startsWith(`${t} · `))).map((a: any) => a.id)
    if (stale.length) { await call("delete_nodes", { nodeIds: stale }); console.log(`Replaced ${stale.length} earlier artboard(s): ${stale.join(", ")}`) }
  }
  const stamp = new Date().toISOString().slice(11, 16).replace(":", "")
  for (const id of files) {
    const html = readFileSync(join(PAPER_DIR, `${id}.html`), "utf8")
    const width = Number(html.match(/width:(\d+)px/)?.[1] ?? 1200), height = Number(html.match(/height:(\d+)px/)?.[1] ?? 800)
    const bg = html.match(/background-color:(#[0-9a-f]{6})/i)?.[1] ?? "#0f0f0f"
    // Rows are the direct children of the fragment root; each is one self-contained line.
    const rows = html.split("\n").slice(1, -1).map((line) => line.trim()).filter(Boolean)
    const name = `${surfaces.find((s) => s.id === id)?.title ?? id} · ${stamp}`
    const created = await call("create_artboard", { name, styles: { display: "flex", flexDirection: "column", width: `${width}px`, height: `${height}px`, backgroundColor: bg, padding: `${PAD}px`, borderRadius: "10px" } })
    const artboardID = idFrom(created, "nodeId", "id", "artboardId")
    if (!artboardID) throw new Error(`create_artboard returned no id: ${textOf(created)}`)
    for (let i = 0; i < rows.length; i += ROWS_PER_WRITE) {
      await call("write_html", { html: rows.slice(i, i + ROWS_PER_WRITE).join("\n"), targetNodeId: artboardID, mode: "insert-children" })
      process.stdout.write(`\r${id.padEnd(16)} rows ${Math.min(i + ROWS_PER_WRITE, rows.length)}/${rows.length}`)
    }
    let check = ""
    try {
      await Bun.sleep(1200) // small artboards finish before Paper has laid the text out; a screenshot taken immediately is blank
      const shot = await call("get_screenshot", { nodeId: artboardID, scale: 1 })
      if (saveScreenshot(shot, join(CHECK_DIR, `${id}.png`))) check = ` · check: ui-lab/out/paper-check/${id}.png`
    } catch {}
    try { await call("finish_working_on_nodes", { nodeIds: [artboardID] }) } catch {}
    console.log(`\r${id.padEnd(16)} → artboard "${name}" (${width}×${height}, node ${artboardID})${check}`)
  }
  console.log("Done. Switch to Paper; new artboards were placed in free canvas space.")
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
