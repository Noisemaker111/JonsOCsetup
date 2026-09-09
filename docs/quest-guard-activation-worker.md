# Codex ownership recovery follow-up — 2026-09-08

## Capability and ownership evidence

- Actual `usage_status` JSON at 21:54 UTC recorded provider `openai`, model
  `gpt-6-astra`, variant/reasoning `medium`, harness `native`; account available.
- Native read and shell succeeded; exposed native patch was used successfully.
- Physical selected checkout: `.worktrees/quest-guard-activation`, branch
  `fix/quest-guard-activation`, starting HEAD
  `5281383a0dc198d7bdb2bad466f75cee870ae49a`.
- Shared reservation covers only the six assigned paths. Initial status had
  unrelated untracked `tmp/` artifacts and no staged changes. No dependency
  installation or Git index/branch operation was performed in this checkout.

## Implementation

`quest/codex/recovery-workspace.ts` now records source and environment preparation
in the deterministic session binding receipt. Clean source uses the selected
checkout commit. Routine tracked dirty source uses an immutable tree captured
with a temporary index and two-pass consistency checks. This adapts the safe
capture mechanism in `QuestWorkspaces.applySnapshot`, without its broad untracked
capture or configured bootstrap execution. Capture enumerates tracked index/tree
modes and hashes raw regular bytes; it never invokes a source worktree diff.
Raw `hash-object --no-filters` avoids repository clean filters. Recovery Git calls
disable configured filters, fsmonitor and hooks, including materialization and
snapshot application. Snapshot application affects only the isolated tree;
the owner's index, branch, work files and reservation remain intact. Subsequent
recovery reuses the immutable snapshot and retains task edits.

Unmerged input, ambiguous untracked input, sensitive tracked paths, and tracked
paths resolving outside the source checkout have precise retained blockers.
No untracked source bytes are copied. `RecoveryOptions.sourceCommit` is an
internal adapter/fixture option, not a product recovery operation. Existing
committed-only isolation fixtures supply that choice explicitly; production
diagnostics instead name Read/Glob/Grep (which remain available), an authorized
tracked/sanitized handoff from the current owner, and retrying the original tool.
Separate tests exercise default automatic dirty tracked capture.

Read-only native Read/Glob/Grep and a bounded shell grammar bypass exclusive
ownership. The grammar accepts the existing literal absolute Get-Content forms
and `Get-Location`. Raw Git commands are deliberately not exempt: even apparently
read-only Git invocations can execute repository-configured helpers.
Expressions, redirection, pipelines, Git commands and chained writes
still take the protected execution path. After recovery, task file/search reads
map to task contents, absolute source file reads are rebound, and implicit-cwd
audits use the isolated command runner. External skills and web reads remain
independent. Hook context visibly reports the binding/preparation result.

Cached patch replay continues to revalidate every path header and current
worktree identity. The command runner also validates binding identity immediately
before execution. Existing terminal-evidence reconciliation remains in place;
a new regression proves completed tool evidence alone cannot release a session
that has not ended, even after a long elapsed interval.

`quest/codex/recovery-command.ts` now prepares supported dependency environments
automatically before executing a pending shell command. The fixed recipe is Bun
`install --frozen-lockfile --ignore-scripts --backend=copyfile --linker=hoisted
--no-progress`, with an empty explicit Bun config and loopback-only registry
override. It runs through the existing `command/exec` sandbox with
`networkAccess:false`, a 90-second command timeout and only the task workspace
writable. It can use already readable default-registry cache packages; no global
cache write permission or owner node_modules grant is added. Registry cache misses
fail rather than requesting network authorization implicitly.

Preparation accepts a tracked text `bun.lock`, a Bun/unspecified package manager,
single root package, and integrity-locked default-registry packages. Unsupported
workspace/local/Git/custom-registry inputs retain a precise blocker. Manifest and
lockfile hashes bind an `environment-<hash>.json` receipt beside command tickets;
states are started, ready or blocked. Ready receipts are reused, while failed or
unknown attempts do not automatically replay. Preparation must finish before the
original command runs. Read-only command tickets explicitly skip preparation.

