import { selectedPluginRoot, recordRuntimeLoad } from "../../scripts/runtime-contract.mjs"
import { Plugin } from "../../tui-legacy"
import { join } from "node:path"
const ROOT = join(import.meta.dir, "..", "..")
export default Plugin.define({
  id: "usage",
  async setup(ctx) {
    const pluginRoot = selectedPluginRoot(ROOT)
    const mod = await import(join(pluginRoot, "usage/tui-active/usage.tsx"))
    const result = await mod.default.setup(ctx)
    recordRuntimeLoad("tui:usage", pluginRoot)
    return result
  },
})
