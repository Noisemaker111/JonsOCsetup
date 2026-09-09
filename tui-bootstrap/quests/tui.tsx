import { selectedPluginRoot, recordRuntimeLoad } from "../../scripts/runtime-contract.mjs"
import { Plugin } from "../../tui-legacy"
import { join } from "node:path"
const ROOT = join(import.meta.dir, "..", "..")
export default Plugin.define({
  id: "quests",
  async setup(ctx) {
    const pluginRoot = selectedPluginRoot(ROOT)
    const mod = await import(join(pluginRoot, "quest/tui-active/quests.tsx"))
    const result = await mod.default.setup(ctx)
    recordRuntimeLoad("tui:quests", pluginRoot)
    return result
  },
})
