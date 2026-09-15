import { selectedPluginRoot, recordRuntimeLoad } from "./scripts/runtime-contract.mjs"
/** Stable host entrypoint for one immutable server+TUI generation. */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { define } from "@opencode-ai/plugin/v2/promise"
import { setupServerPlugins } from "./scripts/server-plugin-lifecycle"

const ROOT = import.meta.dir

export default define({
  id: "generation-bootstrap",
  async setup(ctx) {
    const pluginRoot = selectedPluginRoot(ROOT)
    const set = JSON.parse(readFileSync(join(pluginRoot, "plugin-set.json"), "utf8"))
    const entries: string[] = set.serverEntrypoints ?? []
    let index = 0
    const dispose = await setupServerPlugins(ctx, entries.map(relative => async () => {
      const mod = await import(join(pluginRoot, relative))
      if (typeof mod.default?.setup !== "function") throw new Error(`${relative}: invalid server plugin`)
      return mod.default
    }), () => recordRuntimeLoad(`server:${set.entrypointOwners[entries[index++]]}`, pluginRoot))
    recordRuntimeLoad("server", pluginRoot)
    return dispose
  },
})
