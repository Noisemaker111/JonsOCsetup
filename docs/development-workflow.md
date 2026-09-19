# OpenCode2 development and stable releases

This repository's stable branch is `main`. `agents` is the integration branch.

The repository uses `agents` for integration and `main` for the published baseline. Legacy branch names in dated receipts are historical, not current targets.
These rules apply to OpenCode2 configuration and extensions, not other projects.

The agent owns the full change: inspect existing work and PRs, use an isolated
worktree, implement, exercise the intended operation in the installed host,
save coherent commits, open a ready PR targeting `agents`, merge it after checking
the result, and exercise it in OpenCode. Jon has authorized this
dev loop; do not ask him to perform a technical review or repeatedly approve it.
Stable promotion still requires Jon's explicit instruction.

Call development `agents` when reporting to Jon. Runtime channel keys are internal
implementation details, not another release stage for him to manage.

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
For OpenCode work, the shared memory is
`C:/Users/Jk101/Projects/JonsOCsetup/MEMORY.md`. Update it when the user makes a
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

Only when Jon requests a release, freeze a candidate branch at the verified agents
revision and open its PR against main. Generate patch notes from that exact
candidate's merged PRs and changes, attach them to the PR, and run release CI.
Later agents changes belong to a separate batch. Only Jon personally merges
main: agents never merge it, enable auto-merge, or push to it, including after
chat approval. After observing his merge, follow separately authorized stable
activation gates. Keep the previous stable artifact for rollback; changing code
does not roll back mutable data. Never propose releases during routine work.

## Branch controls and commands

Use the installed `sb` branch helper; use `sb agents` only in
a checkout you own. Stable is `main`, so use `sb main`, or `git switch main` followed by
`git pull --ff-only origin main`. Do not switch another session's checkout.

The agents branch replaces dev. The existing runtime channel is still called dev:
`oc`, `.channels/dev.json`, and its isolated state are runtime identities, not Git
branches. Keeping those identities preserves real sessions, Quests and queued work.
Activation validates the candidate against origin/agents. The branch choice and selected runtime are separate; inspect their recorded identities rather than inferring one from the other.

Eligible contributors have current GitHub write, maintain or admin permission;
bots additionally need recorded maintainer authorization. The authorized coordinator
reviews the current head and diff, verifies the affected user operation, and queues
`gh pr merge --auto --merge` so GitHub merges after the required `core` check passes.
No privileged CI executes PR code. This coordinator is the integration mechanism;
there is no unattended merge service. Stable releases are human-only.

Run `bun install --frozen-lockfile` once in the owned package directory, then
`bun run check:core` and `node --check scripts/runtime-channel.mjs`. The GitHub
workflow runs the core checks on PRs to agents and main. Before activation,
prepare the committed candidate with `bun run runtime:channel -- prepare dev
--ref <revision> --model <exact-route>`, drive the installed app twice, and use
`activate dev --candidate <root> --evidence <report>` with the real captures and
return evidence. Build commands do not activate or publish.

`runtime:drive` reads `commands.jsonl` as a queue and runs every line appended to
it, in order, so append a whole scenario at once -- paste, return, settle,
capture, stop -- and keep a separate append only for the point where the next
command genuinely depends on what the previous capture showed. Put
`{"action":"settle"}` between the input and the capture that should show its
result rather than polling the drive from outside: settle waits for the host to
stop printing and records `settled` true or false in `actions.jsonl`, while a
caller polling once a second pays a model turn, and a whole transcript re-read by
the approvals reviewer, for every second it waits. A drive that polls costs more
than the work it is checking.

Check for an existing repair PR on the same symptom before opening a second one,
and reuse it.

Merge with `gh pr merge <number> --auto --merge`. Branch protection on `agents`
requires the `core` check and no approving review, so GitHub holds the pull
request and merges it the moment the run goes green. Nothing polls a run, nothing
waits for a person, and a pull request opened against a red branch lands by
itself once the branch recovers. Repository settings must keep `allow_auto_merge`
on for the queue to exist; without it the same command merges immediately when
the checks already passed and fails outright when they have not. Some harnesses
additionally refuse a direct merge outright -- see their own instruction file.

The dev host database, Quests, UI state, orchestration and telemetry live under
`.channels/state/dev`; stable retains its original stores. Broker accounts and
external providers are shared existing integrations, so use throwaway data and
record actual provider usage. Plugin code is pinned in immutable generations;
TUI and server load receipts must match that revision. Record the installed host
binary separately. Old sessions keep their loaded generation and cannot consume
new-generation continuation work.

## What plain `oc` runs, and why it is not the gated release

