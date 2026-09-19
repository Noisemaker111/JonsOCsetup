/**
 * Which raw key the composer is allowed to turn into a backward word delete.
 *
 * Windows Terminal has no key-disambiguation protocol, so it sends ASCII BS (08) for
 * Ctrl-Backspace and DEL (7f) for Backspace. The host decodes both as the same unmodified
 * Backspace, so its native `ctrl+backspace` binding for `input.delete.word.backward` can never
 * fire and Ctrl-Backspace deletes one character. Jon's keyboard has no Delete key and his input is
 * speech-to-text, so word deletion in the composer is how he corrects a long run of text.
 *
 * This lives on its own because the decision is one line of guards that is invisible inside a
 * mounted Solid component: the only way to exercise it there is to drive a real host, and a driven
 * host is exactly where it cannot be observed. The embedded terminal the drive harness renders into
 * answers the host's kitty keyboard query, so `key {name:backspace,ctrl:true}` arrives
 * modifier-tagged and word-deletes whether or not this code exists. `scripts/drive-opencode.ts`
 * `raw {hex}` sends the bytes a protocol-less terminal actually sends; this module is what those
 * bytes then meet.
 *
 * Everything except a bare 08 must fall through to a native binding. 7f is `input.backspace`,
 * 17 is `ctrl+w`, 1b 7f is `alt+backspace`, and a terminal that does disambiguate sends
 * Ctrl-Backspace with the modifier set, which the host already routes itself. Delegating any of
 * those would delete a word twice or delete a word where a character was asked for.
 */

/** ASCII DEL: ordinary Backspace on every terminal we see. Never delegated. */
export const BACKSPACE = "\x7f"
/**
 * ASCII BS: Ctrl-Backspace on a terminal without key disambiguation. Physical Ctrl+H encodes
 * identically and is therefore also a word delete in the composer; no forward deletion is ever
 * inferred from this byte.
 */
export const CTRL_BACKSPACE = "\x08"
/** The native command the composer delegates to, so word boundaries, undo and extmarks stay the host's. */
export const WORD_DELETE_COMMAND = "input.delete.word.backward"

/** The fields of the host's KeyEvent this decision reads. */
export interface ComposerKeyEvent {
  readonly raw?: string
  readonly ctrl?: boolean
  readonly meta?: boolean
  readonly shift?: boolean
  readonly option?: boolean
  readonly defaultPrevented?: boolean
}

/** The fields of the host's focused editor this decision reads. */
export interface ComposerEditor {
  readonly focused?: boolean
  readonly isDestroyed?: boolean
  readonly traits?: { readonly owner?: string; readonly role?: string }
}

/**
 * The focused editor when it is the native OpenCode prompt, otherwise undefined. The host blurs
 * disabled and hidden prompts and prompts behind dialogs, and other editors -- dialog search
 * inputs, the diff viewer -- are excluded by their traits so their Backspace stays untouched.
 */
export function focusedPrompt(editor: ComposerEditor | null | undefined): ComposerEditor | undefined {
  if (!editor || !editor.focused || editor.isDestroyed) return undefined
  if (editor.traits?.owner !== "opencode" || editor.traits?.role !== "prompt") return undefined
  return editor
}

/** Whether this key press in this editor is the ambiguous Ctrl-Backspace that only we can resolve. */
export function delegatesWordDelete(event: ComposerKeyEvent | undefined, editor: ComposerEditor | null | undefined): boolean {
  if (!focusedPrompt(editor)) return false
  if (!event || event.raw !== CTRL_BACKSPACE) return false
  if (event.ctrl || event.meta || event.shift || event.option) return false
  if (event.defaultPrevented) return false
  return true
}
