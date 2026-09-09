import { selectedPluginRoot, recordRuntimeLoad } from "./scripts/runtime-contract.mjs"
/** Stable host entrypoint for one immutable server+TUI generation. */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { define } from "@opencode-ai/plugin/v2/promise"

const ROOT = import.meta.dir

function resolvePluginRoot(): string { return selectedPluginRoot(ROOT) }

export default define({
  id: "generation-bootstrap",
  async setup(ctx) {
    const pluginRoot = resolvePluginRoot()
    const set = JSON.parse(readFileSync(join(pluginRoot, "plugin-set.json"), "utf8"))
    for (const relative of set.serverEntrypoints ?? []) {
      const mod = await import(join(pluginRoot, relative))
      if (typeof mod.default?.setup !== "function") throw new Error(`${relative}: invalid server plugin`)
      await mod.default.setup(ctx)
      recordRuntimeLoad(`server:${set.entrypointOwners[relative]}`, pluginRoot)
    }
    recordRuntimeLoad("server", pluginRoot)
  },
})

