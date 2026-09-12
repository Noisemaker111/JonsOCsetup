> Historical evidence: scenario scripts named below have been removed. They are not current verification instructions. Use [the actual product](user-verification.md) and the small production-logic core suite.

# Project-router implementation receipt — 2026-09-08

Quest `57ec514763d0e1ecec35c8bc29`; implementation worker, assigned isolated checkout.
**Uncommitted source candidate. No promotion, publishing, existing-session restart,
or additional worker launch was performed.** Parent owns integration and final gates.

## Capability and scope

- Exposed patch and PowerShell shell were checked before implementation.
- Read absolute hub AGENTS.md, checkout AGENTS.md, moved
  `.agents/skills/opencode/SKILL.md`, ownership/instruction documentation and brief.
- Actual `usage_status(format:"json")` recorded `openai/gpt-6-astra`, medium/native.
  Initial fresh shared allowance observation was 52%; this was not a budget promise.
- The initial index contained other sessions' staged work. It was preserved; no
  staging, commit, reset or worktree cleanup was performed.

## Attributable source

- Owned plugin files: `project-router/plugin.json`, `project-router/server.ts`,
  `project-router/host.ts`, `project-router/resolution.ts`, `project-router/remote.ts`,
  `project-router/memory.ts`, `project-router/onboarding.ts`, `project-router/routing.ts`,
  `project-router/README.md`.
- `plugin-set.json`: new owner/manifest/entrypoint and curated Quest public facades.
- `quest/router-public.ts`, `quest/goal-public.ts`, `quest/route-public.ts`:
  canonical identity/assignment/claims, goal controls/verification and exact route feedback.
- `quest/continuation.ts`, `quest/goal-lifecycle.ts`, `quest/tracker.ts`:
  explicit giver/worker intents, bounded live same-session continuation, proof checks,
  restart pause, scoped pause/cancel and deferred terminal ownership.
- `quest/typed-tool.ts`, `quest/tool-schema.mjs`, `quest/tool-projection.ts`:
  current/latest assignment enforcement and compact defaults with paginated evidence.
- `quest/project.ts`, `quest/runtime.ts`: bounded Git identity reads and actual
  configured-command passing proofs.
- `models/dispatch-planner.ts`: shared exact selector resolution, including
  executable `route:<id>` account/service selectors, and the absolute
  `OPENCODE_ROUTE_RESERVATIONS` host pin used by isolated acceptance to preserve
  shared atomic account admission. Runtime, continuation, tracker and goal readers
  use the same pin. No policy data or concurrency thresholds changed.
- `orchestration/orchestration-ledger.ts`, `orchestration/orchestration.ts`:
  short lock waits, truthful lock diagnostics, atomic durable pending lineage,
  bounded contention drain, yielded/deferred startup replay and dead-owner-only recovery.
- `usage/server.ts`, `usage/tool-projection.ts`: compact model-facing telemetry defaults.
- `scripts/plugin-package.ts`, `test/plugin-package.test.ts`: new-owner packaging gate.
- Tests: `test/project-router.test.ts`, `test/project-router-goal.test.ts`.
  Harnesses: `scripts/verify-project-router.ts`,
  `scripts/verify-project-router-ledger.ts`, `scripts/verify-project-router-goal.ts`.
  Test-only settings: `tmp/project-router-test-settings.json`.

## Observed checks

1. `opencode2 api --standalone GET /api/project`: exit 0, actual installed root array
   of 48 project records. Only on-demand discovery was used.
2. Initial focused resolver/onboarding/routing/lock/continuation check: **16 pass,
   82 assertions**. Expanded memory/goal/package check: **26 pass, 148 assertions**.
3. Latest broad focused command at this receipt:

   ```powershell
   bun test ./test/project-router.test.ts ./test/project-router-goal.test.ts ./test/quest-continuation.test.ts ./test/quest-api.test.ts ./test/quest-runtime.test.ts ./test/configured-dispatch.test.ts ./test/plugin-package.test.ts
   ```

   **49 pass, 0 fail, 302 assertions**, exit 0 (66.41 seconds).
   Coverage includes real isolated local Git materialization/collision/failure/cancel,
   four concurrent journal writers, unknown/live locks, two router instances,
   persistent aliases/metadata, correction revisions, follow-up session reuse,
   exact-account holds, bounded goal epochs, actual proof requirements and old regressions.
4. `bun test ./test/orchestration-ledger.test.ts -t "concurrent writers"`:
   **1 pass, 2 assertions**, all 120 events retained in the canonical journal.
5. Broader ownership/orchestration check initially had **54 pass, 4 fail**:
   two untouched tests referenced deleted `skills/opencode` and `skills/review`;
   the old package-count assertion expected five owners (fixed for the sixth owner);
   the raw-journal concurrent-writer assertion exposed pending drain timing (fixed,
   dedicated rerun passed). Deleted skills were not restored.
6. `bun scripts/verify-project-router-ledger.ts`: read-only **82 Quests**, no unreadable
   records; full views **391,592 bytes**, default 25-item projection **6,837 bytes**,
   largest default detail **3,509 bytes**. This is the actual projection over the
   existing ledger, not a source-generation transport claim. Complete evidence is paginated.
