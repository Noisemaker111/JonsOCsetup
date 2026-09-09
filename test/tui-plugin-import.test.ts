import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { validateConfiguredPlugins } from "../plugin-health"

const root = join(import.meta.dir, "..")

test("configured TUI bootstraps import and expose the host runtime shape", async () => {
  for (const path of ["tui-bootstrap/usage/tui.tsx", "tui-bootstrap/quests/tui.tsx"]) {
    const mod = await import(join(root, path))
    expect(mod.default).toMatchObject({ id: expect.any(String), setup: expect.any(Function) })
  }
})

test("TUI preflight resolves a cli.json directory entry to its tui module and rejects one without it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-dir-gate-"))
  try {
    mkdirSync(join(dir, "ok"), { recursive: true }); mkdirSync(join(dir, "empty"), { recursive: true })
    writeFileSync(join(dir, "ok", "tui.tsx"), 'export default { id: "ok", setup() {} }')
    writeFileSync(join(dir, "cli.json"), JSON.stringify({ plugins: ["./ok", "./empty"] }))
    const failures = await validateConfiguredPlugins(dir, join(dir, "health.json"))
    expect(failures).toEqual([expect.objectContaining({ path: "empty", phase: "schema", error: expect.stringMatching(/no entrypoint the host resolves/) })])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("TUI preflight rejects a module whose helper import fails before setup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-import-gate-"))
  try {
    writeFileSync(join(dir, "cli.json"), JSON.stringify({ plugins: ["./broken.tsx"] }))
    writeFileSync(join(dir, "broken.tsx"), 'import { Plugin } from "@opencode-ai/plugin/tui"\nexport default Plugin.define({ id: "broken", setup() {} })')
    const failures = await validateConfiguredPlugins(dir, join(dir, "health.json"))
    expect(failures).toEqual([expect.objectContaining({ path: "broken.tsx", phase: "import" })])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test("configured footer components receive context instead of the removed usePlugin helper", () => {
  for (const path of ["quest/tui-active/quests.tsx", "usage/tui-active/usage.tsx"]) {
    const source = readFileSync(join(root, path), "utf8")
    expect(source).not.toMatch(/usePlugin\s*\(/)
  }
})
