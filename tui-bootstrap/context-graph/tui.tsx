import { selectedPluginRoot, recordRuntimeLoad } from "../../scripts/runtime-contract.mjs"
import { Plugin } from "../../tui-legacy"
import { join } from "node:path"
const ROOT = join(import.meta.dir, "..", "..")
export default Plugin.define({
  id: "context-graph",
  async setup(ctx) {
    const pluginRoot = selectedPluginRoot(ROOT)
    const mod = await import(join(pluginRoot, "context-graph/tui-active/context-graph.tsx"))
    const result = await mod.default.setup(ctx)
    recordRuntimeLoad("tui:context-graph", pluginRoot)
    return result
  },
})
