# Project-router bounded integration follow-up

## Scope and capability receipt — 2026-09-08

Assignment: Quest `57ec514763d0e1ecec35c8bc29`, step `discovery-json`, in
the task-owned `quest-front-door-review` checkout. Read, patch and PowerShell
execution were available; `Get-Location` and workspace coordination confirmed the
assigned checkout and nine-file reservation. Actual session usage JSON recorded
provider `openai`, model `gpt-6-astra`, reasoning/variant `medium`, native harness.
The selected OpenAI account was fresh/available (shared window 76% remaining).

## Implementation

- Resolved source conflict markers in `models/dispatch-planner.ts`,
  `quest/continuation.ts`, `quest/tool-schema.mjs`, and `quest/typed-tool.ts`.
- Preserved burn controls, calibration/observed-route checks, parallel admission,
  cancellation, durable request deduplication, workflow tracking/task tags, and
  enriched change evidence. Retained exact selector errors, goal lifecycle and
  proof checks, physical source binding, current worker assignment restrictions,
  and compact bounded evidence inspection. Parallel reservation reconciliation
  uses the same explicit reservation-file pin as serial continuation.
- **Account correction incorporated:** all routes retain master's transport
  uniqueness requirement (`linked.length === 1` and matching account ID), with
  configured-model assertions. An exact policy selector does not establish
  native transport account binding. Multiple connections on one coalesced account
  pass; two eligible accounts or a missing selected account fail verification.
- `project-router/host.ts` omits absent/null root-session `parentID`, retains child
  IDs, and validates optional parent/cursor strings. `project-router/server.ts`
  omits absent project `hostID` for remembered and Quest-only roots while retaining
  real host IDs. No serialization-based global output suppression was added.
- Added raw JSON-boundary coverage in `test/project-router.test.ts`: recursive
  validation before stringify, strict storage fixture, root/child filtering,
  remembered/Quest/host roots, cursor and offset preservation, malformed parent
  rejection, and account-transport regression cases.
- README now states that default-deny agents require explicit router tool grants.

## Check receipts

Initial focused run: 54 pass / 1 fail. Its transport-account assertion exposed the
brief's incorrect relaxation; the parent corrected that interpretation and the guard
was restored. The final dispatch run below passes that original assertion.

```powershell
bun test ./test/project-router.test.ts ./test/quest-continuation.test.ts ./test/quest-parallel-continuation.test.ts ./test/project-router-goal.test.ts ./test/orchestration-dispatch.test.ts
```

52 pass / 0 fail, 337 assertions. This preceded the account-guard correction;
the affected router/dispatch coverage was rerun afterward below.

```powershell
bun test ./test/project-router.test.ts ./test/model-window-dispatch.test.ts ./test/configured-dispatch.test.ts ./test/calibrated-dispatch.test.ts ./test/dispatch-pins.test.ts ./test/astra-dispatch-policy.test.ts
```

**Final dispatch/router run: 33 pass / 0 fail, 321 assertions.** Includes the
unchanged `model-window-dispatch.test.ts` ambiguous-transport assertion.

```powershell
bun test ./test/quest-adaptive-tools.test.ts ./test/quest-worktree-binding.test.ts ./test/quest-runtime.test.ts ./test/shared-workspaces.test.ts ./test/usage-burn-control.test.ts
```

24 pass / 4 fail, 157 assertions. All adaptive learning, worktree-binding,
shared-workspace and burn-control cases passed. Unresolved failures in the
unowned `test/quest-runtime.test.ts`:

1. Line 19 expected a `.claude` worker checkout, received the fixture's `main`.
2. Line 27 expected `not bound`, received `Host did not bind the selected
   model/variant; no prompt was sent`.
3. Line 42 expected predecessor output absent from `main`, but found `expected`.
4. Line 54 expected `Target deadline reached`, received `An absolute host-derived
   directory is required`; that fixture passes a context without `directory`.