The acceptance gate proves a release before it is promoted. It was also, accidentally,
the only way a merged fix reached the command Jon types: `oc` opened
`.channels/dev.json`, and that only moves when a gate pass succeeds -- 26 of 53
recorded runs. So `/new` could be fixed, merged and verified and still be absent from
his editor, with nothing on screen saying so. It happened on 2026-09-12.

So plain `oc` runs the latest merged `agents` commit, preparing or reusing a candidate
for it, and the gated release is one flag away: `oc --gated`. `oc --default gated`
makes that the default instead and `oc --default branch` puts it back; the setting
lives in `.channels/oc-default.json` and its absence means the branch, because
defaulting to the gated release is the state that hid the fix.

Two consequences are deliberate. The first launch after a merge pays one preparation,
and every launch after it reuses that candidate. And preparation sends one real prompt
to the configured model, so it can fail for reasons outside the repository -- when that
happens on a *defaulted* launch the launcher falls back to the gated release and says
so in red, because a working editor on older code beats an error message. A branch
asked for by name fails instead, since falling back would be running something other
than what was asked for.

A gated release also stops being silently stale: when it is behind `origin/agents` the
banner says by how many commits.

## Running any other branch

`oc <branch>` prepares a dev candidate from that branch and launches it. It does not
gate and does not activate: `.channels/dev.json` is untouched, so plain `oc` keeps its saved branch/gated preference, and `activate` keeps its two
acceptance runs and its origin/agents tree check. Preparation is the only cost -- a
worktree, one frozen lockfile restore, and one real prompt to the configured model --
and it is paid once per commit, because a second `oc <branch>` on the same commit
reuses the release it already prepared. `--fresh` forces a new one, `--model
<exact-route>` overrides the model the candidate inherits from the activated channel.
Any tag or commit works where a branch name does. Explicit Git revisions such as `HEAD`, `@` and `HEAD~1` retain Git meaning; they are never prefixed with `origin/`. `runtime:channel prepare` resolves them in the checkout containing its script, so an owned worktree prepares its own revision. Resolution does not fetch before evaluating these expressions, preserving `FETCH_HEAD` and local revision state.

A bare branch name resolves to `origin/<branch>` when that exists and to the local ref
otherwise, so a stale local branch cannot be built by accident, and the launch banner
names the branch, what it resolved to, the commit subject, the model and which commit
the gated release is still on. A candidate shares dev's isolated
sessions, Quests and telemetry under `.channels/state/dev`; it is different code, not
a different world.

A candidate records the ref it was built from, so retirement judges it against that
ref instead of origin/agents and can reclaim it once the branch moves on. While it is
still that ref's tip it is kept, because that is the preparation the next
`oc <branch>` reuses.

## Channel isolation

Dev has separate host sessions, UI preferences, Quests and telemetry. Existing
subscription broker accounts are reused; credentials are not copied into the dev
database. Native host logins are database-specific. The selected verified broker
model is the default for dev launch. Shared-checkout worker writes are rejected in
dev because its isolated ledger cannot authorize against stable ownership.
Use isolated worktrees for dev code work; this preserves stable checkout owners.

Activation requires the current merged agents tree and two real return-flow passes.
It installs the scoped workflow skill and creates `.channels/start.mjs`. Start with `oc`, which launches in the maintained JonsOCsetup source; `--here` uses
the current directory instead and `--cwd <project>` names one. Plain `oc` runs the
latest merged `agents` code, `oc --gated` the release that passed the acceptance gate,
`oc --default branch|gated` changes which one plain `oc` means, `oc --stable` is the
stable channel and `oc <branch>` runs any other branch. Install this
PATH command once with `node scripts/install-channel-shortcuts.mjs`; it also removes
the superseded `oca`, `ocm`, `ocd`, `ocs` and `ocb` names, including the `oca`/`ocm`
PowerShell functions, which would otherwise shadow it. Switching launch channels does not stop existing
terminals. Each terminal has a separate concrete launch configuration.

A launch and a retirement never interleave: both take `.channels/retirement.lock`,
which records the process that holds it. A launch reclaims that lock when the owning
process is gone, or when the hold passes fifteen minutes -- far past any real pass --
and says on stderr what it took and why, keeping the removed record in
`.channels/lock-reclaims`. A hold that is live and recent is never taken; retry
instead. Release-use leases under `.channels/release-users` are cleared by retirement
once their release root is gone.

The installed shortcuts prepare the selected configuration, then launch the native
host directly in the existing console. Configuration selection finishes before host launch.

`runtime-channel start` has the same property. It launches attached: the supervisor
runs in the shell's own node process and the host inherits that console, so the app
reads the real terminal size, sees every resize, uses the terminal's own `TERM`, and
paints to the screen directly. The supervisor never touches stdin, and the console
interrupt belongs to the host. Only `--json` keeps the relayed pty, where output
becomes transcript events and input arrives as JSON writes; that is the mode
`scripts/drive-opencode.ts` and the verification scripts drive. Both modes build the
same launch root, pin the same generation, set the same `OPENCODE_*` environment,
hold the same release lease and write the same load receipt.

