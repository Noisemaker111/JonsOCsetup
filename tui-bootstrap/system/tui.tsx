import { join } from "node:path"
import { selectedPluginRoot, recordRuntimeLoad } from "../../scripts/runtime-contract.mjs"
import { Plugin } from "../../tui-legacy"

const ROOT = join(import.meta.dir, "..", "..")
export default Plugin.define({
  id: "system",
  async setup(ctx) {
    const pluginRoot = selectedPluginRoot(ROOT)
    const mod = await import(join(pluginRoot, "system/tui-active/system.tsx"))
    const result = await mod.default.setup(ctx)
    recordRuntimeLoad("tui:system", pluginRoot)
    return result
  },
})
