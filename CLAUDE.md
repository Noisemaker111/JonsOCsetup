@AGENTS.md

## Claude Code specifics

These are the places this harness differs from Codex and the Quest Giver. Everything else is above.

Merging: `gh pr merge <number> --auto --merge`. A direct `gh pr merge --merge` is refused by auto
mode as "Merge Without Review" and cannot be worked around, so it wastes a turn and hands the work
back. `gh api -X PATCH` on repository settings is refused the same way as "Permission Grant" — ask
Jon for those two.

Bash tool heredocs collapse `\\` to `\` before the interpreter sees them, which silently breaks
regexes and Windows paths inside `python - <<'PY'`. Build such strings with `chr(92)` or
`os.path.join`, or write the script to a file first.

Two shells, two syntaxes: the Bash tool is Git Bash and the PowerShell tool is pwsh. Pick one per
call and do not mix their quoting.

Memory: the shared `MEMORY.md` is the one every harness reads and writes. Claude Code's own
`~/.claude/projects/*/memory/` is private to this harness and does not reach Codex or the Quest
Giver, so anything another harness needs goes in the shared file.
