# OpenCode2 development and stable releases

This repository's stable branch is `master`. `dev` is the integration branch.
These rules apply to OpenCode2 configuration and extensions, not other projects.

The agent owns the full change: inspect existing work and PRs, use an isolated
worktree, implement, exercise the intended operation in the installed host,
save coherent commits, open a ready PR targeting `dev`, merge it after checking
the result, and activate and exercise the dev release. Jon has authorized this
dev loop; do not ask him to perform a technical review or repeatedly approve it.
Promotion from dev to stable still requires Jon's explicit instruction.

## What counts as done

Use the configured real provider and model, real plugins, real worker sessions
and saved results. Run the affected operation twice, inspect terminal captures
and errors, and reload the saved result. For delegation, confirm that the worker
actually started or that its failure woke the originating giver without another
user message. A delivered prompt, a saved Quest or a passing mock is not that proof.
Focused deterministic checks supplement this evidence when they cover a concrete
regression. Do not add suites that merely restate implementation details.

Separate source, merge, activation and process-load status in the report. Record
the installed host identity separately from the plugin release. Never report a
candidate as active because it was saved or because a test used source imports.

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
clean source, then creates an owned repository worktree and translates
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
