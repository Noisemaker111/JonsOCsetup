---
name: opencode
description: Use for OpenCode2 configuration, plugins, Quests, model routing, TUI, verification, or development-channel activation in JonsOCsetup.
---

# OpenCode2 development

`JonsOCsetup` is the maintained source. The installed config and release-channel directories are deployment outputs, not alternate source trees.

Read only the task-relevant source plus `docs/development-workflow.md`. Follow `AGENTS.md` for ownership, authorization, model choice, and completion rules.

Keep these boundaries intact:

- Quest is the persistent work record and runtime; Quest Web is the browser product.
- OpenCode2 retains Quest controls and typed runtime APIs. Usage presentation belongs in Quest Web.
- Models and routing stay user-editable; never hardcode a default or silent fallback.
- Plugins expose specific typed tools. Do not add generic workspace or workflow tools.

For a change, run the smallest focused test first, then `bun run check:core` and `bun run check:repo` when the affected boundary warrants them. Exercise the installed development channel through the same control the user uses. For this repository, merge verified work to `agents`, activate the development release, and preserve stable/production gates.
