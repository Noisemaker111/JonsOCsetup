# Single user Quest Giver and worker visibility

Follow-up to dev PR #8 (the board/runtime repair), implemented in the clean `single-user-quest-giver` worktree from merged dev. The original dirty checkout and original keyboard worker worktree remain untouched.

## Findings and fixes

- The project router deliberately created destination giver sessions, and the board's New action created another giver. A durable runtime registration now identifies the one user giver independently of project selection. First native discussion registers it before any Quest exists; native New and Quest New reuse it. Existing Quest owners are adopted through the supported store API with prior owner history retained. Missing, mismatched or uncertain giver identities never create a replacement.
- Source selection for the non-Git hub named the older public checkout. Dev editing now resolves the exact clean immutable release loaded by the process and checks its release receipt, generation source, Git HEAD and canonical owning repository before allocating a worker worktree. Dirty work is preserved, not used as an accidental starting point.
- The first Quest could be created after chat mounted, when its watched directory did not yet exist. The watcher now attaches when the directory appears and refreshes the real saved records.
- Board-started work did not register the automatic worker-return watcher used by chat dispatch. Both paths now persist the same return registration before dispatch. Giver origin and worker project are separately verified, so cross-project results return to the same conversation.
- A worker turn with a successful host outcome but unfinished assigned steps could appear merely idle. It now needs attention; the actual host outcome remains separate and no step completion is invented.
- Real Sol/xhigh workers repeatedly reported that execution tools were unavailable without attempting the Quest update. Capability observations established that native `execute` was present both in the context hook and outbound provider request. The prompt also said custom integration tools were unavailable, and read-only workers saw tools such as question that execution rejected. Read-only visible tools now match the guard, the Quest schema is pinned in the native catalog, and the native execute description explains the exact Quest update/get calling convention. Subsequent real workers saved and re-read their notes. Capability receipts retain only tool names, session identity and timestamps, never prompts, headers or credentials.
- Returning from a worker in a different directory could resolve Current project from the worker and hide the original Quest. Return navigation now retains and revalidates the board's source directory along with its selected Quest, filter and scope.

## Installed evidence

Installed host: OpenCode2 0.0.0-beta-19398, unchanged. Candidate: `dev-52fac3b1b7ed-1789000608061`. Server and TUI receipts identify the candidate's immutable generation.

Wide 160x52 and narrow 80x32 native navigation passed mouse and keyboard opening of the actual recorded worker transcript, return to the selected Quest across project directories, and saved/reloaded verification. Captures were inspected. Report: candidate `.visual-e2e/installed-navigation-1789000671551/report.json`.

Real dispatch uses the configured Sol/xhigh route and Luna/medium giver, the real shared account reservation file, and isolated host database, Quest store, state and telemetry. It first starts discussion without a Quest, then selects two different projects and dispatches one worker per project through the same giver. Each pass requires actual read/update/get calls, a reloaded completed step with evidence, exact recorded model identity, confirmed terminal outcome, settled reservation, automatic giver response, live refresh, composer, native worker/back navigation and only one giver after both New actions. Test providers and copied transcripts are not dispatch acceptance evidence.

The failed attempts are retained. Two earlier runs failed on synchronous Git identity setup after starting the PTY; fixture identities are now prepared before the PTY, while installed project_select still performs its independent verification. Another run left the board on the first selected Quest while observing the second; the driver now selects the second Quest by title through the native picker before checking it. These failures did not authorize duplicate uncertain dispatches. The original Quests were not disposable fixtures.

## Commands

From the owned worktree:

```powershell
bun test
pwsh -NoProfile -File ./smoke-test.ps1
bun test test/single-user-giver.test.ts test/quest-worker-capabilities.test.ts test/quest-first-watch.test.ts test/quest-incomplete-outcome.test.ts
bun test test/quest-workflow.test.ts test/quest-redesign.test.ts test/tui-session-link.test.ts
bun run runtime:channel prepare dev --ref HEAD --model 'cliproxyapi/gpt-5.6-luna#medium'
bun scripts/verify-single-giver-installed.ts <candidate> <real-account-reservations>
bun scripts/verify-quest-installed-navigation.ts <candidate> <real-isolated-host.db> INSTALLED_QUEST_WORKER_VERIFIED
```

Focused results: 8 passed, 35 assertions for giver/capabilities/first-watch/incomplete outcome; 21 passed, 89 assertions for cross-project return/layout/session links. Final smoke passed 103 tests, 660 assertions, with the cross-project return fix loaded. Final gate and rollout results are recorded below when observed.

The initial full run during this follow-up passed 953 tests with one skipped. A later full run overlapped the addition of the return regression after its module had already loaded; that new test failed against the previously loaded implementation. The fresh focused process passed. Final full verification runs after freezing implementation.

## Scope and rollout

The written board design is implemented; the reference image was not attached, so exact image matching is not claimed. Narrow terminals scroll or switch between list and detail. Native session navigation and composer are reused.

PR #8 is merged into dev. This follow-up's source, PR merge, selected dev release, loaded process and original Quest outcomes are separate observations. Stable promotion, host updates and public plugin mirror publishing are excluded. Existing terminals retain their loaded generation.

## Final installed acceptance before merge

The complete two-project/single-giver acceptance passed both runs. Report: candidate .visual-e2e/installed-single-giver-1789001414919/report.json. Both saved steps reloaded done with actual findings, both host outcomes were succeeded, both real account reservations settled, both automatic giver responses arrived, both exact Sol/xhigh worker identities were recorded, and each New action left exactly one giver. No worker tool errors occurred. Running and later live-refresh frames, final boards, native worker transcripts, return routes and native-New captures were retained and inspected.

A separate no-inference navigation reproduction on the existing test sessions also confirmed the native picker, sidebar mouse selection and Up/Down selection. No worker or giver was created for that diagnosis. Its captured states are under .visual-e2e/installed-single-giver-1789001308730/.
