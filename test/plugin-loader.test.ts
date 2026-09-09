import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { validateConfiguredPlugins } from "../plugin-health"
import { promote } from "../scripts/plugin-deploy"

function root() { const r = mkdtempSync(join(tmpdir(), "opencode-plugin-set-")); mkdirSync(join(r, "tui-active")); return r }
function config(r: string, plugin: string, tui = "") {
  writeFileSync(join(r, "opencode.jsonc"), `{ plugin: [${JSON.stringify(plugin)}] }`)
  writeFileSync(join(r, "cli.json"), `{ plugins: [${JSON.stringify(tui)}] }`)
}
const goodTui = `export default { id: "good", setup() {} }`

test("recursive helper mistaken for entrypoint is rejected by configured discovery", async () => {
  const r = root(); writeFileSync(join(r, "helper.ts"), `export const x = 1`); config(r, "./helper.ts")
  const bad = await validateConfiguredPlugins(r, join(r, "health.json")); expect(bad[0]?.error).toMatch(/default plugin export/); rmSync(r, { recursive: true, force: true })
})

test("syntax/import failure is quarantined while a healthy plugin remains loadable", async () => {
  const r = root(); writeFileSync(join(r, "broken.ts"), `export default {`); writeFileSync(join(r, "good.ts"), `export default { id: "good", setup() {} }`); config(r, "./broken.ts")
  const bad = await validateConfiguredPlugins(r, join(r, "health.json")); expect(bad[0]?.phase).toBe("syntax"); expect((await import(join(r, "good.ts"))).default.id).toBe("good"); rmSync(r, { recursive: true, force: true })
})

test("initialization throw is attributed without executing healthy entrypoint", async () => {
  const r = root(); writeFileSync(join(r, "throws.ts"), `throw new Error("init boom")`); config(r, "./throws.ts")
  const bad = await validateConfiguredPlugins(r, join(r, "health.json")); expect(bad[0]).toMatchObject({ phase: "import", action: "quarantined" }); rmSync(r, { recursive: true, force: true })
})

test("invalid TUI hook/schema mutation is rejected and bad concurrent candidate rolls back", async () => {
  const r = root(); writeFileSync(join(r, "tui-active", "bad.tsx"), `export default { id: "bad", tui() {} }`); config(r, "./good.ts", "./tui-active/bad.tsx"); writeFileSync(join(r, "good.ts"), `export default { id: "good", setup() {} }`)
  const bad = await validateConfiguredPlugins(r, join(r, "health.json")); expect(bad[0]?.phase).toBe("schema")
  const active = join(r, "plugins-active"); mkdirSync(active); writeFileSync(join(active, "sentinel"), "last-known-good")
  const candidate = join(r, "candidate"); mkdirSync(candidate); writeFileSync(join(candidate, "opencode.jsonc"), "{ plugin: [] }"); writeFileSync(join(candidate, "cli.json"), "{ plugins: [] }"); writeFileSync(join(candidate, "plugin-set.json"), JSON.stringify({serverEntrypoints:["bad.ts"],tuiEntrypoints:[]})); writeFileSync(join(candidate, "bad.ts"), "export default {")
  const result = await promote(r, candidate); expect(result.promoted).toBe(false); expect(readFileSync(join(active, "sentinel"), "utf8")).toBe("last-known-good"); expect(existsSync(join(r, "plugin-activation.json"))).toBe(true); expect(existsSync(candidate)).toBe(true); expect(existsSync(join(candidate, "node_modules"))).toBe(false); rmSync(r, { recursive: true, force: true })
})
