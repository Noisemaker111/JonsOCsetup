/** CLI bridge and shell/output hooks. Model selection belongs to native host controls and Quest admission. */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { define } from "@opencode-ai/plugin/v2/promise"
import { assertSafeShell } from "../scripts/shell-guard"
import { recordPluginHealth, clearPluginHealth } from "../plugin-health"
import { installClaudeCodeSession } from "./claude-code-session"

const CONFIG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TOOL_LOG_DIR = join(CONFIG_ROOT, "logs")
const TOOL_OUTPUT_MAX_LINES = 50
const TOOL_OUTPUT_MAX_BYTES = 4096
const TRUNCATED_OUTPUT_MARKER = "\u2026 (truncated, full log in logs/)"
const PLUGIN_PATH = "harnesses/server.ts"

/** Host hook isolation: one bad callback must not poison the shared event bus. */
async function safeToolHook(toolHook: Function, name: string, callback: (...args: any[]) => any, essential = false) {
  try {
    await toolHook(name, async (...args: any[]) => {
      try { return await callback(...args) }
      catch (error) {
        if (essential && /CAP HIT|capacity blocked|quota state is unknown|model is immutable|xai|Missing key: scope|ClaudeCodeDirectResult/i.test(String(error))) throw error
        recordPluginHealth({ path: PLUGIN_PATH, phase: "hook", error: `${name}: ${String(error)}`, action: "disabled" })
        console.error(`[favorite-router] ${name} hook disabled after error:`, error)
        if (essential) throw error
        return undefined
      }
    })
    clearPluginHealth(PLUGIN_PATH)
  } catch (error) {
    recordPluginHealth({ path: PLUGIN_PATH, phase: "hook", error: `${name} registration: ${String(error)}`, action: "disabled" })
    console.error(`[favorite-router] ${name} hook unavailable; continuing without it:`, error)
    if (essential) throw error
  }
}

/** Generic compaction for noisy tools; deliberately knows no tool-specific errors. */
export function compactToolOutput(value: unknown): string {
  const source = String(value ?? "")
  const input = source.split(/\r?\n/)
  const compact: string[] = []
  let previous: string | undefined
  let count = 0
  const flush = () => {
    if (previous === undefined) return
    compact.push(previous)
    if (count > 1) compact.push(`x${count} repeated`)
  }
  for (const line of input) {
    if (line === previous) count++
    else { flush(); previous = line; count = 1 }
  }
  flush()
  const full = compact.join("\n")
  if (compact.length <= TOOL_OUTPUT_MAX_LINES && Buffer.byteLength(full, "utf8") <= TOOL_OUTPUT_MAX_BYTES) return full
  const kept: string[] = []
  for (const line of compact) {
    if (kept.length >= TOOL_OUTPUT_MAX_LINES - 1) break
    const candidate = [...kept, line, TRUNCATED_OUTPUT_MARKER].join("\n")
    if (Buffer.byteLength(candidate, "utf8") > TOOL_OUTPUT_MAX_BYTES) break
    kept.push(line)
  }
  return [...kept, TRUNCATED_OUTPUT_MARKER].join("\n")
}


/** Reject Unix-shell syntax, and any command that would work in a temp directory. */
export async function installShellGuard(ctx: { tool?: { hook?: Function } }) {
  const toolHook = ctx?.tool?.hook
  if (typeof toolHook !== "function") return
  await safeToolHook(toolHook, "execute.before", (event: unknown) => {
    const ev = (event ?? {}) as Record<string, unknown>
    const name = String(ev.tool ?? ev.name ?? "")
    if (!/^(shell|bash|cmd|powershell|pwsh)$/i.test(name)) return
    const input = (ev.input ?? ev.args ?? {}) as Record<string, unknown>
    const command = typeof input === "string" ? input : input.command ?? input.cmd
    // cwd matters as much as the command: a session running inside %TEMP%
    // produces work nobody can find again, whatever it types.
    const cwd = [input.cwd, ev.cwd, ev.directory].find((v): v is string => typeof v === "string" && v.length > 0)
    if (typeof command === "string") assertSafeShell(command, cwd)
  })
}

/** Keep the model context small while writing an untouched copy for diagnosis. */
export async function installToolOutputTruncation(ctx: { tool?: { hook?: Function } }) {
  const toolHook = ctx?.tool?.hook
  if (typeof toolHook !== "function") return
  await safeToolHook(toolHook, "execute.after", (input: unknown, suppliedOutput?: unknown) => {
    const event = (input ?? {}) as Record<string, unknown>
    const output = (suppliedOutput ?? event.output) as Record<string, unknown> | undefined
    if (!output || typeof output.output !== "string") return
    const full = output.output
    const compact = compactToolOutput(full)
    if (compact === full) return
    try {
      mkdirSync(TOOL_LOG_DIR, { recursive: true })
      const callID = String(event.callID ?? event.id ?? Date.now()).replace(/[^a-z0-9_-]/gi, "_")
      writeFileSync(join(TOOL_LOG_DIR, `tool-${callID}.log`), full, "utf8")
    } catch (error) {
      console.warn("[favorite-router] could not save full tool output", error)
    }
    output.output = compact
  })
}

export default define({
  id: "favorite-router",
  async setup(ctx) {

    await ctx.agent.transform((draft) => {
      for (const agent of draft.list()) {
        const name = agent.name ?? ""
        if (name === "claude-code" || name === "claude-code-harness") {
          draft.update(name, (next) => {
            next.model = undefined
          })
        }
        // Leftover model-* clones are not Task targets. Do not re-inflate them.
      }
    })

    // /usage is a TUI palette slash (usage/tui-active/usage.tsx). usage_status
    // lives in usage/server.ts. Do not register either here — command.transform
    // steals the slash into a synthetic chat turn.

    // Quest run owns automatic route selection through the shared policy planner.
    // The model picker remains a user selection surface, not a competing scheduler.

    // Optional hooks are isolated individually. OpenCode2 currently invokes
    // plugin setup in one promise and has no per-plugin quarantine boundary.
    // Never turn a hook registration defect into an accepted-but-never-started
    // Task or a dead session; the health journal records the disabled hook.
    for (const [name, install] of [
      ["claude-code-session", () => installClaudeCodeSession(ctx)],
      ["shell-guard", () => installShellGuard(ctx)],
      ["tool-output-truncation", () => installToolOutputTruncation(ctx)],
    ] as const) {
      try { await install() }
      catch (error) {
        recordPluginHealth({ path: `${PLUGIN_PATH}#${name}`, phase: "init", error: String(error), action: "disabled" })
        console.error(`[favorite-router] optional component ${name} disabled:`, error)
      }
    }

  },
})
