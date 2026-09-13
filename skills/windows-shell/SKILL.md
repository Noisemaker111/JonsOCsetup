---
name: windows-shell
description: Diagnose Windows shell quoting, paths or command failures when the tool’s own guidance is insufficient.
---

# Windows shell troubleshooting

Read the actual shell and error before choosing syntax. OpenCode attaches routine guidance to its exposed shell tools; do not load this file for every command.

- Use the current shell’s native syntax and forward-slash paths. `rg` finds files and symbols; inspect relevant spans.
- Run package scripts with the package directory as cwd. Check both the exit status and that the intended script actually ran.
- Preserve literal text when quoting, and verify resolved paths before moving or removing directories.
- Batch independent reads, keep dependencies sequential, and retain verbose output in a local evidence log.
- Let the host own long-running command sessions. Use their completion signal; do not replace them with repeated short polls.

The reasoning and measured examples live in [Windows shell observations](../../docs/windows-shell-observations.md). They are historical evidence, not universal runtime limits.
