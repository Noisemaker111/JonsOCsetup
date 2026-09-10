/** @jsxImportSource @opentui/solid */
import type { KeyEvent } from "@opentui/core"
import { Plugin } from "../../tui-legacy"

function ComposerKeys(props: { ctx: any }) {
  const { ctx } = props
  const focusedPrompt = () => {
    const editor = ctx.renderer.currentFocusedEditor
    // The host blurs disabled/hidden prompts and prompts behind dialogs.
    return editor?.focused && !editor.isDestroyed &&
      editor.traits?.owner === "opencode" && editor.traits?.role === "prompt"
      ? editor : undefined
  }
  ctx.keymap.layer(() => ({
    target: focusedPrompt,
    enabled: () => focusedPrompt() !== undefined,
    commands: [{
      id: "composer.windows.backward-word",
      bind: "backspace",
      run: (_input: string | undefined, event: KeyEvent | undefined) => {
        // Windows Terminal sends BS for Ctrl-Backspace and DEL for Backspace.
        // OpenTUI decodes both as unmodified backspace. Do not remap DEL or
        // modifier-preserving encodings, which already have native bindings.
        if (!focusedPrompt() || event?.raw !== "\x08" || event.ctrl ||
          event.meta || event.shift || event.option || event.defaultPrevented) return false
        ctx.keymap.dispatch("input.delete.word.backward")
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
