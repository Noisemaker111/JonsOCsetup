/** @jsxImportSource @opentui/solid */
import type { KeyEvent } from "@opentui/core"
import { Plugin } from "../../tui-legacy"
import { delegatesWordDelete, focusedPrompt, WORD_DELETE_COMMAND } from "../composer-keys"

function ComposerKeys(props: { ctx: any }) {
  const { ctx } = props
  const prompt = () => focusedPrompt(ctx.renderer.currentFocusedEditor)
  ctx.keymap.layer(() => ({
    target: prompt,
    enabled: () => prompt() !== undefined,
    commands: [{
      id: "composer.windows.backward-word",
      bind: "backspace",
      run: (_input: string | undefined, event: KeyEvent | undefined) => {
        // Returning false hands the press back to the native binding, which is what every encoding
        // other than a bare BS must reach. See composer-keys.ts for why each one is excluded.
        if (!delegatesWordDelete(event, ctx.renderer.currentFocusedEditor)) return false
        ctx.keymap.dispatch(WORD_DELETE_COMMAND)
      },
    }],
  }))
  return null
}

export default Plugin.define({
  id: "composer",
  setup(ctx) {
    if (process.platform !== "win32") return
    ctx.ui.slot({ append: "app", render: () => <ComposerKeys ctx={ctx} /> })
  },
})
