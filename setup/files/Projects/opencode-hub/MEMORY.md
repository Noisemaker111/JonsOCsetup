# OpenCode hub memory

Shared by Codex, Claude Code and the Quest Giver. What belongs here, and what belongs in a project's
AGENTS.md instead, is in this hub's AGENTS.md under Shared memory. Correct a stale line in place,
delete a wrong one, keep the evidence. User instructions outrank memory.

## Jon

- No Delete key. Backspace and Ctrl+Backspace behaviour is a constraint, not a preference.
- Input is speech-to-text. Turn it into an assignment; do not forward it verbatim.
- A failure he names is evidence about the system, not a request to patch that one instance.
- When he points out a missed behaviour, say why it was missed and fix the cause before doing the
  task. Doing the task alone leaves the cause in place.
- Never make him type a command or a path to operate or diagnose OpenCode2.
- Measure text in characters and say characters. Bytes are not what he asked about and the two
  differ the moment a dash or a quote is not ASCII.
- Luna medium is prohibited for every role, selection, verification, fallback and resume — no
  lower-effort workaround, no alias for unsupported max. Astra medium is independently authorized.
  `models/access-policy.json` owns enforcement.
- Routine worker permission reviews go to a lower-cost capable reviewer from his own routes, chosen
  via `/quest-reviewer` and retained for the giver session. Keep them out of the SOTA giver
  conversation; escalate only new decisions. Manual approval stays as a fallback.

## Lessons

Model and route resolution

- A model id missing from the host's `~/.cache/opencode/models.json` is not an error: the composer's
  `valid()` check drops the configured route silently and binds the fallback, and the prompt can be
  lost with nothing on screen and no telemetry row. Only that cache decides resolution — refresh it
  from models.dev when a newly released model is configured.
- Quota is not usability: a route with capacity still returned "Claude Code 2.1.220 does not support
  this model". `scripts/route-preflight.ts` records that in `route-health.json`; refresh the probe
  before a gate pass, because stale health is not evidence.
- Native provider reasoning belongs under `settings.providerOptions.reasoningEffort`. Flat
  `settings.reasoningEffort` was silently dropped while the UI still displayed xhigh. A session label
  is not wire-level effort evidence.
- `nimbus_quill` (Fable) reports `usedPoints: 0` with no reset across every observation ever taken
  (2,764 and counting). No signal, not headroom.

Harnesses and drives

- Tool instructions must match the configured harness and its actual catalog. Do not infer Bash,
  Python or Code Mode availability from a model tier.
- A harness that starts a host redirects every real home together — `OPENCODE_DB`,
  `OPENCODE_QUEST_ROOT`, `OPENCODE_ORCHESTRATION_LEDGER`, `OPENCODE_TELEMETRY_FILE`,
  `XDG_STATE_HOME` — or none. A partial redirect is a check writing real data; eight fixtures reached
  the live board that way. Table: `scripts/drive-isolation.ts`.
- A harness that starts a host takes its workers with it. Hold the host open until anything it
  started reaches a terminal state; two workers died before that, one after 502,165 input tokens of
  real investigation.
- `prepare dev --ref agents` resolves a stale local ref and builds the wrong commit. Pass
  `--ref origin/agents` after fetching. Activation's tree check makes a candidate stale the moment
  anything else merges, so prepare, gate and activate in one pass while the branch is quiet.
- A fake-host unit test cannot tell you a route is being hijacked before the hook runs, and a slash
  alias can collide with a host command and silently open the wrong screen. Drive the real TUI.
- Read the installed gate report, not just its exit code. A timeout watching the first giver, or a
  same-title empty Quest, is not evidence that the worker failed.

Quests

- The board is an importable API, not a CLI: `openBoard()` from `~/.agents/quest-api.mjs` returns
  plain data and throws `BoardError` with a `code`. Never spawn a process to parse text back.
- The typed quest tool filters `run`'s arguments explicitly. A new field is invisible to the giver
  until declared in `quest/tool-schema.mjs` and forwarded at both `quest/typed-tool.ts` call sites.
- Worker permission APIs in the installed host are location-scoped even though session get/context
  route across locations. Inspect and reply from the owning worker location, and use a native
  reviewer session with `session.generate` — the stateless plugin `generate.text` path omits session
  headers the provider requires.
- Native worker agents must stay selectable by the host TUI; hidden as subagents, the composer falls
  back to the wrong model.
- On Windows a claim can be journaled before snapshot replacement fails with EPERM. Retry the same
  replacement under the Quest lock; replaying the claim or clearing the owner loses coordination.
- Keep Code Mode returns narrow, or result-budget elision forces the reads again.

Measurement

- Dispatch dominates every tool that writes: median `patch` is 7.74s dispatch against 11ms
  execution, `write` 2.12s against 12ms. Fewer, larger calls are the only thing that moves it.
- Recorded tool duration includes time blocked on human approval, so a tool can look slow when it
  never ran. Nineteen calls hold over half of all turn wall time and eighteen of them ended in error;
  `glob` leads them and its median execution is under 100ms. Re-derive before quoting a figure.
- An interrupted call's `completed` is stamped when the abort lands, so its span measures how long an
  abandoned call went uncollected, never execution.
- The host creates an assistant message lazily on the provider's first output event, so request
  assembly and time-to-first-token are recorded nowhere — 20% of one measured session.
- Every non-`user` message type (`synthetic`, `system`, `compaction`) is an input the session waited
  for. Counting only `user` messages charged 1h 27m of worker-return idle to latency.
- Session history is in `session_message`, not `part`/`message`. A tool part has no `state.time`;
  `completed - ran` is execution and `ran - created` is dispatch, and spans must be capped to the
  enclosing assistant turn before summing.
- A Codex tool call costs ~320k input tokens whichever way it prints, because the conversation is
  replayed to the model and again to the approvals reviewer. 790 calls once cost 247M tokens to
  gather 1M tokens of information. Optimise the number of calls, never their output size.

Design decisions that keep being rediscovered

- A lock or lease that records nothing cannot be told from one that is working. Locks carry
  `owner.json` and are reclaimed only when the pid is provably gone; leases close only when every pid
  their launch names is gone. A dead pid alone proves nothing — Windows reissues them.
- Worktree cleanup belongs to Quest turn-in and lifecycle events, not a cron or age sweep.
- Codex checkout protection applies to real Git checkouts and the configured hub, not a non-Git home
  directory. Existing ownership records survive that scope correction.
