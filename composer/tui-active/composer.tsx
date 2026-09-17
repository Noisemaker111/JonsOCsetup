/** @jsxImportSource @opentui/solid */
import type { KeyEvent } from "@opentui/core"
import { CliRenderEvents } from "@opentui/core"
import { createSignal, onCleanup, onMount } from "solid-js"
import { Plugin } from "../../tui-legacy"
import { delegatesWordDelete, focusedPrompt, WORD_DELETE_COMMAND } from "../composer-keys"

function ComposerKeys(props: { ctx: any }) {
  const { ctx } = props
  // ctx.renderer.currentFocusedEditor is a plain property, not a Solid signal. A keymap layer's
  // `target` is resolved once, inside useBindings' createEffect, when that effect runs -- so a
  // layer built directly from this property is pinned to whichever editor was focused when the
  // component mounted (the home prompt) and never re-registers against a later session's prompt.
  // Mirroring the focused editor into a signal, updated from the renderer's own FOCUSED_EDITOR
  // event, gives useBindings something to re-run on so the layer follows focus like the host's own
  // prompt layers (which target the `inputTarget` signal) already do.
  const [focusedEditor, setFocusedEditor] = createSignal(ctx.renderer.currentFocusedEditor)
  const onFocusedEditor = (next: unknown) => setFocusedEditor(() => next)
  onMount(() => {
    ctx.renderer.on(CliRenderEvents.FOCUSED_EDITOR, onFocusedEditor)
    // Subscribe first, then re-read: the prompt usually takes focus before this slot mounts, so the
    // value captured at component creation is stale and no further event is coming for it. Seeding
    // only at creation left the home composer deleting one character while a session word-deleted,
    // which is the same defect this fix is for, moved one route along.
    setFocusedEditor(() => ctx.renderer.currentFocusedEditor)
  })
  onCleanup(() => {
    ctx.renderer.off(CliRenderEvents.FOCUSED_EDITOR, onFocusedEditor)
  })
  const prompt = () => focusedPrompt(focusedEditor())
  ctx.keymap.layer(() => ({
    target: prompt,
    enabled: () => prompt() !== undefined,
    commands: [{
      id: "composer.windows.backward-word",
      bind: "backspace",
      run: (_input: string | undefined, event: KeyEvent | undefined) => {
        // Returning false hands the press back to the native binding, which is what every encoding
        // other than a bare BS must reach. See composer-keys.ts for why each one is excluded.
        if (!delegatesWordDelete(event, focusedEditor())) return false
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
