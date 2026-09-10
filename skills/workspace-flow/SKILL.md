---
name: workspace-flow
description: "Use when assigning repository work, choosing shared or isolated workspaces, reducing repeated startup checks, or integrating and retiring finished work."
---

# Workspace flow

1. Reuse the existing Quest and assignment. For new work, read the global mode with `node <this-skill>/scripts/check.mjs <workspace>`. The user has one persistent giver across projects; select the worker project without relocating or replacing that conversation. Existing assignments keep their recorded mode when the global switch changes.
2. In worktree mode, Quest prepares and assigns isolated workspaces. In shared mode, workers use the project checkout: pass literal relative `run.files` scopes, and use `quest_workspace` for ownership. Disjoint scopes can run together; omitted scopes reserve the whole checkout. Codex uses the same reservations. Shared ownership is cooperative, not a filesystem sandbox.
3. A worker with a dispatch readiness receipt checks its cwd and available editing/shell capabilities, then starts. Patch counts as editing. Skip repeated inventory, preflight and dependency installation unless a concrete failure requires them. Read applicable instructions and task-relevant documentation; use relative paths in commands and reports. Preserve the user's exact model in dispatch.
4. Keep one workspace through implementation and verification. Record actual results. Shared dependency setup and Git index/branch operations require exclusive checkout ownership. Integrate a coherent change once using the project's authorized method and verify the target contains it.
5. Observed terminal outcomes release shared reservations; unknown launches retain them. Retire isolated workspaces only after verified integration and confirmed inactive ownership. Shared cleanup never removes the project directory. Preserve unfinished work and use [recovery](../help-i-cant-work-right/SKILL.md) for a repeated blocker.

The global switch is `/quest-workspace` in OpenCode. Commands here are agent operations, not user startup steps. See [reference](reference.md) only for settings syntax, lifecycle details and verification receipts.
