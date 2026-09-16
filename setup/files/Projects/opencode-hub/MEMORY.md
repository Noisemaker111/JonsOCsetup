# OpenCode hub memory

Shared by Codex, Claude Code and the Quest Giver. Facts, not rules: what is true about Jon, about the
world outside this repository, and about costs measured in another harness. A rule for how to behave
belongs in AGENTS.md or CLAUDE.md, where it is read as an instruction rather than a note.
Anything true of this code belongs in a core test, which fails when it stops being true — see "Where
the rest lives". Correct a stale line in place, delete a wrong one. User instructions outrank memory.

## Jon

- Jon expects JonsOCsetup to be the maintained source and `.config/opencode` to be the installed destination. Describe historical Git archives separately from his current configuration; do not call the live config an unfinished worktree.
- No Delete key, and speech-to-text input. Turn what he says into an assignment; do not forward it
  verbatim, and do not rely on Delete existing.
- A failure he names is evidence about the system, not a request to patch that one instance.
- When he points out a missed behaviour, say why it was missed and fix the cause before doing the
  task. Doing the task alone leaves the cause in place.
- Never make him type a command or a path to operate or diagnose OpenCode2.
- Measure text in characters, never bytes.
- Luna medium is prohibited everywhere, with no lower-effort workaround and no alias for unsupported
  max. Astra medium is fine. `models/access-policy.json` enforces it and
  `test/model-selection-policy.test.ts` keeps it enforced; this line exists only so you do not propose
  it and lose a turn. Luna max is not prohibited and he reports almost unlimited Luna max allowance; his
  Claude and Codex accounts also carry headroom he wants used.
- Models for chats, workers and reviewers must remain user-selectable and changeable. Automatic
  choices use the user’s accounts, pricing, usage, speed and task evidence; never a model name in code.
- Routine worker permission reviews go to a lower-cost capable reviewer from his own routes, chosen via
  `/quest-reviewer` and kept for the giver session. Escalate only new decisions to the giver
  conversation. Manual approval stays as a fallback.
- Quest Giver, the Quest system and its extensions are the product; OpenCode2 is the platform they
  run on. A product API must stay callable from Claude, Codex or anywhere, so the platform belongs in
  an injected adapter and never in the API surface. A verb takes the Quest id alone: the Quest already
  carries the project, the work and the repo's own conventions, so an argument that restates one of
  those is a design smell.
- Merging a green PR into `agents` is the agent's call, not his. He raises promotion himself, so never
  say "release" to him and never bring up the stable or main branch.


## The world outside this repository

- `nimbus_quill` (Fable) reports `usedPoints: 0` with no reset across every observation ever taken —
  2,764 and counting, none nonzero. A missing signal, not headroom.
- Quota is not usability. A route with capacity still answered "Claude Code 2.1.220 does not support
  this model", so a provider's own limits say nothing about whether a model will serve.
- A Codex tool call costs about 320k input tokens whichever way it prints, because the conversation is
  replayed to the model and again to the approvals reviewer. 790 calls once cost 247M tokens to gather
  1M tokens of information. Re-measure before applying those figures to another session. The native
  Windows helper repair removed the observed home-directory token failure; the directory itself is
  not forbidden.
- Dispatch, not execution, dominates every tool that writes: a write-class call spends seconds being
  dispatched against tens of milliseconds running. Fewer, larger calls are the only thing that moves
  it; a faster disk changes nothing. Re-derive the figures before quoting them — they drift as the
  session database grows, and three entries here rotted that way before it was caught.

## Where the rest lives

Everything this file used to say about how the code behaves is enforced by a core test in
`source/test/`, whose `@core-observed` block holds the incident that produced it. That is the better
home: a test fails when the behaviour regresses, and it costs nothing to carry. Look there first.

- Sandboxed drives redirecting every home or none — `drive-isolation`
- Waiting for a driven host instead of polling it — `drive-settle`
- Tool timing: no `state.time`, spans capped to the turn, approval-blocked time, interrupted calls —
  `duration-graph`, `execute-abort-attribution`, `execute-attribution`, `context-graph`
- A stale local branch building the wrong candidate — `try-ref-candidate`
- A prompt lost to a stale model catalog — `refused-request-visibility`
- A derived route reaching dispatch unusable — `live-route-derivation`, `task-aware-effort`
- Reasoning effort and task classification — `model-selection-policy`, `task-aware-effort`
- Oversized tool results re-sent every turn — `result-budget`
- Locks and leases outliving the process that took them — `release-lock-reclaim`,
  `release-lease-evidence`, `deploy-lock-reclaim`
- Worktree retirement and checkout ownership — `worktree-retirement`, `quest-review-invariants`
- Quest claims, waits, naming, duplicates and worker identity — the `quest-*` tests
- `/new` and the single Quest Giver — `new-conversation-stays-home`,
  `new-conversation-succeeds-giver`, `giver-discovery-scan`
