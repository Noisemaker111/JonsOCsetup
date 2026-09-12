# Staged files that live outside this repo

`~/.codex` and `~/.agents` are not git repositories, so these are staged here for review and copied out
by `apply.sh` once you're happy with them. Nothing under here is live.

| staged | destination |
|---|---|
| `agents/glossary.md` | `~/.agents/glossary.md` (both hosts already symlink `.agents`) |
| `codex/AGENTS-additions.md` | append to `~/.codex/AGENTS.md` |
| `codex/prompts/issue-worker.md` | `~/.codex/prompts/issue-worker.md` → `/issue-worker` |
| `codex/prompts/audit.md` | `~/.codex/prompts/audit.md` → `/audit` |