## Checks and outcomes

Focused command, with the parent's process-local Git mingw64/bin PATH prefix:

```powershell
bun test ./test/quest-codex-recovery.test.ts ./test/codex-quest.test.ts
git diff --check
```

- Initial read/preparation change: 31 tests, 157 assertions passed.
- Automatic tracked snapshot implementation: 33 tests, 171 assertions passed.
- Added source-junction and live-session regressions: 35 tests, 176 assertions
  passed, zero failures, 33.61 seconds. Includes the packaged PreToolUse regression.
- Review correction run: 35 passed / 1 failed, 183 assertions. The dependency
  regression incorrectly compared the whole coordination document after allowing
  a new task reservation. Corrected it to compare the original owner's record;
  the diff showed the owner intact and only the expected task participant added.
- Final focused run: **38 passed, zero failed, 202 assertions, 47.21 seconds**.
  Includes filter/fsmonitor sentinels, operation-scoped readiness, immutable input
  binding and bounded preparation receipts. Preparation receipt tests inject the
  command executor; they do not claim actual installed-host cache acceptance.
- `bun install --help` confirmed installed Bun 1.3.14 supports frozen lockfiles,
  ignore-scripts, copyfile backend, explicit config and registry flags. A bounded
  Bun capability check confirmed `Bun.JSONC.parse` is available.
- `git diff --check` passed.
- Full Bun suite, smoke test, actual installed-host/model acceptance, packaging
  and activation are parent-owned gates. These focused results do not replace them.

## Concrete remaining limits and rollout

- Read/patch readiness is separate from dependency execution readiness. Package
  reads and patches recover normally; the preparation receipt explicitly says
  the dependency environment needs preparation. Supported Bun shell tickets now
  run the fixed recipe above. The existing general workspace helper can execute
  arbitrary configured bootstrap argv and copy untracked inputs, so it is not
  invoked wholesale. Actual Windows sandbox access to Bun's existing cache remains
  a parent-owned acceptance check. No lifecycle scripts were run and no shared
  node_modules write grant was added. Dependency-free fixtures are ready.
- Untracked task inputs require an authorized tracked handoff from their owner.
  Sensitive tracked edits require a sanitized task source. Neither is silently
  omitted. A racing source or unknown interrupted application is retained for
  inspection rather than replayed automatically.
- Parent reports installed Codex 0.153.4 candidate audit clears the hook and reads
  the owner fixture; actual external `.agents` skill reads still encounter a
  separate Windows sandbox denial. This worker did not reproduce or fix that
  host permission boundary; parent owns the actual probes.
- Source changes are local only. This checkout's `plugin-activation.json` selects
  `gen-1788601017854` with recorded source commit
  `89a6a2634d086c6553d8b61b58ce076fea7eaf02`. That file is not evidence of the
  generation loaded in any existing terminal. Loaded-runtime adoption is unverified.
- No local commit: the assignment has partial checkout ownership, so staging and
  committing require the parent's exclusive integration window. Parent should
  review only these six owned files and preserve unrelated work.
- Assigned step remains blocked pending parent actual-host/cache acceptance.
  No completion claim, activation, publication,
  terminal restart, worker spawn or Quest creation was made.

Reward/evidence delivered: automatic safe tracked-input recovery, context-correct
reads, durable preparation diagnostics, preserved owner state and focused
regression evidence for parent integration.

## Bounded private-cache correction — 2026-09-08 22:22 UTC onward

This follow-up supersedes the shared-cache blocker above. Ownership was restricted
to `quest/codex/recovery-command.ts`, its preparation tests in
`test/quest-codex-recovery.test.ts`, and this document. Prior changes in other files
are parent-owned. Actual usage JSON recorded `openai/gpt-6-astra#medium` (native),
with the account/model available. Read, PowerShell execution and patch all worked;
the selected source checkout and starting HEAD matched the assignment.

### Implementation and bounds

