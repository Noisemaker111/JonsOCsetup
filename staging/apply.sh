#!/usr/bin/env bash
# Copies the staged files to their real homes. Review them first; nothing here is live until you run it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$HOME/.agents" "$HOME/.codex/prompts"

cp "$here/agents/glossary.md"            "$HOME/.agents/glossary.md"
cp "$here/codex/prompts/issue-worker.md" "$HOME/.codex/prompts/issue-worker.md"
cp "$here/codex/prompts/audit.md"        "$HOME/.codex/prompts/audit.md"

# Append to the Codex AGENTS.md rather than overwriting it, and only once.
if ! grep -q "^## Reading Jk" "$HOME/.codex/AGENTS.md"; then
  printf '\n' >> "$HOME/.codex/AGENTS.md"
  tail -n +2 "$here/codex/AGENTS-additions.md" >> "$HOME/.codex/AGENTS.md"
  echo "appended to ~/.codex/AGENTS.md"
else
  echo "~/.codex/AGENTS.md already has the additions; left alone"
fi

echo "done"
