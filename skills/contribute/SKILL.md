---
name: contribute
description: Use when preparing an upstream contribution or publishing a change. Follow the target repository's contribution rules and the user's authorization.
---

# Contributing changes

Work in the repository named by the task. This globally available skill does
not select a checkout, branch, fork policy or deployment procedure for it.

1. Read the target repository's AGENTS.md, CONTRIBUTING.md and applicable templates. For an upstream issue or PR, search existing open and closed work before creating a duplicate. Local edits do not require opening an issue.
2. Inspect the actual base branch and focused diff. Preserve unrelated changes. Use the project's isolation procedure when needed; do not relocate work to fixed OpenCode checkouts.
3. Verify proportionately with that project's checks. Describe observed behavior and limitations accurately. Documentation-only edits need document checks, not unrelated runtime deployments.
4. Stage explicit task-owned paths and commit locally. Publish only within explicit user authorization; do not ask again for the same already-authorized action. Never infer permission to push, merge, release, comment or reopen from permission to edit locally.
5. Respect a closed contribution. Reopening, destructive branch cleanup or history rewriting requires explicit authorization. Check the result of any authorized external change.

Use the existing repository remotes and authentication. Create a fork only
when the contribution workflow requires it and the user authorizes that action.
Do not require a fork for every PR or prohibit local plugin development.
