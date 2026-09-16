# Shared OpenCode memory

Shared by Codex, Claude Code and the Quest Giver; every harness reads and writes this one file. Facts, not rules: what is true about Jon, about the
world outside this repository, and an API no test guards. A rule for how to behave belongs in
AGENTS.md or CLAUDE.md, where it is read as an instruction rather than a note. A claim about how this
code behaves belongs in a core test, whose `@core-observed` block carries the incident, and is
referenced from "Where the rest lives" rather than restated here. A project convention belongs in that
project's AGENTS.md. A number you could recompute belongs in the script that recomputes it. Correct a
stale line in place, delete a wrong one. User instructions outrank memory.

## Jon

- No Delete key, and speech-to-text input; that key is how a long dictated run gets corrected. Turn
  what he says into an assignment rather than forwarding it verbatim, and do not rely on Delete
  existing.
- A failure he names is evidence about the system, not a request to patch that one instance.
- When he points out a missed behaviour, say why it was missed and fix the cause before doing the task.
- Never make him type a command or a path to operate or diagnose OpenCode2.
- Measure text in characters, never bytes.
- Luna medium is prohibited; Luna max is allowed. `models/access-policy.json` is the user setting and
  `test/model-selection-policy.test.ts` enforces it, so this line exists only so you do not propose the
  banned effort and lose a turn.
- Routine worker permission reviews go to a lower-cost capable reviewer from his own routes, chosen
  with `/quest-reviewer` and retained for the giver session. Only a genuinely new decision wakes the
  giver; manual approval stays available as a fallback.
- Quest Giver, the Quest system and its extensions are the product; OpenCode2 is the platform they run
  on. Models for chats, workers and reviewers stay user-selectable, and omitting one uses task-based
  routing.
- He does not want separate review passes or reviewer workers on the current OpenCode backlog:
  implementation, functional checks, actual-product acceptance and authorized verified merges are the
  delivery.
- New-session handoffs are only `Resume Quest <id>`. Save the workspace, current progress, remaining
  work, constraints and evidence references on the Quest; if saving fails, say the Quest is not current
  rather than claiming the id alone is ready.
- A newly started Quest is acknowledged in one short sentence: agree, give the Quest id, state the
  intended outcome, and name the selected worker model. No diagnostic preamble or routing rationale.
- Ordinary request intake is verified through native `/new`, `/model` and submission; explicit
  Quest-start checks alone do not establish that flow works.
- Prefer existing CLI or API access, including Python or shell, over adding model-facing tools, and do
  not add a standalone tool merely because a model needs a capability.

## Benchmarks and OpenEval

- Compare the selected orchestrator and workers as one setup, holding model and reasoning constant
  across every role and reporting repeated trials; a mixed-model or mixed-effort setup answers a
  different question. Distinguish native-host harness trials and external artifact checks from a
  completed OpenEval runner-and-judge benchmark.
- He reads comparisons on one page: numbers in aligned rows with separator lines and no boxes or
  metric tabs, each coloured delta to the right of its value and relative to benchmark 1 (identified
  once), stacked metric sections, and graphs or coverage left separate. Reported measurements must be
  available in the viewer he opens, not a separate HTML report or injected banner.
- For OpenEval, do not contact or modify the upstream repository again, including remote checks,
  comments, issues or PR updates; he is handling the premature submission. Keep Quest-specific
  integration private.

## The world outside this repository

- `nimbus_quill` (Fable) reports `usedPoints: 0` with no reset in every observation ever taken, across
  thousands of samples. A missing signal, not headroom. The observation log is the source; do not copy
  a count here, it rots.
- Quota is not usability. A route with capacity can still answer that it does not support this model,
  so a provider's own limits say nothing about whether a model will serve.
- Every Codex tool call replays the whole conversation to the model and again to the approvals
  reviewer, so a call costs far more than the work inside it however it prints. Dispatch, not
  execution, dominates every tool that writes: a write-class call spends seconds being dispatched
  against tens of milliseconds running, fewer, larger calls is the only thing that moves it, and a
  faster disk changes nothing. The measured incident and its figures live in the `@core-observed`
  block of `drive-settle`; re-measure them before quoting, because they drift as the session database
  grows.
- The running `oc` TUI is its own Windows Terminal window titled `OpenCode`, not a tab of the window
  Jon reads chat in, so `wt -w 0 focus-tab` and `wt -w 0 focus-pane` land in the wrong window and look
  like focus refusing to move. Find it by enumerating top-level `CASCADIA_HOSTING_WINDOW_CLASS`
  windows for the WindowsTerminal process and matching the title; never store the HWND, it changes
  every launch. Drive it natively: force foreground, confirm the foreground handle equals the one you
  found before sending anything, then send keys and capture the window rect. Refusing to send when the
  focus check fails is what keeps stray keystrokes out of his other tabs. This is the visible-window
  control surface he asks for; `runtime:drive` spawns a separate PTY and does not exercise the session
  he is looking at.

## Where the rest lives

Everything this file used to say about how the code behaves is enforced by a core test in
`test/`, whose `@core-observed` block holds the incident that produced it. That is the better
home: a test fails when the behaviour regresses, and it costs nothing to carry. Look there first.

- Sandboxed drives redirecting every home or none — `drive-isolation`
- Waiting for a driven host instead of polling it, and the Codex tool-call cost behind it —
  `drive-settle`
- Tool timing: no `state.time`, spans capped to the turn, approval-blocked time, interrupted calls —
  `duration-graph`, `execute-abort-attribution`, `execute-attribution`, `context-graph`
- A stale local branch building the wrong candidate — `try-ref-candidate`
- A prompt lost to a stale model catalog, and an explicit `/model` choice superseding the launch
  default — `refused-request-visibility`
- A derived route reaching dispatch unusable — `live-route-derivation`, `task-aware-effort`
- Reasoning effort and task classification — `model-selection-policy`, `task-aware-effort`
- Oversized tool results re-sent every turn — `result-budget`
- Locks and leases outliving the process that took them — `release-lock-reclaim`,
  `release-lease-evidence`, `deploy-lock-reclaim`
- Worktree retirement and checkout ownership — `worktree-retirement`, `quest-review-invariants`
- Concurrent protected worker tools, and workspace preferences surviving an isolated launch —
  `workspace-tool-wait`, `workspace-settings-home`
- Ctrl-Backspace word delete in the composer — `composer-word-delete`
- Quest claims, waits, naming, duplicates, worker identity, permissions and the bounded completion
  return — the `quest-*` tests
- `/new` and the single Quest Giver — `new-conversation-stays-home`,
  `new-conversation-succeeds-giver`, `giver-discovery-scan`
- The shared Quest contract served by the CLI, MCP and HTTP interfaces — `quest-api-contract`
- Tracked setup hashes and links — `setup-manifest`
