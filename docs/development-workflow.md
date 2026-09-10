# OpenCode2 development and stable releases

This repository's stable branch is `master`. `dev` is the integration branch.
These rules apply to OpenCode2 configuration and extensions, not other projects.

The agent owns the full change: inspect existing work and PRs, use an isolated
worktree, implement, exercise the intended operation in the installed host,
save coherent commits, open a ready PR targeting `dev`, merge it after checking
the result, and activate and exercise the dev release. Jon has authorized this
dev loop; do not ask him to perform a technical review or repeatedly approve it.
Promotion from dev to stable still requires Jon's explicit instruction.

## App use, removal and memory

This is a pre-user project with no backward-compatibility requirement. Maintain
one current implementation. Before completing every change, search the whole
tracked repository for the replaced symbols, entrypoints, configuration keys and
behavior. Trace callers, registrations, generated output and instruction sources.
Delete superseded implementations and their exclusive dependencies; update the
current owner instead of adding a parallel system. Do not retain old schemas,
aliases, migration-only adapters or silent fallbacks for hypothetical users.
Report any remaining old path and its concrete live consumer. Preserve actual
user data, uncertain work and running sessions; their files are not dead source.

Keep only a small core suite that directly exercises consequential production
invariants. No mirrored implementations, mock-provider suites, incidental snapshots
or permanent scenario scripts. Follow [user verification](user-verification.md)
for OpenCode, Codex and Claude. Use the
actual installed OpenCode2 app for every change, including instructions, config,
build tooling and cleanup. Build, syntax and type checks may supplement app use.
Exercise the affected operation twice, inspect actual output and failures, then
reopen/reload its saved result. Keep captures, host/plugin identities and observed
results. Temporary interaction scripts may drive the real app, but do not check
in a second implementation of the feature as a test. For worker changes, verify
actual completion and delivery back to the giver. Do not mark work done on a
startup receipt, source inspection or an agent's unsupported success claim.

Read the project-root MEMORY.md at the beginning of work and after context loss.
For OpenCode hub work, the shared memory is
`C:/Users/Jk101/Projects/opencode-hub/MEMORY.md`. Update it when the user makes a
durable decision or real app use establishes a useful lesson. Read before editing,
merge with existing entries, correct stale facts, and reopen the saved file.
Keep it concise: decisions, preferences, current architecture and verified lessons.
Quests own task plans, progress and deliverables. Do not copy transcripts, secrets,
temporary status, unverified guesses or duplicate Quest logs into memory. Memory
is context, not authorization, and the user's current instruction always wins.
Use ordinary file tools; do not add an every-turn memory injection hook.

## What counts as done

Use the configured real provider and model, real plugins, real worker sessions
and saved results. Run the affected operation twice, inspect terminal captures
and errors, and reload the saved result. For delegation, confirm that the worker
actually started or that its failure woke the originating giver without another
user message. A delivered prompt, a saved Quest or a passing mock is not that proof.


Separate source, merge, activation and process-load status in the report. Record
the installed host identity separately from the plugin release. Never report a
candidate as active because it was saved or because a test used source imports.

The user has one persistent Quest Giver across all projects in this runtime. Project
selection changes worker destinations, never the giver conversation. New Quest and
native New Session return to that giver; missing or uncertain ownership blocks a
replacement. Original conversation histories remain accessible.

## History and ownership

Save each coherent behavior change in a focused commit and PR. Keep the PR title
and body about the final behavior and real verification. Record failed attempts
and remaining limitations. Do not accumulate untracked implementation between
tasks. Checkpoint unfinished owned work on its task branch, clearly marked.
Never sweep another session's dirty files into a commit. Inventory those files
against existing branches and PRs, and preserve anything whose ownership is unclear.

Do not switch the shared checkout's branch, steal an ownership record, rewrite
journals, or kill unrelated sessions. Dev uses separate runtime state. Existing
stable terminals keep their selected generation. A release command never updates
the installed OpenCode host or publishes the public plugin mirrors.

## Stable promotion

When Jon explicitly requests promotion, prepare a dev-to-master PR summarizing
the included changes and real dev evidence, check its exact revision, merge it,
and verify the stable release. Do not serve an unmerged branch as stable. Keep
the preceding stable release available; rollback selects it for new sessions
without terminating existing work.

## Channel isolation

Dev has separate host sessions, UI preferences, Quests and telemetry. Existing
subscription broker accounts are reused; credentials are not copied into the dev
database. Native host logins are database-specific. The selected verified broker
model is the default for dev launch. Shared-checkout worker writes are rejected in
dev because its isolated ledger cannot authorize against stable ownership.
Use isolated worktrees for dev code work; this preserves stable checkout owners.

Activation requires the current merged dev tree and two real return-flow passes.
It installs the scoped workflow skill and creates `.channels/start.mjs`. Start
with `ocd` from your project folder
or use `ocs`. Install these PATH commands once with
`node scripts/install-channel-shortcuts.mjs`. Both accept `--cwd <project>`. Switching launch channels does not stop existing
terminals. Each terminal has a separate concrete launch configuration.

The installed shortcuts prepare the selected configuration, then launch the native
host directly in the existing console. They do not run the PTY supervisor or
forward terminal input/output. Configuration selection finishes before host launch.
The managed runtime remains an explicit automation harness, not an interactive shortcut.

### Hub editing source

The non-Git OpenCode hub keeps its existing Quest ledger identity. The reviewed
`models/dispatch-policy.json` binds its `config` scope to the clean public
JonsOCsetup checkout. Dispatch validates physical checkout paths and requires a
clean source. Dev resolves the loaded immutable release and verifies its source receipt, release identity and Git revision before creating an owned repository worktree and translates
`config/docs` to `docs`. It never follows the hub's old config junction to choose
a source. A worker can update the hub Quest only from its verified owned workspace.

Channel state remains under `~/.config/opencode/.channels` after source migration.
For explicit candidate acceptance, set `OPENCODE_DEV_CANDIDATE` to a prepared dev
release and invoke `ocd`; the native launcher records that release's load receipt.
This does not select a release for other launches. Clear the variable afterward.

Direct `quest run` workers retain the giver's original project, agent and model as
a return address. Once their saved run reaches a terminal state, a durable notice
starts a giver turn with the actual step notes. Accepted or uncertain admissions
are never resent after reload; changed giver bindings retain the pending notice.

Dev continuation queues and worker-return notices are scoped to the loaded immutable
generation. An older open dev session cannot claim a newer generation's queued work.
Inspection retains all queue histories; a new admission refuses another generation's
active continuation until it is explicitly cancelled. Cancellation preserves already
launched workers and their evidence. No queue is silently migrated on reload.