- Provision a fresh `.quest-preparation-*/cache` inside the recovered workspace
  before the single sandboxed install. Read only exact lock-selected registry
  slots from `BUN_INSTALL_CACHE_DIR`, or `$BUN_INSTALL/install/cache`, defaulting
  to `~/.bun/install/cache`. No shared-cache enumeration or writes.
- Supported layout: `name@version@@@1` and
  `@scope/name@version@@@1`. Validate safe package/version syntax, canonical
  SHA-256/384/512 SRI encoding and length, and cached `package.json` name/version.
  Missing/other layouts fail with an actionable cache/handoff diagnostic.
- Reject symlinks/junctions throughout source ancestors and package trees,
  nonregular files, sensitive filenames, changed files during reads, and bounds
  exceeding 256 packages, 10,000 entries, depth 32, 32 MiB/file, 128 MiB total,
  or 30 seconds provisioning. Copy bytes into exclusive new files; create no
  hardlinks. Partial cache location is retained in the blocked receipt.
- Fixed install adds `--cache-dir` to the private directory and retains frozen
  lockfile, ignored scripts, copyfile backend, explicit empty config, loopback
  registry, and the existing installed Codex `networkAccess:false` boundary.
- Ready receipts reuse the private cache without accessing the original cache;
  replaced private-cache roots are rejected. Started/blocked attempts remain
  non-replayable. Installer stdout/stderr are retained separately (4,096 chars
  each), with credential-shaped URL/auth/token/password values redacted. EPERM
  remains visible rather than becoming a generic missing-cache error.

The extracted cache is trusted installed package input: SRI validates the lock
entry, but an extracted directory cannot independently reconstruct and verify
the original registry tarball digest. This does not download or authenticate new
package bytes. Unsupported/sensitive layouts require owner handoff. Scoped layout
was exercised with an isolated fixture; actual host acceptance used picocolors.

### Verification receipts

```powershell
$env:PATH = 'C:/Program Files/Git/mingw64/bin;' + $env:PATH
bun test ./test/quest-codex-recovery.test.ts ./test/codex-quest.test.ts
bun test ./test/quest-codex-recovery.test.ts --test-name-pattern 'preparation'
bun ./scripts/verify-codex-preparation.ts
git diff --check -- quest/codex/recovery-command.ts test/quest-codex-recovery.test.ts
```

- Initial correction: **40 pass / 0 fail, 257 assertions**, 73.89 seconds.
- After tighter SRI, deadline and receipt checks: **6 pass / 0 fail, 99 assertions,
  23 filtered out**, 34.27 seconds. Includes exact/scoped copies, unrelated cache
  preservation, independent copied files, ready reuse without source cache,
  replaced-cache junction rejection, missing/mismatched packages, package/source
  junctions, sensitive files, byte/file/depth/package limits, malformed lock
  identities/SRI, retained EPERM, bounded redaction and non-replay.
- Actual parent-owned `scripts/verify-codex-preparation.ts` ran twice successfully,
  including after the final source correction. Final receipt:
  `.visual-e2e/ownership-preparation/report.json`, `ok:true`, preparation state
  `ready`, `picocolors@1.1.1`, 8 entries / 6,925 budgeted bytes, installer exit 0,
  dependent command exit 0 and stdout `PREPARED_OK`, lifecycle sentinel absent.
  The script used the installed Codex `command/exec` network-disabled sandbox.
- Focused `git diff --check`: exit 0. Test preload reported its existing scratch
  sweep; this worker issued no separate cleanup commands.

### Handoff and rollout

The bounded correction and actual cache acceptance are complete in source. Parent
retains final full `bun test`, smoke, integration and activation gates, and the
broader step stays blocked pending that acceptance. No parent script was edited.
No dependency installation, staging, branch operation or commit was performed in
the shared checkout; the acceptance script installed only its isolated fixture.
The parent can commit the reviewed correction in its exclusive integration window.

These checks import current checkout source; they do not verify that a selected
or already-loaded OpenCode generation contains this correction. The earlier
selected-generation observation above is historical, and no promotion or terminal
restart occurred. Reward: automatic private-cache preparation now succeeds at the
actual installed-host boundary, with bounded failure evidence and owner-preserving
focused regressions ready for parent integration.
