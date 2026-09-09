# Quest repair and real usage UI continuation

This branch resumes the existing **Build project-router: one conversational entry point for all projects** usage-experience step and **Make Quest tool calls recoverable across the hub and project sessions** repair. It integrates the attributable, unfinished usage handoff from `usage-pacing-audit` into the isolated `usage-quest-resume` worktree. The original dirty worktrees, live config, installed plugins and existing processes were preserved.

## Delivered behavior

The actual `/usage` dialog now reads the same cached evidence projection as `usage_experience`. Keyboard and mouse controls select account, pool, view, capture source and reset period; quota history defaults to the latest bounded page, displays elapsed-time dots on a 0–100-point axis, and offers exact timestamp/value details. Request pages retain separate input/cache/output-and-reasoning counters and show unknown or pending counters explicitly. The view states gaps, excluded unbound records, stale observations, unsupported schedule predictions and the distinction between requested workers and actual admission. No collector, target renewal or controller write starts from this dialog.

The preserved handoff includes the bounded missing-history controller recovery: a fresh funded ready controller at zero may request one probe after the existing dwell. Unknown/live reservations and stopped states retain their gates. The existing HTML renderer remains reusable; the TUI is now connected to the real application rather than only producing a standalone report.

## Hook findings and fixes

The current session reproduced ownership rejections for `request_user_input_async` and `view_image`, as well as native delegation. The first two are classification defects: asking a question and reading a captured image cannot mutate a checkout. Explicit clarification, clock and read-only agent-status controls now bypass checkout acquisition. Image reads follow the existing recovered-read mapping and path checks. Arbitrary MCP tools, agent messages, native spawn and execution are not made checkout-independent.

A separate reproduced failure-loop path exists when a session links a broken or moved Quest. Optional title lookup can throw before ordinary execution; optional artifact linking can throw after success but before saving the completed call. The new regression demonstrates both. Title failure is now a saved diagnostic while ownership checks still run. Completed tool state is saved before artifact linking, and a linking failure is retained and reported once per changed cause. The Quest itself stays unchanged. This does not suppress mandatory ownership, recovery-binding or journal validation failures.

The existing installed adapter still uses the reviewed September 9 guard package. The new candidate was built and tested, not installed. These results do **not** prove that every recurring notification reported by the user has the same cause: this session's compact runtime record had completed shell calls and no linked Quest. The clarification tool intended to identify the other notification source was itself rejected by the installed guard.

Native Codex delegation remains unverified: the available spawn primitive exposes no checkout field, and the installed adapter does not establish a child-workspace binding. No agent launched from the denied exact Astra-medium request, and no substitute model was dispatched. The supported OpenCode2 product flow remains separate from this future Codex capability.

### Portable follow-up for native delegation

Work in the config repository, preserve live/unknown ownership and all existing dirty work. Use exact `openai/gpt-6-astra#medium`. Establish through the installed host whether native children inherit trusted hooks and whether a runtime-owned child checkout can be bound before the child's first tool. Implement only a verified binding path; do not whitelist spawn based on a path mentioned in its prompt. Test a conflicting parent, a new child, child read/write/shell, terminal settlement, unknown launch and unchanged owner files. If the host has no supported binding contract, report the exact missing contract; do not add generic workspace tools or weaken the existing guard. This is not a blocker for the current OpenCode2 workflow.

## Line-18 investigation

The old **Smoke test: write cheap2.txt and read it back** journal contains 18 complete JSON lines. The final `session-claimed` event, dated 2026-09-04T07:10:10.138Z, has no `payload` field. The preceding two events are ordinary proof and next-action updates. This is a malformed complete envelope, not an interrupted JSON append. `validEvent` correctly rejects it. The historical originating caller is not established; the current legacy claim path forwards its input without runtime payload validation, and `appendEvent` previously accepted an invalid runtime argument despite its TypeScript annotation.

`appendEvent` now checks the envelope before creating directories or appending bytes. A regression proves a malformed event cannot create a journal or modify an existing valid journal. Replay behavior is unchanged; no event is skipped, fabricated or repaired in place. The original journal was not edited; its SHA-256 remains `52ce1d79e185d6e805b32c46347ba155d1ec28843403b4db6532834e3b16ad44`. Historical recovery would need an explicit supported repair operation and an evidence-backed disposition of the missing payload.

## Observed verification

- Focused usage/controller/journal/recovery run: **47 passed, 0 failed**, 2,673 assertions.
- Adapter suite including the failed-link completion regression: **12 passed, 0 failed**, 50 assertions.
- Full repository gate: **902 passed, 1 existing skip, 0 failed**, 7,046 assertions across 127 files, 223.95 seconds. Private process-local TEMP/TMP/TMPDIR protected other sessions' scratch files. Receipt: `tmp/resume-full-tests.log`.
- Smoke gate: **103 passed, 0 failed**, 640 assertions. Receipt: `.visual-e2e/resume-smoke.log`.
- Candidate built by `scripts/build-codex-quest.ts .candidates/resume-guard`.
- Actual isolated Codex tool acceptance: `scripts/verify-codex-recovery-tool.ts .candidates/resume-guard --with-dependency`, **ok=true**, one original command, two local scripted-provider requests, zero remote model requests; dependency prepared in a private worktree and original ownership/files preserved. Receipt: `.visual-e2e/resume-guard-host.log` and `.visual-e2e/ownership-recovery-dependency/actual-tool-result.json`.
- Actual `UsageDialog` captures and keyboard navigation at 100 and 60 columns, dark and light; private frozen copies of existing numeric account/native-request telemetry, with the passive ledger explicitly omitted. Files under `.visual-e2e/usage-evidence/`.
- Installed OpenCode2 `--standalone` UI: account selection, stable OpenAI identity, quota history, request view and paging at 60 and 100 columns. Final receipts `.visual-e2e/usage-host-verified-60/manifest.json` and `.visual-e2e/usage-host-verified-100/manifest.json`. Only harness-owned standalone instances were closed.
- Actual installed-host Code Mode and source giver policy: `bun scripts/verify-burn-host.ts --giver`, **7/7 checks true**, including the bounded strict-JSON `usage_experience` result and persisted isolated target/controller. Receipt `.visual-e2e/burn-host-1788916871362/report.json`. This fixture uses a local scripted provider, not paid inference or a claim about live quota accuracy.

The original handoff smoke failed because its test used bare `Bun.spawn`; the source now uses the repository's hidden process helper. Light-theme contrast and a clipped narrow caption were found by inspecting rendered images and corrected. Early host account assertions were too broad and then raced repaint; the final harness waits for the account line to change and asserts it in every evidence view. The giver harness initially used JSON instead of JSONC parsing, then the old singular agent field, then checked the wrong output stream for role; those failures are retained in the session evidence. The final role is observed in stderr, and its source permission array is unchanged.

Automatic approval review rejected a proposed new giver permission as an access expansion. That command did not execute; the subsequent actual giver test passed under existing permissions, so no grant or other security-setting change is included.

## Release boundary

The live OpenCode selection remains `gen-1788841880125`. The installed Codex guard remains `0.0.0+codex.guard.20260909000500`. UI/server source and Codex hook source are separately verified candidates; neither has been promoted or installed by this work. No current session was restarted. Review and merge this PR before any separately authorized runtime adoption.

The current Codex Quest connector can list shared Quests, but targeted inspection returned `PROJECT_MISMATCH` from the hub; no caller identity was forged and no journal was hand-edited to attach this report. This report is the portable deliverable until a supported owning-project session attaches it.
