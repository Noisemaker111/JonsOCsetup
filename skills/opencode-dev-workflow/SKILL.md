---
name: opencode-dev-workflow
description: Own OpenCode2 configuration and plugin changes through isolated worktrees, real-use verification, tracked PRs, automatic agents merges, and separate stable promotion on this machine.
---

# OpenCode2 dev workflow

Jon authorized this workflow on 2026-09-09 for his OpenCode2 setup. It does not
authorize releases or merges in unrelated projects.

The repository is `C:/Users/Jk101/.config/opencode`. Work in an owned worktree.
`agents` is the integration branch; `master` is stable. Reuse existing repair PRs.
Own implementation, coherent commits, a ready PR targeting agents, review using
actual operation and captured states, merge into agents, and dev activation. Do
not ask Jon to perform technical review or repeatedly approve those dev steps.
Only Jon personally merges master, after he requests release preparation. Agents never merge stable or enable its auto-merge. Host updates and public publishing remain separate explicit actions.

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

For JonsOCsetup changes, follow `docs/development-workflow.md`: use the actual
installed app for every change, retain concise core tests of production logic, remove obsolete compatibility
paths, and search for and remove superseded code and instructions before finishing.
Read the project-root MEMORY.md at the start and after context loss; maintain
concise durable decisions and verified lessons there using ordinary file tools.
For hub work, use C:/Users/Jk101/Projects/opencode-hub/MEMORY.md. Quests own task
progress. These project-specific verification rules do not govern other projects.
