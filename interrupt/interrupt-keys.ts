/**
 * When a single Esc stops the turn that is running.
 *
 * The host arms instead of interrupting: `session.interrupt` increments a counter, schedules a
 * timeout that clears it after five seconds, and only calls the server once the counter reaches two
 * (opencode2 packages/tui/src/component/prompt/index.tsx:533-545). The only sign the first press
 * registered is one word in the footer. A user who presses Esc, looks at the screen to see whether
 * anything happened, and presses again has already missed the window, so the turn never stops however
 * many times he presses. Measured 2026-09-17 in a real Windows Terminal: two presses two seconds
 * apart stop the turn, two presses seven seconds apart do not.
 *
 * This decides, from what a plugin can actually see, whether a press is the one that should stop the
 * turn. Everything it does not claim falls through to the host's own escape bindings, which is what
 * keeps Esc closing dialogs, dismissing autocomplete, leaving shell mode and clearing a pending key
 * sequence.
 */

/** The host command that stops the running turn. Dispatching it twice satisfies its own arming. */
export const INTERRUPT_COMMAND = "session.interrupt"

/** The fields of the host's focused editor this decision reads. */
export interface PromptView {
  readonly focused?: boolean
  readonly isDestroyed?: boolean
  readonly traits?: {
    readonly owner?: string
    readonly role?: string
    readonly status?: string
    readonly capture?: readonly string[]
  }
}

/**
 * Whether this Esc should stop the turn.
 *
 * - `interruptable` is whether the host currently offers `session.interrupt` as a reachable, enabled
 *   command, which is the host's own answer to "is a turn running", not a second opinion.
 * - The prompt must be the focused native composer. The host blurs it behind dialogs and while it is
 *   hidden or disabled (index.tsx:742-752), and its own command gives up on a blurred prompt, so a
 *   press we consumed there would stop nothing and close nothing.
 * - `capture` contains "escape" exactly while the prompt's autocomplete is open
 *   (packages/tui/src/prompt/traits.ts:17-22). That press belongs to the autocomplete.
 * - `status` is "SHELL" in shell mode, where the host's escape leaves shell mode instead.
 */
export function interruptsTurn(prompt: PromptView | null | undefined, interruptable: boolean): boolean {
  if (!interruptable) return false
  if (!prompt || !prompt.focused || prompt.isDestroyed) return false
  if (prompt.traits?.owner !== "opencode" || prompt.traits?.role !== "prompt") return false
  if (prompt.traits?.status === "SHELL") return false
  if (prompt.traits?.capture?.includes("escape")) return false
  return true
}

/** The shape of one entry in the host's reachable-command list. */
export interface ReachableCommand {
  readonly id?: string
  readonly enabled?: boolean | (() => boolean)
}

/** Whether the host is currently offering to interrupt, read from its own reachable commands. */
export function interruptOffered(commands: readonly ReachableCommand[] | undefined): boolean {
  const command = commands?.find((entry) => entry.id === INTERRUPT_COMMAND)
  if (!command) return false
  if (typeof command.enabled === "function") return command.enabled() === true
  return command.enabled !== false
}