### Editing source

Quests for OpenCode itself are rooted at the JonsOCsetup checkout, a Git
repository, so dispatch resolves their editing source natively and creates each
worker's owned worktree under it. `models/dispatch-policy.json` `sourceByProject`
stays empty: it only ever mapped the retired non-Git hub folder onto a checkout.
Dev verifies the loaded immutable release's source receipt, release identity and
Git revision before creating a worktree. A worker can update its Quest only from
its verified owned workspace.

Channel state remains under `~/.config/opencode/.channels` after source migration.
The installed `~/.config/opencode` folder is not a Git editing checkout. Maintain
OpenCode configuration, agents, skills and plugins in the JonsOCsetup source tree;
`setup/files/` captures the other installed settings named by its manifest rather
than mirroring that entire runtime folder. Use JonsOCsetup worktrees for changes.
Historical Git metadata is archived outside the installed folder; existing old
checkouts retain their Git pointers and history. Do not recreate `.git` in the
installed folder or treat runtime data as uncommitted source work.

For explicit candidate acceptance, set `OPENCODE_DEV_CANDIDATE` to a prepared dev
release and invoke `oc`; the native launcher records that release's load receipt.
This does not select a release for other launches. Clear the variable afterward.

Direct `quest run` workers retain the giver's original project, agent and model as
a return address. Once their saved run reaches a terminal state, a durable notice
starts a giver turn with only the Quest id, title and state, the finished step, a
one-line outcome and the existing get/inspect pointer. Complete step notes remain
on the Quest and are read only when the decision needs them. Accepted admissions
are not resent. Uncertain terminal notices retry with the same native message ID,
so an acknowledgment lost after admission cannot create a duplicate. Changed giver
bindings retain the pending notice.

Dev continuation queues and active worker-return coordination are scoped to the loaded
immutable generation. Terminal return notices can recover across generations without
adopting another generation's active workers. An older open dev session cannot claim
a newer generation's queued work.
Inspection retains all queue histories; a new admission refuses another generation's
active continuation until it is explicitly cancelled. Cancellation preserves already
launched workers and their evidence. No queue is silently migrated on reload.

## Native worker inspection

OpenCode2 discovers concrete operations in the `quests` MCP namespace through Code Mode.
Use `quests.get` with inspect.section runs, and project_route_status for route
diagnostics. The generated `quest` CLI and `quest mcp` stdio adapter call the same
plugin-owned service. The existing Codex ticket adapter remains separate host groundwork;
it is not registered inside OpenCode2. Worker status uses live
host events and permissions, clears live observations on disconnect, and keeps
missing or uncertain ownership intact. Historical ledgers are never liveness proof.

Session navigation uses the native `/sessions` picker (keyboard and mouse), including
its current-host status and project filtering. The old `/running` database scanner
and duplicate picker are removed. Provider quota comes from the usage/account
observers; orchestration never stamps another provider capped from event text.

Worker liveness is scoped to the connected host session client. Disconnecting or
reconciling one client cannot reuse or erase another client's observations. The
board Active filter requires a confirmed running observation, never a saved
executing record. Native data events trigger bounded worker inspection; periodic
reads recover missed events after reconnect. Unknown ownership remains retained.

Public Quest reads and the giver's work inventory take one bounded native activity
snapshot per operation, using the connected host events when the server plugin
does not expose the TUI's active-list API. `running`/`active` count only confirmed native executions;
`activity.unconfirmed` and `unconfirmedRuns` retain assignments whose execution
cannot be confirmed. `recordedState` and `recordedExecuting` expose the saved ledger
separately. A saved Working record without a confirmed execution displays Waiting
(or Needs attention for a blocked step), without releasing its worker or making its
step eligible for duplicate dispatch. Reopening the record repeats the observation.

The obsolete favorite/profile scheduler and capacity.json lane/task registry are removed.
Quest admission uses dispatch-planner and RouteReservations; native session controls
own manual selection. No provider substitution occurs during harness agent setup.

Workspace snapshots use a temporary Git index. Already-tracked paths remain included
even beneath ignored directories; ignored untracked files remain excluded. Snapshot
staging never changes the coordinator index, and source changes invalidate preparation.

Quest tool, board and goal admissions share quest/dispatch.ts: workflow measurement
and the persistent giver return are registered before the existing worker launcher
runs. The Quest tool owns reconciliation and return polling for all three paths;
goal-specific continuation and worker pause/resume retain their existing owner.


