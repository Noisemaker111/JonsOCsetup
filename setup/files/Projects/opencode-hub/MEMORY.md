# OpenCode hub memory

Shared by Codex, Claude Code and the Quest Giver. Only what nothing else can hold belongs here: how to
work with Jon, facts about the world outside this repository, and costs measured in another harness.
Anything true of this code belongs in a core test, which fails when it stops being true — see "Where
the rest lives". Correct a stale line in place, delete a wrong one. User instructions outrank memory.

## Jon

- No Delete key, and speech-to-text input. Turn what he says into an assignment; do not forward it
  verbatim, and do not rely on Delete existing.
- A failure he names is evidence about the system, not a request to patch that one instance.
- When he points out a missed behaviour, say why it was missed and fix the cause before doing the
  task. Doing the task alone leaves the cause in place.
- Never make him type a command or a path to operate or diagnose OpenCode2.
- Measure text in characters and say characters, never bytes.
- Luna medium is prohibited everywhere, with no lower-effort workaround and no alias for unsupported
  max. Astra medium is fine. `models/access-policy.json` enforces it and
  `test/model-selection-policy.test.ts` keeps it enforced; this line exists only so you do not propose
  it and lose a turn.
- Routine worker permission reviews go to a lower-cost capable reviewer from his own routes, chosen via
  `/quest-reviewer` and kept for the giver session. Escalate only new decisions to the giver
  conversation. Manual approval stays as a fallback.
- Merging a green PR into `agents` is the agent's call, not his. He raises promotion himself, so never
  say "release" to him and never bring up the stable or main branch.

## The world outside this repository

- `nimbus_quill` (Fable) reports `usedPoints: 0` with no reset across every observation ever taken —
  2,764 and counting, none nonzero. A missing signal, not headroom.
- Quota is not usability. A route with capacity still answered "Claude Code 2.1.220 does not support
  this model", so a provider's own limits say nothing about whether a model will serve.
- A Codex tool call costs about 320k input tokens whichever way it prints, because the conversation is
  replayed to the model and again to the approvals reviewer. 790 calls once cost 247M tokens to gather
  1M tokens of information. Optimise the number of calls, never their output size. Codex also cannot
  build a sandbox token with the home directory as the working directory, which forces every command to
  escalate and doubles that cost again — start those sessions in a project directory.
- Dispatch, not execution, dominates every tool that writes: a write-class call spends seconds being
  dispatched against tens of milliseconds running. Fewer, larger calls are the only thing that moves
  it; a faster disk changes nothing. Re-derive the figures before quoting them — they drift as the
  session database grows, and three entries here rotted that way before it was caught.

## Where the rest lives

Everything this file used to say about how the code behaves is enforced by a core test in
`config/test/`, whose `@core-observed` block holds the incident that produced it. That is the better
home: a test fails when the behaviour regresses, and it costs nothing to carry. Look there first.

- Sandboxed drives redirecting every home or none — `drive-isolation`
- Waiting for a driven host instead of polling it — `drive-settle`
- Tool timing: no `state.time`, spans capped to the turn, approval-blocked time, interrupted calls —
  `duration-graph`, `execute-abort-attribution`, `execute-attribution`, `context-graph`
- A stale local branch building the wrong candidate — `try-ref-candidate`
- A prompt lost to a stale model catalog — `refused-request-visibility`
- A derived route reaching dispatch unusable — `live-route-derivation`, `verification-route`
- Reasoning effort and task classification — `model-selection-policy`, `task-aware-effort`
- Oversized tool results re-sent every turn — `result-budget`
- Locks and leases outliving the process that took them — `release-lock-reclaim`,
  `release-lease-evidence`, `deploy-lock-reclaim`
- Worktree retirement and checkout ownership — `worktree-retirement`, `quest-review-invariants`
- Quest claims, waits, naming, duplicates and worker identity — the `quest-*` tests
- `/new` and the single Quest Giver — `new-conversation-stays-home`,
  `new-conversation-succeeds-giver`, `giver-discovery-scan`
- Tracked setup hashes and links — `setup-manifest`

Two things are APIs rather than invariants, so no test guards them. The Quest board is importable:
`openBoard()` from `~/.agents/quest-api.mjs` returns plain data and throws `BoardError` with a `code`,
so never spawn a process to parse text back. And the typed quest tool forwards `run`'s arguments as an
explicit field list at two call sites in `quest/typed-tool.ts`, so a new field stays invisible to the
giver until both are updated.
