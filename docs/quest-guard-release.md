> Historical evidence: scenario scripts named below have been removed. They are not current verification instructions. Use [the actual product](user-verification.md) and the small production-logic core suite.

# Ownership guard follow-up and activation gate

This follows merged PR13 on production `master`; the earlier adapter-lineage PR11 is not the release target. The merged revision did not contain the later cached-patch safety correction. This branch adds that correction plus the user-authorized automatic recovery improvements. Do not activate it before the reviewed follow-up is merged.

## Runtime behavior

Read-only operations do not require exclusive checkout ownership. Web/read/glob/grep and a deliberately narrow literal PowerShell read grammar remain available. Raw shell/Git expressions are not classified as safe merely because their command name looks read-only. After recovery, task reads target the recovered worktree; external skill reads stay independent.

Conflicting edits create/reuse an owned worktree. A bounded, stable two-pass snapshot preserves supported tracked source changes without altering the owner's index, dirty files or reservation. Source filters, hooks and fsmonitor are disabled during preparation. Ambiguous untracked/sensitive inputs and racing/unknown snapshot application produce a specific preserved blocker rather than silently disappearing from the task source. Ordinary file operations need no dependency install.

Dependency execution uses a fixed Bun recipe for supported integrity-locked registry packages, with a task-private cache and copied dependencies. It does not run repository lifecycle scripts, enable network access or give the installer shared-cache/owner write access. Missing or unsupported cached inputs remain explicit blockers. Preparation receipts bind immutable inputs; failed/unknown work is not blindly replayed. This is a bounded supported preparation path, not permission to run arbitrary project bootstrap scripts.

Ended ownership is reconciled only after actual terminal evidence; elapsed time or a completed-looking Quest title does not release active/unknown work. Replayed patches and recovery roots are revalidated against junction/branch changes. Logical session cwd remains unchanged: supported shell/patch/read operations are rebound. Persistent tools without a verified binding remain denied.

## Installed baseline and real-host audit

The ordinary installed adapter remains `opencode-quests@personal`, cache version `0.0.0+codex.20260907215951`; installed hook SHA256 is `a69b05f8e7cd5832945e6faf90a242feab7d30dfd4f1bde4246593de0440815a`. A fresh actual Codex0.153.4 session reproduced its PreToolUse rejection of literal absolute reads of the Windows-shell skill, recovery skill and owner fixture file.

The packaged candidate clears that guard and reads the owner file without creating a worktree or taking ownership. The same actual shared skill paths encounter a separate Windows read-only sandbox denial. Copying their exact inspected content into sandbox-readable fixture paths makes the complete read audit pass. These outcomes are distinct; fixture success does not claim access to the original shared paths.

A separate normal per-command approval experiment was rejected by the isolated host's automatic reviewer because its scripted provider response was not valid guardian JSON. The rejection was not bypassed. That unsuccessful experiment is retained under `tmp/verify-codex-approved-read.ts` and its logs, not shipped as an alternate approval path. Final ordinary installed/shared-path acceptance is still required after the merge-gated activation, using the host's normal authorized filesystem access.

Real-host probes also verify one original conflicting-write call retries in its correct package workdir, tracked dirty input reaches the recovered tree, owner writes are denied, and the original owner record/dirty work/process remain intact. A fresh actual host retains an ended owner's unknown launch, then reconciles it after terminal evidence arrives through its packaged hook.

## Release procedure after review

1. Confirm the follow-up PR is merged and obtain its exact reviewed merge revision. Do not substitute current dirty live config source.
2. Build the adapter from an isolated clean checkout of that revision. Record source identity and packaged executable hashes.
3. Use the existing supported personal plugin installation flow and exact hook hashes from `hooks/list`, trusting only these four reviewed Quest hooks. Preserve the prior installed package for rollback; no public package publishing, broad configuration rewrite or session restart.
4. Start a fresh Codex host with the ordinary installed plugin. Verify plugin selection/hashes, the actual shared-path read audit, conflicting-write recovery/reuse, ended-owner reconciliation and active-owner protection. Existing sessions retain their loaded adapter; do not claim they adopted the replacement.

The user has authorized steps2–4 once the reviewed revision is merged. Until then the required action is a ready PR and a merge request, not activation. No shared ownership records, session databases, installed host or upstream source have been hand-edited.
## Final verified candidate

- `bun test --timeout 30000`: **843 passed, 1 existing skip, 0 failures**, 4193 assertions across120 files, 152.78s. Git mingw64/bin was first only in this test process's PATH.
- `pwsh -NoProfile -File ./smoke-test.ps1`: **passed**, 103 tests /633 assertions.
- `bun scripts/verify-codex-recovery-tool.ts .candidates/guard-release-final --with-dependency`: **passed**. One original tool call, two scripted provider requests, zero remote model calls. The actual installed Codex host created the owned worktree, preserved tracked dirty source, installed the cached package privately, and ran the dependent command in the correct nested package directory. Lifecycle sentinel absent; owner files and ownership preserved.
- `bun scripts/verify-codex-recovery.ts .candidates/guard-release-final`: **passed**. Original operation retried, writes to owner denied, owner record/dirty file/live process unchanged.
- `bun scripts/verify-codex-readonly.ts .candidates/guard-release-final --fixture-skills`: **passed** with a conflicting live owner and read-only sandbox, no recovery worktree or owner mutation.
- Same read-only command with `--ended-owner`: **passed** through a fresh actual Codex session. Fixture terminal evidence, not age, enabled reconciliation; unknown launch was retained beforehand.
- `bun scripts/verify-codex-preparation.ts`: **passed twice after final worker correction**. Real network-disabled command/exec installed picocolors1.1.1, then printed PREPARED_OK. Private cache copies were independent; no lifecycle sentinel appeared.

Evidence: `.visual-e2e/ownership-recovery-dependency/actual-tool-result.json`, `ownership-recovery/candidate-host.json`, `ownership-readonly-candidate-fixture-skills/actual-tool-result.json`, `ownership-readonly-candidate-fixture-skills-ended-owner/actual-tool-result.json`, `ownership-preparation/report.json`, and `tmp/guard-release-{tests,smoke,dependency-tool,owner-protection,readonly,ended-owner}.log`.

The final executable package hashes are recorded by `.candidates/guard-release-final/receipt.json`. No installed adapter files or hook trust configuration were changed. The ordinary installed shared-path audit remains a post-merge activation check; this report does not call the candidate live.