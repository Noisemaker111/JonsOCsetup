/**
 * Which prompt the composer's keymap layer is attached to.
 *
 * A keymap layer that carries a `target` is registered against the one Renderable its target
 * accessor returned when the layer's effect last ran, and the layer belongs to that Renderable for
 * the rest of its life. `renderer.currentFocusedEditor` is a plain property, so an accessor reading
 * it gives the effect nothing to re-run on: the layer stays bound to whichever prompt was focused
 * when the plugin mounted. The home screen and every session are different prompt instances, so
 * Ctrl-Backspace word-deleted on the home screen and silently fell back to one character everywhere
 * Jon actually types.
 *
 * This lives on its own because both halves of it are invisible inside a mounted Solid component and
 * both have already been wrong once: the subscription that keeps the target current, and the order
 * of subscribing and reading. Seeding the signal before subscribing moved the same defect one route
 * along -- the session word-deleted and the home screen deleted one character -- because the prompt
 * takes focus before the plugin's slot mounts and no further event is coming for it.
 */

/** The renderer event that reports a focus change. Asserted against the host's own constant. */
export const FOCUSED_EDITOR_EVENT = "focused_editor"

/** The part of the host renderer this decision reads. */
export interface FocusSource {
  readonly currentFocusedEditor: unknown
  on(event: string, handler: (current: unknown) => void): void
  off(event: string, handler: (current: unknown) => void): void
}

/**
 * Keeps `set` holding the currently focused editor. Subscribes first and reads second, so a prompt
 * that took focus before this ran is still seen. Returns the unsubscribe.
 */
export function followFocusedEditor(source: FocusSource, set: (editor: unknown) => void): () => void {
  const handler = (current: unknown) => set(current)
  source.on(FOCUSED_EDITOR_EVENT, handler)
  set(source.currentFocusedEditor)
  return () => source.off(FOCUSED_EDITOR_EVENT, handler)
}