The first three results are consistent with fixtures using current shared-mode
settings while asserting isolated-worktree behavior. They need parent inspection
and explicit fixture settings; this is a diagnosis, not a verified repair. The
fourth needs the host-derived directory contract reviewed in the fixture. No
unowned test/runtime/settings files were edited.

Owned-file `git diff --check` passed and the four conflict source files contain
no merge markers. The intentional merge's Git index is left for the parent to
resolve/stage under exclusive checkout ownership.

## Handoff and rollout limits

Source implementation is ready for parent review, with the four runtime failures
still unresolved. Full `bun test`, `pwsh -NoProfile -File ./smoke-test.ps1`, actual
configured-host/model-facing acceptance remain parent gates. No TUI surface changed, so TUI capture gates do not apply. The new discovery test exercises registered tool executors with
isolated storage/ledger and host response fixtures; it is not a real model-facing
host acceptance capture.

The observed selected runtime reported host `0.0.0-beta-19242` and loaded module
`generations/gen-1788841880125/project-router/server.ts` relative to the config
root. It does not load this review-worktree edit. Parent coordinates agent grants,
promotion and fresh-session verification; existing sessions may retain an older
generation. No worker commit, activation, publication or session restart occurred.

Usage examples and goal pause/resume/tool recovery remain in
`project-router/README.md`. Verify project/session discovery from the actual giver
after promotion, inspect `project_route_status`, then select/route to the verified
destination. Restarted goals require explicit verified resume and a live event
trigger. Passing local tests alone does not establish loaded-runtime success.

## Parent integration verification, 2026-09-08

The parent resolved the four runtime fixture failures by pinning each fixture's worktree settings and supplying the trusted host directory. All six runtime tests passed (28 assertions). The combined source includes the guard follow-up from PR #16; that PR remains a separate merge/activation gate.

The actual current OpenCode2 host, with the real Quest Giver prompt and its candidate explicit router grants, passed 10/10 checks. This included discovery of real recent sessions, destination selection, bound Quest get/update/run, and goal command registration. Evidence: `.visual-e2e/project-router-1788910775467/report.json`. This is isolated candidate acceptance, not promotion of the default live giver.

Compact usage projection now retains the existing telemetry planning field. Its 22 tests passed (85 assertions). The combined smoke gate passed 103 tests with 638 assertions. The full suite initially returned 887 pass / 1 skip / 2 fail; after the projection fix it returned 888 pass / 1 skip / 1 fail. The remaining workspace-pool snapshot failure does not reproduce in the focused eight-test run or the 26-test snapshot/binding/pool interaction run. The fail-closed snapshot checks remain enforced; the parent is diagnosing the full-suite interaction before claiming the full gate passed.

The combined-source exact-Astra goal acceptance was rejected before a worker session launched by existing burn pacing, whose current desired concurrency was zero. Available quota and a configured exact route did not override admission. No policy, reservation or ownership record was manually changed. The acceptance harness now preserves usage evidence across a thrown admission error, requires an actual session ID before reporting a worker, and stops immediately for a terminal pre-launch failure. The bounded rerun recorded `prelaunch-failed` in about five seconds, without a worker or an unknown-launch retry. Evidence: `.visual-e2e/project-router-goal-1788911443714/report.json`. Autonomous two-turn completion on this combined revision remains unverified while that hold persists; earlier successful source receipts do not substitute for this check.

The selected OpenCode generation and existing sessions have not been replaced by this review branch. Source integration is local. Promotion requires the reviewed revision to be merged and the loaded boundary rechecked in a fresh session; no existing terminal/session was restarted.

Final full gate: `bun test --timeout 30000` passed 889 tests, skipped one opt-in stress test, failed zero, with 4,642 assertions across 125 files (229.65s). Evidence: `tmp/front-door-snapshot-diagnostic.log`. Snapshot protection now names the changed category (file list, content, HEAD, or worktree registration), with the same check order and fail-closed condition. The earlier intermittent workspace-pool failures remain unexplained; a passing run is not a claim that their cause was repaired. Focused snapshot mutation tests still passed for all five deliberate races. The account pacing hold and unmerged/unactivated runtime limitations above remain outstanding.
