---
name: windows-shell
description: Use for shell and filesystem work on Windows. Follow the current project's package manager and scripts.
---

# Windows shell

Load this skill before any task that involves shell commands, paths, package
scripts, Git inspection, or filesystem operations. Commands run in PowerShell
on Windows unless explicitly stated otherwise.

## Do

- Use `pwsh` cmdlets and `rg`; use `Get-Content -Head/-Tail` and
  `Select-String` for text inspection.
- Use forward slashes in Git and pnpm paths: `packages/example`.
- Put every command a single decision needs into one tool call, joined with
  PowerShell `;` or `Promise.allSettled` over `exec_command`. See Turn economy.
- Use the project's package manager. For Bun workspaces use `bun --cwd packages/<pkg> run <script>`; for pnpm use `pnpm -C <package-directory> <command>`.
- Use `pnpm --filter <package> run <script>` only when the selected package
  defines that script.
- Use `git show --name-only --format= <commit>` for files changed by a commit;
  use `git ls-tree <tree-ish>` for files in a tree snapshot.

## Don't

- Do not use `&&` in shell commands; use `;` or separate tool calls.
- Do not use Unix-only commands such as `ls`, `rm -rf`, `cp`, `mv`, `cat`,
  `head`, or `tail`.
- Do not write `pnpm --filter build`: `--filter` selects a package, it does not
  select a script.
- Do not use backslash-heavy relative paths in Git or pnpm arguments.
- Do not use `git ls-tree` to inspect commit history or changed files.
- Do not poll with a sub-30-second `yield_time_ms`; wait inside the cell instead.
- Do not spend a tool call writing a line you already hold in the conversation.
- Do not read a whole file to find one symbol; search first.

## Turn economy

A tool call is never free and its cost is not its output. Every call replays the
whole conversation to the model and again to the approvals reviewer, so on this
machine one call costs roughly 320k input tokens regardless of whether it prints
four lines or four hundred. Measured on the 2026-09-12 OpenCode session: 790
calls, 247M tokens, and 1.0M tokens of information actually gathered. Optimise
the number of calls, not the size of their output.

Three rules follow from that.

Wait inside the cell, never across calls. `await new Promise(r=>setTimeout(r,3000))`
in a loop until the thing you are waiting for is true costs nothing; a `wait`
with `yield_time_ms: 1000` costs a full turn per second waited. Set
`yield_time_ms` to the real duration of the work, or use the first-line pragma
`// @exec: {"yield_time_ms": 120000, "max_output_tokens": 4000}`. If a harness
forces you to poll because it has no way to block until a condition holds, that
harness has a missing feature; fix the harness rather than paying the poll.

Batch everything one decision needs. One `Promise.allSettled` over several
`exec_command` calls costs one turn. The same commands issued one per turn cost
one turn each and tell you nothing extra. Group reads, the write that follows
them, and the check that confirms it into a single cell whenever the later steps
do not depend on reading the earlier output.

Search before reading. `rg -n '<symbol>' -C5` over a tree costs less than
`Get-Content` on one file and usually answers the question outright. Read a file
whole only after a search has shown you need all of it, and never re-read a file
this session already read — if you keep needing it after a compaction, write the
twenty lines that matter into the project's AGENTS.md or MEMORY.md instead.

## Verified PowerShell snippets

These snippets are safe, non-interactive, and were verified with PowerShell:

```powershell
Get-ChildItem -Force | Select-Object Mode,Length,Name
```

```powershell
Get-Content -Path README.md -Head 20
```

```powershell
git show --name-only --format= HEAD
```
