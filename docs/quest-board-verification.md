# Quest board and worker reliability verification

Verified on Windows on 2026-09-09. Implementation is on `fix/quest-board-reliability`, created from `origin/dev` in the owned `quest-board-reliability` worktree. The old dirty configuration checkout, existing worker worktree, host installation and ordinary channel selection were preserved.

## Evidence and causes

- The old MCP discovery preferred a guessed `127.0.0.1:4096` endpoint. There was no listener there. The configuration registration contained a password but no URL. The registered service at port 49374 answered but did not contain the dev worker (404). The owning process had a listener on 50417; the unrelated service credential received 401 there. These observations support an endpoint/ownership mismatch, not a conclusion that the owning process was dead. Standalone host credentials are private to that host; this repair does not extract or replace them.
- The board's v2 detail path did not expose the session navigation already available elsewhere. Saved `executing` state was presented as live activity. Returning from a root worker lost the selected Quest on narrow terminals because return data was only merged when a Quest argument was supplied.
- The event consumer subscribed once. A disconnected stream could stop outcome observation permanently. Direct dispatch also reused cached quota observations, although exclusive uncalibrated admission requires an observation newer than the terminal outcome.
- The earlier keyboard-editing worker initially had no persisted terminal outcome. Its last tool was a read of the hub instructions. Neither the old ledger nor the host's `time_suspended` bookkeeping proved liveness or death. A permission wait was possible but was not confirmed.
- At 22:45:19 UTC the owning host persisted `interrupted`; the pending read became `Tool execution interrupted`. Its Quest run became cancelled through `host:execution`, and its admission reservation settled at 22:45:20 UTC. This repair did not interrupt that worker or manually settle its reservation. The original hold was legitimate while ownership was uncertain. Later real configured dispatches succeeded after fresh quota observation.
- Installed verification found two further problems and corrected them: the polling hook in a plain `.ts` module did not join the host's shared Solid runtime, so it remained at “Checking owning host”; moving it into the transformed TUI `.tsx` graph fixed live refresh. MCP's forced `process.exit(0)` also reproduced a Windows Node/libuv handle-closing assertion after HTTP polls; allowing I/O to drain fixed it.

## Behavior and files

| Files | Change |
| --- | --- |
| `quest/tui-active/quest-board.tsx`, `workflow-actions.tsx` | Full-screen dark board, 29% grouped sidebar, selected green edge/slate row, real step counts, title/status/timestamps, recorded PRs, description, numbered steps, reward/artifacts, always-visible agent-log section, archive/turn-in actions, native giver composer dialog. Small terminals use list/detail navigation and scrolling. |
| `quest/tui-active/quests.tsx`, `worker-observation.tsx` | Clickable chat worker entry and native session picker; bounded live inspection every four seconds, recorded model/reasoning and meaningful activity, explicit unknown/unreachable/missing/blocked/terminal states. Saved work is labelled “Work recorded”, not confirmed running. |
| `quest/tui-navigation.ts`, `quest/tui-workflow.ts` | Verify exact native session and worktree/parent binding; preserve selection, filter, scope and back route. Board `w`, chat `/session`, `/quest-back` and return link reuse native navigation. |
| `quest/worker-observation.mjs`, `worker-inspection.ts`, `typed-tool.ts` | Separate live observations from ledger state; bounded inspections; reconcile missed terminal events through QuestTracker; no completion from silence or an old message. Native `quest get` with `inspect.section: runs` exposes observations. |
| `quest/server.ts`, `tracker.ts` | Reconnect lost event streams; retain resumable shutdown ownership; settle confirmed outcomes at their observed time. A terminal worker turn does not mark its steps done. |
| `models/dispatch-planner.ts`, `route-reservations.ts` | Refresh quota before direct admission; explain active/unknown holds separately from confirmed completion awaiting fresh quota. Account capacity, funding, exact-route choice and duplicate protection remain enforced. |
| `harnesses/opencode-mcp-stdio.mjs`, `plugin-set.json` | Explicit/channel-scoped endpoint discovery, rediscovery between operations, bounded actionable errors, no guessed port or dev-to-stable fallback, structured session status and safe Windows shutdown. A standalone host without a registered endpoint directs the caller to native inspection. |
| `scripts/verify-quest-installed-{navigation,dispatch}.ts` and focused tests | Actual installed-host captures, native mouse/keyboard/back checks, real configured workers, persisted results and admission settlement; deterministic disconnect, stale outcome, quota freshness and concurrency coverage. |

