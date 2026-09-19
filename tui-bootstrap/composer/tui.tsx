import { selectedPluginRoot, recordRuntimeLoad } from "../../scripts/runtime-contract.mjs"
import { Plugin } from "../../tui-legacy"
import { join } from "node:path"
const ROOT = join(import.meta.dir, "..", "..")
export default Plugin.define({
  id: "composer",
  async setup(ctx) {
    const pluginRoot = selectedPluginRoot(ROOT)
    const mod = await import(join(pluginRoot, "composer/tui-active/composer.tsx"))
    const result = await mod.default.setup(ctx)
    recordRuntimeLoad("tui:composer", pluginRoot)
    return result
  },
})
