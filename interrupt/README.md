# Interrupt

One Esc stops the turn that is running.

The host arms rather than interrupting: `session.interrupt` increments a counter,
schedules a timeout that clears it after five seconds, and only calls the server
once the counter reaches two (opencode2
`packages/tui/src/component/prompt/index.tsx:533-545`). The only sign the first
press registered is one word in the footer. Measured 2026-09-17 in a real Windows
Terminal window on the installed host: two presses two seconds apart stop a
running turn, two presses seven seconds apart do not, and the turn is still
running five seconds later. Pressing Esc, looking at the screen and pressing
again is therefore a way to never interrupt anything.

This binds `escape` in a global-mode layer with no target, dispatches the host's
own `session.interrupt` twice so its arming is satisfied by one press, and shows
a toast immediately, because a saturated host can take tens of seconds to answer
the interrupt endpoint and the press must still look like it landed.

Everything it does not claim falls through to the host's own escape bindings.
`interrupt-keys.ts` holds that decision: the press is only taken when the host is
offering `session.interrupt` as a reachable enabled command, and the focused
editor is the native composer, not in shell mode, and not capturing escape for an
open autocomplete. Dialogs blur the prompt, so Esc still closes them.

The layer carries no `target` on purpose. A plugin layer with a target is
registered against one Renderable and is dead in every other route; an untargeted
global layer is reached in all of them, which was measured on the same day while
tracing the composer's Ctrl-Backspace defect.
