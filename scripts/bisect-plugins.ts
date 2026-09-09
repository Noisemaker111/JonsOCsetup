import { resolveHostExecutable } from '../project-router/executable.mjs'
/**
 * Find the plugin that stops the host from booting.
 *
 * When a plugin blocks `setup()` the host prints nothing and answers nothing.
 * The promotion gate can only report "timeout" on every model, which looks
 * exactly like a spent plan — that is how an awaited event-stream
 * subscription in the orchestration plugin passed for a quota problem.
 *
 * This stages a candidate from the current tree and starts a real headless
 * host once per plugin, alone, so the culprit names itself:
 *
 *   bun scripts/bisect-plugins.ts
 *   bun scripts/bisect-plugins.ts --timeout 120
 *
 * `none` is run first as the control. If `none` does not answer, the problem
 * is the config or the environment, not a plugin.
 */
import { readFileSync, writeFileSync, existsSync, symlinkSync, rmSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { spawnSync } from "node:child_process"
import { parse as parseJson5 } from "json5"
import { stageCandidate } from "./plugin-deploy"

const root = process.env.OPENCODE_CONFIG_ROOT ?? join(homedir(), ".config", "opencode")
const argv = process.argv.slice(2)
const timeoutSec = Number(argv[argv.indexOf("--timeout") + 1]) || 90
// A port of its own: the shared bridge port is held by any running server, and
// the candidate would silently be answered by the generation already live.
const BRIDGE_PORT = "3099"

const candidate = stageCandidate(root)
try {
  if (!existsSync(join(candidate, "node_modules"))) {
    symlinkSync(join(root, "node_modules"), join(candidate, "node_modules"), "junction")
  }
  const set = JSON.parse(readFileSync(join(candidate, "plugin-set.json"), "utf8"))
  const config = parseJson5(readFileSync(join(candidate, "opencode.jsonc"), "utf8"))
  for (const p of Object.values(config.providers ?? {}) as Array<{ settings?: { baseURL?: string } }>) {
    const url = p?.settings?.baseURL
    if (typeof url === "string" && url.includes(":3012")) p.settings!.baseURL = url.replace(":3012", `:${BRIDGE_PORT}`)
  }
  writeFileSync(join(candidate, "tui.json"), JSON.stringify({ plugin: [] }, null, 2))

  const exe = resolveHostExecutable()
  const model = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : "openai/gpt-5.6-luna-fast"
  const entries: string[] = set.serverEntrypoints
  let culprits = 0

  for (const plugin of [null, ...entries]) {
    config.plugin = plugin ? [`./${plugin}`] : []
    writeFileSync(join(candidate, "opencode.jsonc"), JSON.stringify(config, null, 2))
    const r = spawnSync(exe, ["run", "--standalone", "--auto", "-m", model, "--agent", "general", "Reply exactly VALID"], {
      cwd: candidate, encoding: "utf8", shell: false, windowsHide: true, timeout: timeoutSec * 1000,
      env: { ...process.env, OPENCODE_CONFIG_DIR: candidate, OPENCODE_DISABLE_AUTOUPDATE: "1", CLAUDE_CODE_BRIDGE_PORT: BRIDGE_PORT },
    })
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
    const label = (plugin ?? "none (control)").padEnd(34)
    if (/VALID/.test(out)) { console.log(`${label} ok`); continue }
    // No output at all means it never finished booting; output plus no answer
    // is a different problem (the model), and not this script's business.
    const verdict = /\S/.test(out) ? `no answer: ${out.replace(/\s+/g, " ").trim().slice(0, 160)}` : "HANGS — blocked setup(), printed nothing"
    console.log(`${label} ${verdict}`)
    if (plugin) culprits++
  }
  if (culprits) process.exit(1)
} finally {
  try { rmSync(candidate, { recursive: true, force: true }) } catch {}
}
