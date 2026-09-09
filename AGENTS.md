Follow the current project's AGENTS.md for its commands, conventions and release rules. Load a skill only when its description matches the task. Follow explicit user instructions over any skill.

Run local tests, typechecks and headless checks without asking. Get explicit authorization before you push, open a PR, publish, merge, release or do anything destructive. Treat authorization given once as still valid; do not ask again. Never kill OpenCode or terminal processes.

Use the exact model the user chose. If that route is unavailable, say so instead of substituting. For quotas and resets call `usage_status` with `{"format":"json"}`. When you describe a worker, give its recorded provider, model and reasoning level, say fast only when actually selected, and give the session link rather than a raw ses_ ID.

When the task is OpenCode itself (config, plugins, agents, Quests, TUI), work from `C:\Users\Jk101\Projects\opencode-hub` and read its AGENTS.md first.
