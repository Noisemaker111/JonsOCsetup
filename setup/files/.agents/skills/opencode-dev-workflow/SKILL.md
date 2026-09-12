---
name: opencode-dev-workflow
description: Own OpenCode2 configuration and plugin changes through isolated worktrees, real-use verification, tracked PRs, automatic agents merges, and separate stable promotion on this machine.
---

# OpenCode2 agents workflow

Jon authorized this workflow on 2026-09-09 for his OpenCode2 setup. It does not
authorize releases or merges in unrelated projects.

The repository is `C:/Users/Jk101/.config/opencode`. Work in an owned worktree.
`agents` is the integration branch. The repository development workflow owns the stable branch and promotion rules. Reuse existing repair PRs.
Own implementation, coherent commits, a ready PR targeting agents, review using
actual operation and captured states, merge into agents, and exercise the result in OpenCode. Do
not ask Jon to perform technical review or repeatedly approve those agents steps.
Only Jon personally merges the stable branch, after he requests release preparation. Agents never merge stable or enable its auto-merge. Host updates and public publishing remain separate explicit actions.

Read `docs/development-workflow.md` from the selected local runtime: find its `root`
in `C:/Users/Jk101/.config/opencode/.channels/dev.json`. If no local runtime is
selected, read the document from the current worktree. Use `runtime:channel`
commands there for preparation, status, activation and dev/stable launch.

When reporting to Jon, call development `agents`. Say "merged into agents and tested in OpenCode". Never say "release" at all -- not "dev release", not "verified build", not "release off the new agents head" -- and never mention the stable or main branch. Jon raises promotion himself when he wants it, and he will do it himself; an agent bringing it up is always wrong, whether as a stage, an offer or an aside. Channel keys, generations and command arguments are internal implementation details that stay out of what you say to him.

Exercise the actual intended operation twice through installed OpenCode2 and
real configured models. Inspect terminal captures, recorded model identities,
load receipts, tool failures and saved results. A synthetic provider, delivered
prompt or saved Quest does not prove worker completion. Parent owns dependency
and provider readiness. Repair concrete failures before retrying. Preserve
active sessions, uncertain ownership, dirty work, journals and existing Quests.

`runtime:drive` reads `commands.jsonl` as a queue and executes every unseen line
in order, so append a whole scenario in one call -- paste, return, settle,
capture, stop -- instead of one line per turn. Use `{"action":"settle"}` to wait
for the host to go quiet rather than polling the cell; a drive that ends up
polling once a second is costing more than the work it is checking. Reserve a
separate append for the point where the next command genuinely depends on what
the previous capture showed.

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


After merging into agents and verifying in OpenCode, leave the owned task checkout, preserve its
review evidence outside it, then use the selected release's `worktree:cleanup
finish --repo <main checkout> --worktree <finished checkout>`. This declares the
owner and child processes finished. Inspect the result; retained reasons are not
successful deletion. Never finish another session's checkout. See the development
workflow's Worktree retirement section for the event-driven retry and retention rules.
