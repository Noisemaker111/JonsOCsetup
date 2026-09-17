/** @jsxImportSource @opentui/solid */
import { Plugin } from "../../tui-legacy"
import { INTERRUPT_COMMAND, interruptOffered, interruptsTurn } from "../interrupt-keys"

function InterruptKeys(props: { ctx: any }) {
  const { ctx } = props
  ctx.keymap.layer(() => ({
    // Global mode and no target: a plugin layer that carries a target is registered against one
    // Renderable and is dead in every other route, while an untargeted global layer is reached in
    // all of them. This one needs no target because its decision reads the focused prompt itself.
    mode: "global",
    // Escape is already bound by the prompt component's own layer, which is registered when the
    // session route mounts -- after this plugin's slot -- and at equal priority the later layer
    // wins. Without this the press never arrived: instrumented on 2026-09-17, the byte reached the
    // renderer, session.interrupt was reachable and enabled, and this run was never called. One is
    // enough to get ahead of the prompt and stays behind the session route's priority 10 sidebar
    // escape, which should keep closing the sidebar on a narrow terminal.
    priority: 1,
    commands: [{
      id: "interrupt.session.escape",
      title: "Interrupt the running turn",
      bind: "escape",
      run: () => {
        if (!interruptsTurn(ctx.renderer?.currentFocusedEditor, interruptOffered(ctx.keymap.commands()))) return false
        // The host's own command arms on the first press and only calls the server on the second,
        // inside a five second window. Two dispatches are one press for the user and leave that
        // counter back at zero.
        ctx.keymap.dispatch(INTERRUPT_COMMAND)
        ctx.keymap.dispatch(INTERRUPT_COMMAND)
        // A saturated host answers its own interrupt endpoint slowly -- on 2026-09-16 that host was
        // taking 13 to 40 seconds to serve a trivial health check -- so say the press landed now
        // rather than only when the server confirms.
        ctx.ui?.toast?.show?.({ message: "Interrupting" })
      },
    }],
  }))
  return null
}

export default Plugin.define({
  id: "interrupt",
  setup(ctx) {
    ctx.ui.slot({ append: "app", render: () => <InterruptKeys ctx={ctx} /> })
  },
})