## Commands and results

Run package commands from the owned worktree:

```powershell
$repo = 'C:/Users/Jk101/.config/opencode/.worktrees/jonsocsetup-public/.worktrees/quest-board-reliability'
$candidate = 'C:/Users/Jk101/.config/opencode/.channels/releases/dev-quest-board-acceptance'
$reservations = 'C:/Users/Jk101/.config/opencode/.channels/state/dev/quests/.opencode/.quest-runtime/route-reservations.json'
Set-Location $repo
bun test
pwsh -NoProfile -File ./smoke-test.ps1
bun test test/opencode-mcp-gateway.test.ts test/quest-worker-observation.test.ts test/quest-host-reconnect.test.ts test/route-reservations.test.ts test/quest-workflow.test.ts test/tui-session-link.test.ts
bun test test/quest-redesign.test.ts test/quest-workflow.test.ts test/quest-host-reconnect.test.ts
node --check harnesses/opencode-mcp-stdio.mjs
node --check quest/worker-observation.mjs
bun scripts/verify-quest-installed-navigation.ts $candidate
bun scripts/verify-quest-installed-dispatch.ts $candidate $reservations
```

- Full `bun test`: **947 passed, 1 skipped, 0 failed**, 7,316 assertions, 948 tests / 140 files, 315.63 seconds. Log: `run-all-tests-acceptance.log`.
- Smoke: **103 passed, 0 failed**, 656 assertions; `OK: opencode config is healthy`. Log: `run-smoke-acceptance.log`.
- Focused repair set: **47 passed, 0 failed**, 217 assertions. Final renderer/workflow/reconnect set: **9 passed, 0 failed**, 40 assertions.
- Both Node syntax checks passed. The repository has no configured TypeScript project/typecheck script; these are syntax checks, not a claimed full typecheck. Immutable candidate compilation and actual server/TUI loading passed.
- Navigation: wide 160x52 and narrow 80x32 both passed mouse and keyboard opening of an actual persisted native model session, returning to the selected Quest, and reloading saved verification results. This was also repeated successfully on the preceding candidate. The final navigation report is `$candidate/.visual-e2e/installed-navigation-1788994700203/report.json`.
- Final real dispatch: **two passes**, each with one `cliproxyapi/gpt-5.6-sol` worker at `xhigh`, a real read and saved/re-read step note, persisted `succeeded` host outcome, settled account reservation, and automatic originating-giver response without another user prompt. Each pass captured confirmed running state and a later refresh, opened/cancelled the native composer dialog, entered the actual worker transcript and returned. Actual reply metadata, not a predicted label, verifies model identity. Giver model was the selected dev `cliproxyapi/gpt-5.6-luna#medium`. Report: `$candidate/.visual-e2e/installed-dispatch-1788994791070/report.json`.
- The unavailable historical endpoint was polled directly with `taskStatus` and returned structured `unreachable`, endpoint and recovery instructions, retaining unknown ownership. Evidence: `.visual-e2e/quest-redesign/unreachable-status.json`.
- Deterministic tests prove reconnect after stream loss, reconciliation after reload, no duplicate settlement, retention of unknown holds, release only after confirmed outcome plus newer quota, and concurrent independent admission when configured capacity permits. Actual uncalibrated account work ran sequentially, as its one-worker policy requires; simultaneous model workers were not claimed.