## Worktree retirement

Turn-in is the cleanup request. The Quest service reacts to archive writes,
worker execution endings, repository ref changes and host startup. There is no
cleanup timer. `quest get` with `inspect.section=cleanup` retries and reports each
retained reason. A resumed worker cannot edit a retired or archived assignment.
Reopen the Quest and create a new run to continue work.

Removal requires a guarded worker, confirmed idle host, terminal runs, no pending
continuation or editor reservation, a clean checkout and commits included in the
configured integration ref. Recorded workspace artifacts are copied to the Quest
asset store, checked by digest, and their saved links updated before disposable
copies are removed. Other untracked/ignored files are preserved. Branches, saved
Quest records and session history are never deleted. Squash merges without ancestry
proof stay retained for review.

This repository uses `git config quest.integrationRef refs/remotes/origin/agents`.
Other repositories use their explicit setting or their selected checkout's upstream;
the main checkout's HEAD is not an integration target.

After merging and verifying a development task, leave its checkout and run the
selected release's `worktree:cleanup finish --repo <main checkout> --worktree
<finished checkout>`. The command asserts that the owner and its child processes
have finished. It records the exact head and retries immediately. Activation and
direct session exit retry pending tasks; `worktree:cleanup retry --repo <main
checkout>` is the manual retry. Keep durable evidence in the main JonsOCsetup
checkout under `.evidence/<task>/` before finish.
Unknown ignored files, nested worktrees, changes and unintegrated commits block
removal with a saved reason. Never infer completion from file age.

### Local work and evidence locations

Use the main JonsOCsetup checkout as the common root for development:

- `.worktrees/<task>/` contains owned implementation checkouts.
- Each checkout's `run/` contains disposable build output and scratch files.
- The main checkout's `.evidence/<task>/` contains durable verification captures,
  logs, task-specific verification drivers and acceptance reports. Save these here
  from the start so checkout retirement does not remove the evidence.

Reusable verification tools belong in tracked `scripts/`; generated output belongs
in `.evidence/<task>/`. Evidence is ignored by Git because captures and transcripts
can contain local session data. Use canonical paths in saved Quest deliverables.

The former `C:/Users/Jk101/dev-workflow-evidence` directory contains compatibility
links to `.evidence`. Historical reports and archived Git worktree references
retain their existing paths. Windows currently holds the historical
`quest-review-reliability` folder open, so its canonical `.evidence` entry links
back to its preserved original location. Do not stop a process or alter ownership
to relocate an archive. New work uses the canonical location; do not create another
home-level evidence root. The installed `.config/opencode` directory remains the
runtime destination.

New dev releases record process lifetime leases. Activation and launch exit can
retire unselected, integrated releases only after every recorded process acknowledges
exit. The selected release and immediate rollback release remain pinned. Run captures
are retained outside the release under the channel registry before removal. Old
releases without lifetime records and crashed/unacknowledged launches remain intact
for explicit ownership review. Stable releases are never retired by this mechanism.

Quest coordination locks publish an immutable owner file with an exclusive hard link. A process failure before publication leaves only an unused staging file; a failure afterward leaves a complete owner that can be checked for liveness. Heartbeats update the file timestamp without truncating its ownership data. Existing directory locks are still recognized. An empty or unreadable legacy lock stays blocked because it does not identify a process whose death can be established; do not erase it as a recovery shortcut.

## Keys the PTY drive cannot reproduce

`runtime:drive` renders the host into an embedded terminal that answers the kitty keyboard query, so
its `key` action always arrives modifier-tagged and a check built on it cannot tell a working
composer key binding from a missing one. `raw {hex}` writes the bytes a protocol-less terminal sends,
which covers the decoding, but a keymap layer can still be registered against the wrong prompt or be
outranked by a layer that mounts later, and neither is visible from bytes alone. Both of those
shipped as "verified" fixes that did nothing for Jon.

Three tracked tools press the real keys instead:

- `scripts/record-terminal-keys.ts` records what a terminal actually sends and what the host's own
  decoder makes of it. Run it in a real window; it also reports whether the terminal answers the
  kitty keyboard query.
- `scripts/run-host-window.ps1` runs a prepared candidate host in its own new Windows Terminal
  window, with the host's state redirected into the output directory, and prints the window handle.
- `scripts/press-keys.ps1` takes that handle and a JSON-lines scenario, injects each press at the
  Win32 input layer so the terminal's own encoder produces the bytes, and photographs the window
  after each step.

Address the window by **handle**, never by title: once the host starts, its window is titled
"OpenCode", which is also what Jon's own live window is called. `press-keys.ps1` refuses to send
unless the foreground window is the handle it was given, which is what keeps these keystrokes out of
his session.
