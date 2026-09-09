/**
 * Talk to the pen.dev MCP server (the one the Cursor/VS Code extension ships)
 * over stdio, without going through an agent.
 *
 *   bun ui-lab/pen-mcp.ts --tools                 # list tools
 *   bun ui-lab/pen-mcp.ts --state                 # get_app_state: which .pen is open, selection
 *   bun ui-lab/pen-mcp.ts --call <tool> '<json>'  # any tool, e.g. --call read_skill '{"path":"pen-schema.md"}'
 *
 * Tools in extension 0.6.70: execute, get_app_state, get_style, read_skill.
 * The server proxies to the running pen.dev editor (`--app cursor`), so Cursor
 * must be open with a .pen file for anything beyond --tools to answer
 * ("transport not connected to app: cursor" otherwise). Set PEN_APP to target
 * another app name (e.g. "desktop" for the standalone app).
 */
import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

function serverExe(): string {
  const root = join(homedir(), ".cursor", "extensions")
  const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith("highagency.pencildev-")).sort().at(-1) : undefined
  if (!dir) throw new Error("pen.dev extension not found under ~/.cursor/extensions; install highagency.pencildev in Cursor first")
  return join(root, dir, "out", process.platform === "win32" ? "mcp-server-windows-x64.exe" : process.platform === "darwin" ? (process.arch === "arm64" ? "mcp-server-darwin-arm64" : "mcp-server-darwin-x64") : (process.arch === "arm64" ? "mcp-server-linux-arm64" : "mcp-server-linux-x64"))
}

async function main() {
  const args = process.argv.slice(2)
  const child = spawn(serverExe(), ["--app", process.env.PEN_APP ?? "cursor"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
  let buffer = ""
  const pending = new Map<number, (m: any) => void>()
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString()
    let index: number
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1)
      if (!line) continue
      try { const m = JSON.parse(line); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } } catch {}
    }
  })
  child.stderr.on("data", (c) => { if (args.includes("--verbose")) process.stderr.write(c) })
  let next = 1
  const rpc = (method: string, params: any = {}, timeoutMs = 20_000) => new Promise<any>((resolve, reject) => {
    const id = next++
    pending.set(id, (m) => m.error ? reject(new Error(`${method}: ${m.error.message ?? JSON.stringify(m.error)}`)) : resolve(m.result))
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method}: timed out`)) } }, timeoutMs)
  })
  const notify = (method: string, params: any = {}) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
  const text = (r: any) => (r?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
  try {
    await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "opencode-ui-lab", version: "1" } })
    notify("notifications/initialized")
    if (args.includes("--tools")) {
      const r = await rpc("tools/list")
      for (const t of r.tools ?? []) console.log(`${t.name}\n  ${(t.description ?? "").split("\n")[0]}\n  args: ${Object.keys(t.inputSchema?.properties ?? {}).join(", ")}`)
    } else if (args.includes("--state")) {
      console.log(text(await rpc("tools/call", { name: "get_app_state", arguments: {} })))
    } else if (args.includes("--call")) {
      const i = args.indexOf("--call")
      const r = await rpc("tools/call", { name: args[i + 1], arguments: args[i + 2] ? JSON.parse(args[i + 2]) : {} }, 60_000)
      console.log(text(r) || JSON.stringify(r, null, 2))
    } else {
      console.log("usage: --tools | --state | --call <tool> '<json>'")
    }
  } finally {
    child.kill()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