7. `bun scripts/verify-project-router.ts`: installed beta-19192, no-cost deterministic
   provider, actual Code Mode tools, separate Git destination, actual hub mismatch,
   destination Quest get/update/configured-command run and observed response;
   isolated orchestration lock deliberately had no owner. **All eight checks passed**.
   Initial full receipt: `.visual-e2e/project-router-1788830668726/report.json`.
   **Final source rerun also passed all eight checks**:
   `.visual-e2e/project-router-1788832125555/report.json`.
   Earlier fixture failures were an invalid variant/permission config shape, a
   catalog-observation assertion, an invalid fixture Quest ID and a note assertion
   overwritten by the subsequent successful command. Corrected reruns are recorded;
   no failed run was counted as acceptance.
8. Targeted actual message discovery over the owned completed fixture session:
   installed union is assistant `content` parts and user `text`. After correcting the
   union validator, returned three bounded records including **DESTINATION_OK** and
   a next cursor. Initial strict-content-only validator failed truthfully.
9. `bun build ./project-router/server.ts --target=bun --packages=external --outfile ./tmp/project-router-check.js`
   and parent goal-harness build passed. Initial un-externalized build hit an existing
   named JSON5 import; removing that now-unused planner import and using package-external
   distribution settings resolved it. `git diff --check` passed.
10. Parent-requested explicit test-environment rerun pinned
    `OPENCODE_QUEST_SETTINGS=./tmp/project-router-test-settings.json`,
    `OPENCODE_ORCHESTRATION_LEDGER=./tmp/project-router-test-orchestration.jsonl`,
    `OPENCODE_QUEST_ROOT=./tmp/project-router-test-ledger` (all absolute in the
    process), and cleared inherited `OPENCODE_ROUTE_RESERVATIONS`.
    The seven-file run had **49 pass/1 fail, 303 assertions**: the new shared-admission
    fixture lacked `request.explicitRouteID`, so configured-choice admission correctly
    rejected it. Adding the explicit fixture selector fixed the test without changing policy.
    Final focused rerun:

    ```powershell
    $env:OPENCODE_QUEST_SETTINGS = Join-Path $PWD 'tmp/project-router-test-settings.json'
    $env:OPENCODE_ORCHESTRATION_LEDGER = Join-Path $PWD 'tmp/project-router-test-orchestration.jsonl'
    $env:OPENCODE_QUEST_ROOT = Join-Path $PWD 'tmp/project-router-test-ledger'
    Remove-Item Env:OPENCODE_ROUTE_RESERVATIONS -ErrorAction SilentlyContinue
    bun test ./test/project-router.test.ts ./test/project-router-goal.test.ts ./test/quest-continuation.test.ts ./test/plugin-package.test.ts
    ```

    **30 pass, 0 fail, 226 assertions**, exit 0 (12.08 seconds). This includes
    two isolated Quest roots sharing one real atomic fixture reservation file,
    latest-assignment worker write denials, complete evidence pagination, and the
    corrected verification-contract snapshot tests.

## Assigned-step status and remaining gates

- **resolve-project:** source and focused/installed discovery checks implemented.
  The default parent uses an outer reserved attempt directory with clone in `repo/`;
  partial attempts are preserved, not overwritten. Full host onboarding UI is not claimed.
- **route-work:** actual host destination identity/model preservation, hub mismatch,
  callable Quest get/update/command-run and response observed. Follow-up reuse,
  correction/multi-target and unknown delivery have focused fixtures. Final edited
  source passed the final eight-check installed-host rerun above.
- **quest-goal:** canonical giver/assigned-worker implementation and focused tests
  exist. **Real exact-Astra worker goal lifecycle in shared and worktree modes is
  pending parent normal admission after this worker releases account concurrency.**
  On the parent's temporary instruction to run it, `bun scripts/verify-project-router-goal.ts`
  exited 1 at its **prelaunch active-hold gate**. Read-only inspection showed the
  sole active reservation was this implementation run `8a283bf43bc96aa0be5c7d5bf0`,
  route `openai-astra-medium`, started `2026-09-08T00:42:22.967Z`. No second worker
  was created and the hold was not edited/released. The parent then explicitly
  restored parent-only launch authorization.
  The harness now loads the usage plugin, checks actual coordinator catalog
  capabilities, calls `usage_status(format:"json", refresh:true)` and exact
  route discovery before normal Quest run, pins the original unchanged
  `OPENCODE_ACCESS_POLICY`, and pins **shared canonical atomic reservations**
  through `OPENCODE_ROUTE_RESERVATIONS` despite isolated Quest storage. It refuses
  runtimes lacking that supported pin and records the policy hash and reservation.
  The precheck alone is not relied upon for concurrency. Parent commands are
  `bun scripts/verify-project-router-goal.ts` and `--shared`, after this run settles.
  The latest harness is built, not live-executed. Permission/runtime integration
  and real worker pause/restart/resume remain unverified gates.
