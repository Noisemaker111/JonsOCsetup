import { resolveHostExecutable } from '../project-router/executable.mjs'
import { expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { tuiEntrypoint } from "../plugin-health"

const root = join(import.meta.dir, "..")
const host = resolveHostExecutable()

test("cli.json is the authoritative TUI plugin config and lists bootstrap directories", () => {
  const cli = JSON.parse(readFileSync(join(root, "cli.json"), "utf8"))
  expect(cli.plugins).toEqual(["./tui-bootstrap/usage", "./tui-bootstrap/quests"])
  expect(cli.plugin).toBeUndefined()
  // tui.json is dead: the host only reads it to seed a cli.json that does not exist yet.
  expect(existsSync(join(root, "tui.json"))).toBe(false)
})

// beta-19059 (`fse` in the binary) resolves each cli.json entry against the
// config dir and `continue`s without a toast or log line when it is a file;
// only a directory reaches Host.resolve, which probes `<dir>/tui` for the
// TUI module. A file entry therefore hides the whole plugin silently.
test("every cli.json plugin is a directory with a tui.* entrypoint the host can resolve", () => {
  const cli = JSON.parse(readFileSync(join(root, "cli.json"), "utf8"))
  for (const entry of cli.plugins as string[]) {
    const dir = join(root, entry)
    expect(statSync(dir).isDirectory()).toBe(true)
    const tui = tuiEntrypoint(dir)
    expect(tui).toBeDefined()
    expect(readFileSync(tui!, "utf8")).toMatch(/export default Plugin\.define\(\{\s*id:\s*"[^"]+"/)
  }
})

test.skipIf(!existsSync(host))("installed host reads cli.json, migrates legacy tui.json, and validates V2 TUI modules", async () => {
  const binary = Buffer.from(await Bun.file(host).arrayBuffer())
  expect(binary.includes("https://opencode.ai/v2/cli.json")).toBe(true)
  expect(binary.includes("tui.json")).toBe(true)
  expect(binary.includes("cli.json")).toBe(true)
  expect(binary.includes("migrated cli config")).toBe(true)
  expect(binary.includes("Invalid V2 TUI plugin module")).toBe(true)
})
