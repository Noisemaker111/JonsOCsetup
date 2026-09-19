/** @jsxImportSource @opentui/solid */
import type { KeyEvent } from "@opentui/core"
import { createSignal, onCleanup, onMount } from "solid-js"
import { Plugin } from "../../tui-legacy"
import { delegatesWordDelete, focusedPrompt, WORD_DELETE_COMMAND } from "../composer-keys"
import { followFocusedEditor } from "../composer-focus"

function ComposerKeys(props: { ctx: any }) {
  const { ctx } = props
  // The layer's target has to be a signal or it is pinned to the first prompt that was focused and
  // dies in every session. composer-focus.ts holds that decision and the order it depends on.
  const [focusedEditor, setFocusedEditor] = createSignal<unknown>(undefined)
  onMount(() => onCleanup(followFocusedEditor(ctx.renderer, (editor) => setFocusedEditor(() => editor))))
  const prompt = () => focusedPrompt(focusedEditor() as any)
  ctx.keymap.layer(() => ({
    target: prompt,
    enabled: () => prompt() !== undefined,
    commands: [{
      id: "composer.windows.backward-word",
      bind: "backspace",
      run: (_input: string | undefined, event: KeyEvent | undefined) => {
        // Returning false hands the press back to the native binding, which is what every encoding
        // other than a bare BS must reach. See composer-keys.ts for why each one is excluded.
        if (!delegatesWordDelete(event, focusedEditor() as any)) return false
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
