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

Rollout requires a newly loaded plugin generation including the composer bootstrap
in `cli.json`. Existing processes retain their loaded generation. Host updates
should recheck prompt traits, focus guards, keymap dispatch and raw key decoding.
