# Instruction ownership

This repository is both a personal OpenCode configuration loaded across projects and a project that has its own maintenance needs. Keep those scopes distinct.

| Content | Owner |
| --- | --- |
| Product overview and ordinary use | Root README and the documentation index |
| Personal behavior across projects | Root `AGENTS.md`; `CLAUDE.md` adds harness-specific details |
| OpenCode repository commands and integration rules | Hub `AGENTS.md` and `docs/development-workflow.md` |
| Agent role | `agent/quest-giver.md` and the runtime's assigned-worker context |
| Reusable task procedure | The relevant `skills/*/SKILL.md` |
| Model choices, account policy, pricing and measurements | User settings and runtime data; `models/` and `usage/` implement them |
| Task plans, progress and deliverables | Quests |
| Shared durable user context | Hub `MEMORY.md` |

The root README should help someone understand and use the setup. Worktree ownership, merge commands, gates, and internal maintenance belong in the linked development documentation.

A skill's availability does not make it applicable. The current project's instructions own its commands; an unrelated project must not run OpenCode repository maintenance commands merely because the personal configuration is loaded.

The hub is the starting directory for OpenCode maintenance. Its instruction source is tracked under `setup/files/Projects/opencode-hub/`; [setup](../setup/README.md) describes installation and links. Update the tracked source and its manifest hash together. Installed paths may point to another checkout; inspect the actual link and preserve independent edits.

Keep one current owner for each rule. The `agents-and-main` skill is portable; this repository's concrete policy uses `agents` and `main`. Internal runtime paths containing `dev` identify persistent state, not a Git branch. Dated receipts retain historical names and observations but never override current policy.

Use the [documentation index](README.md) for current guides. Do not copy an old model assignment, host version, price, test count, or unfinished task statement into current instructions.
