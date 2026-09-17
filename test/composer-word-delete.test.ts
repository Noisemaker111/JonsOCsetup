/**
 * @core-prevents Ctrl-Backspace deleting a single character in the composer on a terminal that sends bare BS, and its opposite: the composer stealing a press that already reaches a native word-delete or character-delete binding
 * @core-observed On 2026-09-11 a drive of release dev-3068daef750f held "alpha beta gamma" in the composer and sent the bytes Windows Terminal actually sends: raw 08 (Ctrl-Backspace) left "alpha beta gamm", one character, while raw 17 and raw 1b 7f both removed the word. Jon's keyboard has no Delete key and his input is speech-to-text, so that key is how a long dictated run gets corrected.
 *
 * @core-prevents the composer's keymap layer being pinned to the first prompt that was focused, which makes Ctrl-Backspace word-delete in one route and silently fall back to one character in every other one
 * @core-observed On 2026-09-17, in a real Windows Terminal window running installed host 0.0.0-beta-19398, "one two three four five" plus two physical Ctrl-Backspace presses left "one two three four fi" inside a session while the same presses word-deleted on the home screen; Ctrl-W word-deleted in both, so the native command was reachable and only the plugin's layer was dead. Seeding the focused-editor signal before subscribing then moved the same failure to the home screen instead of curing it.
 */
import { test, expect } from "bun:test"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CliRenderEvents } from "@opentui/core"
import {
  BACKSPACE,
  CTRL_BACKSPACE,
  WORD_DELETE_COMMAND,
  delegatesWordDelete,
  focusedPrompt,
  type ComposerEditor,
} from "../composer/composer-keys"
import { FOCUSED_EDITOR_EVENT, followFocusedEditor, type FocusSource } from "../composer/composer-focus"

const PROMPT: ComposerEditor = { focused: true, isDestroyed: false, traits: { owner: "opencode", role: "prompt" } }
const press = (raw: string, modifiers: Partial<Record<"ctrl" | "meta" | "shift" | "option" | "defaultPrevented", boolean>> = {}) =>
  ({ raw, ...modifiers })

test("only a bare BS in the focused prompt becomes a word delete", () => {
  // The whole point: this byte is Ctrl-Backspace on Jon's terminal and the host cannot tell it from
  // Backspace, so nothing but this delegation makes the key delete a word.
  expect(delegatesWordDelete(press(CTRL_BACKSPACE), PROMPT)).toBe(true)

  // Every other encoding already reaches a binding of its own. Taking any of them deletes a word
  // where a character was asked for, or deletes two words for one press.
  expect(delegatesWordDelete(press(BACKSPACE), PROMPT)).toBe(false) // input.backspace, one character
  expect(delegatesWordDelete(press("\x17"), PROMPT)).toBe(false) // ctrl+w
  expect(delegatesWordDelete(press("\x1b\x7f"), PROMPT)).toBe(false) // alt+backspace
  expect(delegatesWordDelete(press("\x1b[127;5u"), PROMPT)).toBe(false) // a terminal that does disambiguate
  // Same byte, but a terminal that reports the modifier: the host's own ctrl+backspace owns it.
  expect(delegatesWordDelete(press(CTRL_BACKSPACE, { ctrl: true }), PROMPT)).toBe(false)
  for (const modifier of ["meta", "shift", "option", "defaultPrevented"] as const)
    expect(delegatesWordDelete(press(CTRL_BACKSPACE, { [modifier]: true }), PROMPT)).toBe(false)
  expect(delegatesWordDelete(undefined, PROMPT)).toBe(false)
})

test("editors that are not the focused native prompt keep their own Backspace", () => {
  // A dialog search input, the diff viewer, or a prompt the host blurred behind a dialog. Word
  // deletion there would be this plugin reaching outside the one editor it was written for.
  const cases: Array<[string, ComposerEditor | undefined]> = [
    ["blurred", { ...PROMPT, focused: false }],
    ["destroyed", { ...PROMPT, isDestroyed: true }],
    ["another owner", { ...PROMPT, traits: { owner: "quests", role: "prompt" } }],
    ["another role", { ...PROMPT, traits: { owner: "opencode", role: "search" } }],
    ["no traits", { focused: true, isDestroyed: false }],
    ["nothing focused", undefined],
  ]
  for (const [name, editor] of cases) {
    expect(`${name}: ${focusedPrompt(editor) !== undefined}`).toBe(`${name}: false`)
    expect(`${name}: ${delegatesWordDelete(press(CTRL_BACKSPACE), editor)}`).toBe(`${name}: false`)
  }
  expect(focusedPrompt(PROMPT)).toBe(PROMPT)
})