- **tool-recovery:** compact projections, assignment scope and nonblocking malformed-lock
  fixture verified. The unmerged Codex adapter blanket-reservation problem is a separate
  parent-owned subsequent repair; that worktree/installed adapter was not edited.

Parent must run final `bun test`, `pwsh -NoProfile -File ./smoke-test.ps1`, review
attribution, complete exact-worker live acceptance and coordinate any nonpublishing
promotion. None of those pending gates is marked complete here.

## Usage, rollout and limitations

Examples and explicit pause/retained-ownership/cancel semantics are in
`project-router/README.md`. Unknown launch requires inspection rather than an automatic
retry. Verification commands must already be authorized in policy and explicitly bound
to the assigned step; workers cannot bind arbitrary checks or edit global rewards.

The no-cost harness accepts `--runtime-root <generation-or-source-root>` for parent
source-versus-promoted comparison. Current successful receipts loaded **direct source
in an isolated fixture**, not the selected production generation. No selected activation
file was modified and no claim is made about already-running terminals. After verified
parent promotion, open a fresh session and inspect `project_route_status.loadedModule`.
No TUI implementation was changed, so no invented normal/narrow captures are supplied.

Reward/handoff: attributable source for the hub front door, canonical goal/recovery
extensions, bounded model-facing tools, meaningful fixture coverage and real installed
destination-operation evidence, with exact worker/runtime gates explicitly pending.

## Parent integration checks (2026-09-08)

The parent integrated only the integrator's recorded files and the selected-source binding repair into `.worktrees/project-router-goal`. It migrated direct runtime fixtures to provide the actual source directory, explicit route fixtures to include reasoning, compact-detail assertions to request targeted evidence, and Windows shared-root assertions to compare normalized physical identity. Existing isolation, quota, proof and file-preservation assertions remain.

`bun test --timeout 30000` passed: 769 pass, 1 skip, 0 fail, 3,822 assertions, 111 files, 583.09 seconds. The test process used Git's existing mingw64/bin first in PATH and private orchestration/settings paths; no global setting or explicit per-test timeout changed. Earlier failed gate receipts remain under tmp. `pwsh -NoProfile -File .\smoke-test.ps1` passed: 103 tests, 624 assertions, config healthy. Logs: tmp/router-final-integrated-tests.log and tmp/router-final-integrated-smoke.log.

A fresh installed-host direct-source acceptance passed all eight checks: actual tool catalog, destination delivery/binding, destination Quest update and configured run, protected hub mismatch and bounded startup under a malformed journal lock. Evidence: .visual-e2e/project-router-1788836723632/report.json. This is isolated source loading, not selected-generation or existing-session acceptance.

The selected-source repair also produced a real exact Astra-medium launch whose worker HEAD matched the selected Codex-adapter source and contained its instructions/runtime files, instead of silently using canonical main. The worker's actual native read, shell and patch tools executed. Canonical owner identity remains unchanged. Exact goal continuation acceptance is still pending settlement of that worker's account reservation; no second worker was launched while it was active.

## Final parent acceptance

After the evidence-result repair, `bun test --timeout 30000` passed 771 tests, one existing skip, zero failures, 3,840 assertions across 111 files (136.67 seconds). Smoke passed 103 tests and 624 assertions. Logs are tmp/router-verified-tests.log and tmp/router-verified-smoke.log. The parent preserved every substantive assertion and only normalized Windows physical-directory comparison in the shared-mode acceptance harness.

Fresh exact openai/gpt-6-astra#medium real-worker acceptance passed all 14 checks in both modes: .visual-e2e/project-router-goal-1788839170634/report.json (worktree) and .visual-e2e/project-router-goal-1788839338848/report.json (shared). Both used normal Quest admission, fresh usage JSON, actual exposed route/capability discovery, unchanged access policy and the shared canonical account reservation. Both observed a real same-session continuation, native marker edit, actual verification proof, completed assigned step and run, goal stop, and account settlement before the fixture host exited. No permission grant for an external log read was needed. No second worker was launched against an active or unknown account hold.

The earlier failed fixture and explicit fresh-host same-session resume are retained separately: the original report remains failed, while subsequent actual Quest records show done/completed/settled with an explicit resume event. These establish the supported restart/resume path; they do not promise unattended continuation after every host exit.

Project-router is self-contained and works with the configured quest-giver agent. From the hub, ask it to work on a known project or explicitly clone/work on a repository URL. It discovers/selects/routes on demand and keeps the hub conversation. Corrections, pin/forget and multiple explicit projects use the exposed tools; a pasted URL in general discussion creates no work. To pursue a Quest, ask the giver to start a goal for that named Quest and its authorized steps; the giver routes that request to the owning session. In a bound giver, /goal start <quest> <step...> is explicit; an assigned worker's /goal start targets only its assignment. /goal status, pause, cancel and resume act on the current bound goal. Pause retains worker ownership for resume; cancel finalizes the observed terminal outcome. Hub follow-ups should name the selected project when controlling a destination goal.

Source integration and selected-generation acceptance are separate remaining rollout operations. Existing sessions keep their loaded generation and are never restarted by this task.