Candidate preparation used `bun install --frozen-lockfile`, then `bun scripts/prepare-channel.ts --model 'cliproxyapi/gpt-5.6-luna#medium'` from `$candidate`, with its own `OPENCODE_DB`, `OPENCODE_QUEST_ROOT`, `XDG_STATE_HOME`, orchestration and telemetry paths under `.visual-e2e/preparation`. `OPENCODE_ROUTE_RESERVATIONS` remained pinned to the real account ledger. `OPENCODE_CONFIG_PROJECT_DISABLE=1`, `OPENCODE_DISABLE_AUTOUPDATE=1`, and `OPENCODE_RELEASE_CHANNEL=dev` isolated configuration. No existing database was opened by a new worker host. The final preparation report is `$candidate/run/channel-prepare/report.json`.

Real-data renderer checks, supplemental to installed acceptance:

```powershell
$env:OPENCODE_QUEST_ROOT = 'C:/Users/Jk101/.config/opencode/.channels/state/dev/quests'
bun --preload @opentui/solid/preload scripts/quest-board-demo-capture.tsx --label actual-reconciled-wide --width 160 --height 52 --all-projects --quest c5075aa6e1cc662c170e8c6298
bun --preload @opentui/solid/preload scripts/quest-board-demo-capture.tsx --label actual-reconciled-narrow --width 80 --height 28 --all-projects --quest c5075aa6e1cc662c170e8c6298
```

These render canonical saved data without modifying it. Outputs are under `.visual-e2e/quest-redesign/`. Installed PNGs come from the actual PTY frame, not drawings. Captures were inspected, including both real worker passes.

Failures retained: earlier full runs caught obsolete layout/navigation expectations and a reconnect test sharing another suite's singleton; those were corrected and the full suite rerun green. Native checks exposed lost narrow selection, an untransformed reactive hook, command-entry timing, an overly broad transcript predicate, and a fixture missing its giver binding. The final checks use the corrected bindings and require leaving the board to prove worker navigation. One final preparation attempt failed before host launch with a Windows directory-rename `EPERM`; a fresh preparation passed and the failed artifact was retained. A proposed real refusal check declined to start because the original hold had already settled; no refusal was fabricated.

## Original Quests and release facts

“Add word-wise Ctrl-Backspace/Delete editing to OpenCode2”: host-confirmed interrupted, saved run cancelled, reservation settled. Its three implementation steps remain unfinished. No keyboard-editing implementation was taken over or overwritten.

“Match /quest board to visual reference and open running sessions”: its original dispatch remains failed before any worker session was recorded; two steps remain pending. This repair's source and PR are separate deliverables. The original Quest was neither retried nor falsely marked complete.

The installed host resolver selected **OpenCode2 v0.0.0-beta-19398** at the existing npm `@opencode/cli/bin/opencode2.exe`. The tested immutable plugin generation is `gen-7bb276ea8a6e`, with matching server and `tui:quests` load receipts. Later source changes only record verification setup/evidence. Source saved, dev merge, selected release and process load must be reported separately: the ordinary selected dev release remains `dev-988bc853828a-1788989462443`; the repair candidate was loaded only by isolated acceptance processes. Existing terminals were not restarted. No stable promotion, host update or public plugin-mirror publishing occurred.

## Limits

The reference image was not attached in this conversation. The written proportions, colors and hierarchy were implemented and inspected; exact screenshot matching cannot be claimed. Terminal cells and narrow viewports require wrapping, scrolling and stacked lower sections. Artifact previews display recorded text/links; no PR, progress, reward or identity is invented. The plugin router does not expose the host's full composer inside this screen, so the board launches its native giver prompt dialog and preserves native chat navigation.

Unregistered standalone endpoints remain private to their owning host; external MCP callers receive an explicit connection/ownership limitation instead of a guessed successful connection. Native inspection and navigation are the supported path there. Existing running generations do not acquire these changes merely because the source or PR exists.

Archive/reopen/turn-in persistence and permission/funding failure branches were covered by focused deterministic tests. The final live composer check opened and cancelled the native dialog; it did not send a new giver instruction. The original Quests were not used as disposable acceptance fixtures.
