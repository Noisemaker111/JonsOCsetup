import { selectedPluginRoot, recordRuntimeLoad } from "../../scripts/runtime-contract.mjs"
import { Plugin } from "../../tui-legacy"
import { join } from "node:path"
const ROOT = join(import.meta.dir, "..", "..")
export default Plugin.define({
  id: "generation-indicator",
  async setup(ctx) {
    const pluginRoot = selectedPluginRoot(ROOT)
    const mod = await import(join(pluginRoot, "generation-indicator/tui-active/generation-indicator.tsx"))
    const result = await mod.default.setup(ctx)
    recordRuntimeLoad("tui:generation-indicator", pluginRoot)
    return result
  },
})
