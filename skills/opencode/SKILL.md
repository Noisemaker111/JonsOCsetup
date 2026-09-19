---
name: opencode
description: Use when changing the OpenCode2 server, Quest runtime, Quest Web integration, model routing, or development activation in JonsOCsetup.
---

# OpenCode2 development

`JonsOCsetup` is the maintained source. The installed config and release-channel directories are deployment outputs, not alternate source trees.

Read only the task-relevant source plus `docs/development-workflow.md`. Follow `AGENTS.md` for ownership, authorization, model choice, and completion rules.

Keep these product boundaries intact:

- Quest is the persistent work record and runtime; Quest Web is the browser product.
- OpenCode2 provides typed runtime APIs to Quest Web; terminal UI and slash-command presentation are outside the product target.
- Models and routing stay user-editable; never hardcode a default or silent fallback.
- Plugins expose specific typed tools. Do not add generic workspace or workflow tools.

For a change, run the smallest focused test first, then `bun run check:core` and `bun run check:repo` when the affected boundary warrants them. Exercise the installed development channel through the same control the user uses. For this repository, merge verified work to `agents`, activate the development release, and preserve stable/production gates.