test("the layer's prompt follows focus, including the prompt that was already focused", () => {
  // A real emitter standing in for the renderer: the host's CliRenderer is an EventEmitter and this
  // is the same contract, so nothing here is a mock of the app's behaviour.
  class Renderer extends EventEmitter implements FocusSource {
    currentFocusedEditor: unknown = undefined
    focus(editor: unknown) {
      this.currentFocusedEditor = editor
      this.emit(FOCUSED_EDITOR_EVENT, editor, undefined)
    }
  }
  // The host's own name for the event. If it is ever renamed, the subscription would go silent and
  // the layer would go back to being pinned, with nothing on screen to say so.
  expect(FOCUSED_EDITOR_EVENT).toBe(CliRenderEvents.FOCUSED_EDITOR)

  const renderer = new Renderer()
  const home = { name: "home prompt" }
  const session = { name: "session prompt" }

  // The prompt takes focus before the plugin's slot mounts, so the first thing this must do is see
  // an editor no event will be sent for again. Not reading it at all left the home screen deleting
  // one character; the order of the read and the subscription is not observable from here, and does
  // not need to be, because doing both inside one call is what closes that window.
  renderer.focus(home)
  let followed: unknown = "not set"
  const stop = followFocusedEditor(renderer, (editor) => (followed = editor))
  expect(followed).toBe(home)

  // Opening a session builds a new prompt. The pinned layer died here.
  renderer.focus(session)
  expect(followed).toBe(session)

  // Losing focus is reported too, so the layer stops claiming a prompt that is gone.
  renderer.focus(undefined)
  expect(followed).toBe(undefined)

  stop()
  renderer.focus(home)
  expect(followed).toBe(undefined)
  expect(renderer.listenerCount(FOCUSED_EDITOR_EVENT)).toBe(0)
})

test("the composer delegates rather than editing text, and the drive harness can send the byte", () => {
  const root = join(import.meta.dir, "..")
  // Word boundaries, selections, undo and attachment extmarks stay with the host command; the
  // plugin only resolves which key was pressed.
  const has = (file: string, needle: string) => `${file} sends ${needle}: ${readFileSync(join(root, file), "utf8").includes(needle)}`
  expect(has("composer/tui-active/composer.tsx", "delegatesWordDelete")).toBe("composer/tui-active/composer.tsx sends delegatesWordDelete: true")
  expect(has("composer/tui-active/composer.tsx", "ctx.keymap.dispatch(WORD_DELETE_COMMAND)"))
    .toBe("composer/tui-active/composer.tsx sends ctx.keymap.dispatch(WORD_DELETE_COMMAND): true")
  expect(WORD_DELETE_COMMAND).toBe("input.delete.word.backward")
  // The layer's target must be the signal the focus subscription writes, never the renderer
  // property, which is what pinned it to one prompt.
  expect(has("composer/tui-active/composer.tsx", "followFocusedEditor(ctx.renderer")).toBe("composer/tui-active/composer.tsx sends followFocusedEditor(ctx.renderer: true")
  expect(has("composer/tui-active/composer.tsx", "focusedPrompt(focusedEditor()")).toBe("composer/tui-active/composer.tsx sends focusedPrompt(focusedEditor(): true")
  expect(readFileSync(join(root, "composer/tui-active/composer.tsx"), "utf8")).not.toContain("focusedPrompt(ctx.renderer.currentFocusedEditor)")

  // The harness is the other half of this invariant. Its embedded terminal answers the host's kitty
  // keyboard query, so the `key` action always arrives modifier-tagged and word-deletes whether or
  // not the composer exists -- a drive using it "verified" this fix against a release that did not
  // contain it. Only a raw byte path reproduces the terminal Jon actually types into.
  expect(has("scripts/drive-opencode.ts", "c.action==='raw'")).toBe("scripts/drive-opencode.ts sends c.action==='raw': true")
  expect(has("scripts/drive-opencode.ts", "Buffer.from(c.hex,'hex')")).toBe("scripts/drive-opencode.ts sends Buffer.from(c.hex,'hex'): true")
})
