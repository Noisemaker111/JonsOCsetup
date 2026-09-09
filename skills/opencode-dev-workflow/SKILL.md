---
name: opencode-dev-workflow
description: Own OpenCode2 configuration and plugin changes through isolated worktrees, real-use verification, tracked PRs, automatic dev merges, and separate stable promotion on this machine.
---

# OpenCode2 dev workflow

Jon authorized this workflow on 2026-09-09 for his OpenCode2 setup. It does not
authorize releases or merges in unrelated projects.

The repository is `C:/Users/Jk101/.config/opencode`. Work in an owned worktree.
`dev` is the integration branch; `master` is stable. Reuse existing repair PRs.
Own implementation, coherent commits, a ready PR targeting dev, review using
actual operation and captured states, merge into dev, and dev activation. Do
not ask Jon to perform technical review or repeatedly approve those dev steps.
Stable promotion, host updates and public plugin publishing remain explicit.

Read the selected dev release's `docs/development-workflow.md`: find its `root`
in `C:/Users/Jk101/.config/opencode/.channels/dev.json`. If no dev release is
selected, read the document from the current worktree. Use `runtime:channel`
commands there for preparation, status, activation and dev/stable launch.

Exercise the actual intended operation twice through installed OpenCode2 and
real configured models. Inspect terminal captures, recorded model identities,
load receipts, tool failures and saved results. A synthetic provider, delivered
prompt or saved Quest does not prove worker completion. Parent owns dependency
and provider readiness. Repair concrete failures before retrying. Preserve
active sessions, uncertain ownership, dirty work, journals and existing Quests.

For automatic failure returns, check the actual tool evidence reaches the
originating giver and starts a response without another user message. Do not
rely only on the destination's final prose. Report source saved, PR merged,
release selected and process loaded as separate observed facts.
