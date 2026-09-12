# Composer keys

On Windows, the composer plugin delegates raw `08` Backspace input to the host's
`input.delete.word.backward` command. Two physical Windows Terminal recorder
rounds established Ctrl-Backspace = `08` and ordinary Backspace = `7f`. OpenTUI
decodes both as unmodified Backspace, so another ordinary keybind cannot
distinguish them. The plugin checks the raw event only in the focused native
OpenCode prompt and uses the base keymap mode. Disabled/hidden prompts and prompts
behind dialogs lose focus in the host. Other editors are excluded by prompt traits.

Native commands continue to own word boundaries, selections, undo, content-change
notifications and attachment extmarks. Ordinary `7f` Backspace, modifier-preserving
Ctrl-Backspace, and Ctrl+Arrow retain their existing native bindings.

This relies on the demonstrated Windows Terminal BS/DEL convention: a terminal
that sends `08` for ordinary Backspace cannot distinguish those physical keys.
It also makes physical Ctrl+H, when encoded as `08`, equivalent to Ctrl-Backspace
in the composer. No forward mapping is inferred: physical Delete/Ctrl-Delete
identity remains pending because the recorder's Delete-labelled entries were
ambiguous. In particular, `08` is never mapped to forward deletion.

The decision itself is `composer-keys.ts`, guarded by `test/composer-word-delete.test.ts`,
because inside a mounted Solid component it can only be reached by driving a host
and a driven host is where it cannot be observed.

## Verifying this, and the way that does not work

`scripts/drive-opencode.ts` renders the host into an embedded terminal that answers
the host's kitty keyboard query (`CSI ?u`, then `CSI >5u` in `terminal.ansi`), so
its `key` action always arrives modifier-tagged. `key {name:backspace,ctrl:true}`
therefore reaches the host's own `ctrl+backspace` binding and word-deletes on a
release that does not contain this plugin at all — a drive built on `key` cannot
tell the fix from its absence. Use `raw {hex}`, which writes the bytes a terminal
without that protocol sends. Measured on 2026-09-11 against beta-19398:

| key | bytes | without the plugin | with it |
|---|---|---|---|
| Backspace | `7f` | one character | one character |
| Ctrl-Backspace | `08` | **one character** | previous word |
| Ctrl+W | `17` | previous word | previous word |
| Alt+Backspace | `1b 7f` | previous word | previous word |

Ctrl+W and Alt+Backspace already reach `input.delete.word.backward` natively, so
only `08` needed a remedy. With the plugin, `08` also spans a trailing whitespace
run before the word, joins lines from the start of a line, and is a no-op on an
empty composer.

Rollout requires a newly loaded plugin generation including the composer bootstrap
in `cli.json`. Existing processes retain their loaded generation. Host updates
should recheck prompt traits, focus guards, keymap dispatch and raw key decoding.
