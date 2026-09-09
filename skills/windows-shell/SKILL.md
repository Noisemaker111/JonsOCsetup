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
- Use one command per tool call, or PowerShell `;` for independent commands.
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