- Tracked setup hashes and links — `setup-manifest`

Quest operations share one contract exposed through the installed `quest` CLI and
the `quests` MCP namespace. Agents use those interfaces; implementation files are
internal. The giver stays in the hub and the runtime resolves its reviewed source
mapping for workers. Models remain user-selectable settings; omitted selections use
task-based routing.

- Benchmark the selected orchestrator and workers as one setup. OpenEval should select a native agent instead of hardcoding build and let OpenCode own delegation; keep Quest-specific integration private. Jon wants benchmark inspection integrated into the native eval page with its existing theme and UI components, not a separate HTML report or injected banner. Jon expects reported measurements to be available in the viewer he opens; distinguish native-host harness trials and external artifact checks from completed OpenEval runner-and-judge benchmarks.
- Jon expects orchestration comparisons to hold model and reasoning constant across every role and report repeated trials; mixed-model/effort setup experiments answer a separate question. Match capability to the task using measured model-and-effort combinations, not a universal effort-label ranking.
- Jon does not want upstream contributions. Keep implementation in his repositories and use supported host extension APIs. For OpenEval, do not contact or modify the upstream repository again (including remote checks, comments, issues or PR updates); Jon is handling the premature submission.

- Jon expects workspace coordination to cover every checkout-dependent tool, including persistent tools; checkout-independent operations must remain usable. Public Quest operations should be directly named (for example, quests.create with its fields), without quest.quest action dispatch or a repeated create wrapper.
- Jon does not want separate review passes or reviewer workers on the OpenCode backlog. Continue implementation, functional checks, actual-product acceptance and authorized verified merges; routine worker permission decisions still use supported controls. Workers save completion and deliverables, and the giver returns a concise handoff without redundant reads or bookkeeping turns. Reduce unnecessary activities rather than imposing a fixed activity count. The return itself must be bounded: a completion hands the giver the Quest id, title, state and a one-line outcome, with the full step notes left on the Quest and opened only when a decision needs them — ten full-note envelopes dumped into one giver turn is the cost he is objecting to.
- Jon expects no Quest to sit blocked or locked: every parked step is either work the giver can dispatch now or a decision it can put to him, and a step nothing can move is a product flaw to fix rather than a resting state. Workflow concurrency follows available account allowance and capable routes, not a fixed number of slots.
- Jon wants compact benchmark comparisons on one page: numbers in aligned rows with separator lines, no boxes or metric tabs. Put each colored delta to the right of its value, always relative to benchmark 1, and identify that reference once. Stack metric sections; keep graphs/trends separate and coverage/ranges on demand. Verify screenshot readability and clicks with pointer movement.
- Jon wants new-session handoffs to be only `Resume Quest <id>`. Save the workspace, current progress, remaining work, constraints and evidence references in the Quest before handing off; the receiving session resolves them from the ID. Do not make Jon carry paths or a second set of instructions. If saving fails, disclose that the Quest is not current instead of claiming the ID alone is ready.
- When acknowledging a newly started Quest, Jon wants one short sentence: agree, give the Quest ID, state the intended outcome, and name the selected worker model; omit the diagnostic preamble and routing rationale.

- A deliberate /model selection supersedes the launch default, including after /new. Verify ordinary request intake through native /new, /model and submission; explicit Quest-start checks alone do not establish this flow works.

- Keep OpenCode implementation in JonsOCsetup/.worktrees/<task> and durable verification evidence in JonsOCsetup/.evidence/<task>. Do not start new work in the legacy home-level dev-workflow-evidence directory. Preserve historical evidence links when relocating it.

- Prefer existing CLI or API access (including Python or shell) over adding model-facing tools. When CLI or MCP access needs improvement, use or generate a well-typed interface from the underlying contract. Do not add a standalone tool merely because a model needs a capability.

- September 14 correction: Jon does not require separate reviews or reviewer workers for the current OpenCode backlog. Keep functional checks and actual-product verification; do not make a review pass a delivery prerequisite. Routine worker permission decisions remain authorized through supported controls.

- The running `oc` TUI is its own Windows Terminal window titled `OpenCode`, not a tab of the window Jon reads chat in, so every `wt -w 0 focus-tab` or `wt -w 0 focus-pane` command lands in the wrong window and looks like focus refusing to move. Find it by enumerating top-level `CASCADIA_HOSTING_WINDOW_CLASS` windows for the WindowsTerminal process and matching the title; never store the HWND, it changes every launch. Drive it natively: force foreground (`AttachThreadInput` + `SetForegroundWindow`), confirm `GetForegroundWindow` really equals that handle before sending anything, then `SendInput` for keys and `CopyFromScreen` over the window rect for capture. Refusing to send when the focus check fails is what keeps stray keystrokes out of Jon's other tabs. This is the visible-window control surface Jon asks for; `runtime:drive` spawns a separate PTY and does not exercise the session he is looking at.
