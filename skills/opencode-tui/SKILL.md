---
name: opencode-tui
description: Use for OpenCode2 terminal UI changes involving plugin slots, dialogs, keymaps, layout, themes, or OpenTUI rendering.
---

# OpenCode2 TUI

Use the generic `opentui` skill for component APIs. This file records only host integration rules.

- `cli.json` plugin entries are bootstrap directories containing `tui.tsx`.
- Mount chrome with `context.ui.slot({ append|prepend|before|after|replace, render })`.
- Register keymap layers from a mounted component because the provider is unavailable during `setup()`.
- Slash commands use `slash: { name }`; avoid collisions with host commands.
- Navigate with `context.ui.router.navigate(...)` and preserve the prior route when opening a plugin page.
- Use `context.ui.dialog.show`, `select`, `confirm`, or `alert`; do not invent a second overlay system.
- Keep slot content narrow, bounded, theme-aware, and keyboard accessible.

The production examples are `quest/tui-active/quests.tsx`, `quest/tui-active/quest-board.tsx`, and `system/tui-active/system.tsx`. Verify components headlessly, then exercise the real installed development host with `scripts/quest-ui-audit.ts` or the narrower user flow that changed.
