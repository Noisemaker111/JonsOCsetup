# Quest reference acceptance follow-up (in progress)

The merged board/runtime repair and one-user-giver changes are dev PRs [8](https://github.com/Noisemaker111/JonsOCsetup/pull/8) and [9](https://github.com/Noisemaker111/JonsOCsetup/pull/9). The actual ocd launch loaded merged source 4b62354e599921e6f3faeca6c5a2e49110cad19a from dev-4b62354e5999-1789002009307. Stable and the installed host were not promoted or changed.

## Reference and original Quests

The image was not attached in the Codex conversation, but was recovered read-only from the original board giver's image attachment. It is retained in run/ocd-review/original-reference.png and was visually inspected. The original reference has a 29% sidebar, compact agent table beside reward previews, and a full-width bottom composer. Terminal cells cannot reproduce photographic thumbnails or smooth circular progress exactly.

One canonical giver now owns both original Quests across projects. The original keyboard worker has a confirmed interrupted host outcome and settled reservation; its checkout was clean and preserved. Its research, implementation and verification remain unfinished. Its authorized route remains openai Astra/medium.

The original failed board launch recorded no worker. After reconciliation and fresh quota, its new run started from the exact clean reviewed dev release on the configured Sol/xhigh route. The worker made changes in its own workspace to quest/tui-active/quest-board.tsx and rendering audit scripts. They have not yet been integrated or accepted. Review identified missing observation detail and a composer still confined to the detail pane.

## New failures found in actual operation

1. Two external read requests (hub instructions and the original image) waited for native permission. Navigating into the existing worker allowed the already-enabled native auto responder to handle them, without a new launch. Native Quest workers created through public session.create are root sessions; the current public API has no parentID input. The native responder follows the current root and its native descendants, rather than the Quest ledger's parent relation.
2. A composer nudge could lose the selected Quest during the asynchronous handoff. The source now captures the return route before awaiting the dialog and prompt.
3. A native worker follow-up changed its agent/model to the composer's previous visible selection. Actual recorded assistant messages before the follow-up were cliproxyapi/gpt-5.6-sol xhigh; after it, two turns were cliproxyapi/gpt-5.6-luna medium with quest-giver agent. This was an unintended substitution and is not accepted verification. The installed native composer excludes hidden subagent agents, then writes its visible selection on submit. The follow-up asked an unnecessary proceed question and remained waiting. Source now checks exact assigned identity at context and outbound request boundaries and before guidance; mismatch rejects before inference.
4. The selected standalone host uses a random in-memory lease credential and does not publish a service registration. Its verified server listener was port 61261; port 61254 was a different bridge in the same process. Unauthenticated host requests returned 401; the bridge returned 404. A prepared recovery through the documented session agent/model APIs did not mutate anything because native shell commands did not receive the lease credential. Automatic approval review rejected inspecting the owning process environment without specific permission. Scoped permission was requested; no credential was read, printed, or saved.

The existing board worker, workspace and account reservation are preserved. Do not dispatch a duplicate or release its admission based on elapsed time. Do not claim either original Quest complete.

## Pending recovery and acceptance

Use only the owning host's documented session.switchAgent and session.switchModel controls to restore the existing worker to its recorded agent/provider/model/reasoning. The prepared local recovery verifies the session and workspace first and prints only restored identity and pending forms. Credential access, if needed, requires the requested explicit approval. Then inspect and resolve its actual pending question through the native form API, verify the next assistant identity, collect its saved result, and resume the existing keyboard Quest with its exact authorized route after confirmed terminal outcome and fresh quota.

Review and integrate returned visual changes only with clear ownership. Run focused rendering at wide/narrow sizes, the required full tests and smoke gate, then two installed real-provider flows including native session/back and an actual composer nudge returning to the older selected Quest. Save actual captures and persisted outcomes. Open a ready PR, merge dev, prepare and verify the exact merge, activate dev, and exercise actual ocd with the same giver. Existing unrelated sessions and stable remain untouched.

## Checks so far

- bun test test/quest-worker-observation.test.ts test/opencode-mcp-gateway.test.ts test/quest-workflow.test.ts test/tui-session-link.test.ts: 42 passed, 200 assertions.
- bun test test/session-guidance.test.ts test/quest-worker-capabilities.test.ts test/quest-worker-identity.test.ts test/quest-worker-observation.test.ts: 12 passed, 52 assertions before the additional pending-form regression.
- bun build scripts/verify-single-giver-installed.ts --target=bun --packages=external --outfile=run/verify-single-giver-check.js: passed. An initial fully bundled check failed on non-Windows optional native packages; keeping installed packages external is the appropriate driver syntax check.
- Final bun test: 961 passed, one existing skip, zero failures, 7,388 assertions across 962 tests / 145 files, 325.14 seconds (run-reference-final-all.log). The preceding run also passed 961 tests before adding the terminal-reconciliation edge case.
- Final pwsh -NoProfile -File ./smoke-test.ps1: 103 passed, zero failures, 661 assertions; configuration healthy (run-reference-final-smoke.log).
- Final focused observation/identity/guidance check: 12 passed, zero failures, 52 assertions. node --check quest/worker-observation.mjs and git diff --check passed. Installed worker-flow acceptance remains blocked by the existing worker recovery; these gates are not a claim of successful end-to-end completion.

## Installed navigation checkpoint

The prepared candidate dev-765c9fd89e00-1789005640922 loaded the source checkpoint in the installed host. The no-inference command below passed at 160x52 and 80x32: keyboard and mouse both opened the actual recorded Sol/xhigh session and returned to the selected Quest. Saved verification state was reloaded. Wide agent-log and narrow returned-detail captures were inspected. This is navigation evidence, not the required two new worker dispatch flows.

Command: bun scripts/verify-quest-installed-navigation.ts C:/Users/Jk101/.config/opencode/.channels/releases/dev-765c9fd89e00-1789005640922 C:/Users/Jk101/.config/opencode/.channels/releases/dev-4b62354e5999-1789002009307/.visual-e2e/installed-single-giver-1789002093861/host.db INSTALLED_QUEST_WORKER_VERIFIED

Report: candidate .visual-e2e/installed-navigation-1789005730622/report.json; both runs ok. The candidate is not selected. PR #10 is ready for review but held from dev merge pending original-worker recovery and real worker-flow acceptance. At 2026-09-10T02:02:50Z the original board worker had no host terminal outcome and its reservation remained active; the old keyboard worker still had its recorded interrupted outcome and settled reservation. One canonical giver binding remained unchanged.
