import { selectedPluginRoot, recordRuntimeLoad } from "../../scripts/runtime-contract.mjs"
import { Plugin } from "../../tui-legacy"
import { join } from "node:path"
const ROOT = join(import.meta.dir, "..", "..")
export default Plugin.define({
  id: "duration-graph",
  async setup(ctx) {
    const pluginRoot = selectedPluginRoot(ROOT)
    const mod = await import(join(pluginRoot, "duration-graph/tui-active/duration-graph.tsx"))
    const result = await mod.default.setup(ctx)
    recordRuntimeLoad("tui:duration-graph", pluginRoot)
    return result
  },
})
