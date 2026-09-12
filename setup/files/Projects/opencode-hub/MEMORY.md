# OpenCode hub memory

Load the `memory` skill before adding a line.

## Jon

- No Delete key. Backspace and Ctrl+Backspace behaviour is a constraint, not a preference.
- Input is speech-to-text. Turn it into an assignment; do not forward it verbatim.
- A failure Jon names is evidence about the system, not a request to patch that one instance.
- Never make Jon type a command or a path to operate or diagnose OpenCode2.

## Lessons

- Native worker agents must stay selectable by the host TUI; hidden as subagents, the composer falls back to the wrong model.
- Worktree cleanup belongs to Quest turn-in and release lifecycle events, not a cron or age sweep.
- `nimbus_quill`, Claude's Fable window, has read `usedPoints: 0` with no reset across all 2,390 observations. No signal, not full headroom.
- A model id missing from the host's `~/.cache/opencode/models.json` is not an error: the composer's `valid()` check drops the configured route silently and binds the fallback, and if `access-policy.json` has no route for that fallback our guard throws inside the `http.request` hook, where upstream only logs "Failed to drain Session". The prompt is lost with nothing on screen and no telemetry row. Three caches exist and only that one decides resolution — `~/.local/state/opencode/models-dev.json` feeds dispatch candidates and `models/models-cache.json` carries offline costs. Refresh the host cache from models.dev when a newly released model is configured.
- Quota is not usability: `cliproxyapi/claude-fable-5-1#high` had capacity and returned "Claude Code 2.1.220 does not support this model". `scripts/route-preflight.ts` records that in `route-health.json`; `unusableRoutes()` reads it with a 6-hour bound, and both dispatch and the activation gate refuse what it names. Refresh the probe before a release pass — stale health is not evidence and stops being consulted.

- Session history lives in `session_message` (29,502 rows, 1,205 sessions), not the older `part`/`message` tables. A tool part is `{type:"tool", name, time:{created, ran, completed}, state:{status, input, content, metadata}}`; `state.time` is undefined. `ran` is present on 34,569 of 39,597 parts, so `completed - ran` is execution and `ran - created` is dispatch; counting `completed - created` as execution charges dispatch to the tool. An assistant turn's own `time.{created, completed}` spans its tool calls, so tool spans must be capped to the turn before summing.
- An interrupted call's `completed` is stamped when the abort lands, so its span is how long an abandoned call went uncollected, never execution. Two aborted `execute` parts read as 76% of all Code Mode time; one had an uninterrupted twin running the identical program in 45.9s.
- Dispatch dominates every tool that writes: median `patch` is 7.74s dispatch against 11ms execution, `write` 2.12s against 12ms, `edit` 1.47s against 18ms. Fewer, larger calls are the only thing that moves it — a faster filesystem changes nothing.
- The host creates an assistant message lazily on the provider's first output event, so request assembly and time-to-first-token are recorded nowhere. That unrecorded stretch was 20% of a measured session — more than all time inside tools.
- Every non-`user` message type (`synthetic`, `system`, `compaction`) is an input the session waited for. Counting only `user` messages as inputs charged 1h 27m of worker-return idle to latency on one session.
- A slash alias can collide with a host command and silently open the wrong screen: `/time` opened the host Timeline dialog instead of the plugin route. Verify an alias by typing it in the real TUI.
- Reasoning effort is part of route identity and is chosen per dispatch: the task class (`run.task`) sets only how much published pass@1 the work may trade, `models/benchmarks.md` supplies the per-effort curve, and `models/route-cost.ts` orders what survives by recorded reasoning tokens per turn. An unclassified dispatch keeps the default coding demand; unknown recorded cost ranks last, never cheapest.
- A lock that records nothing cannot be told from a lock that is working: `.channels/retirement.lock` was a bare directory, so a killed launch stranded every later `oca` behind "retry shortly" with nothing able to remove it. It now carries `owner.json` and is reclaimed only when that pid is provably gone or the hold passes 15m, printing what it took and keeping the record in `.channels/lock-reclaims` (PR56). That lock is now `scripts/evidence-lock.mjs` and `plugin-deploy`'s `.plugin-promote.lock` holds it too: its old bare 120s mtime was observed taking the lock from a promotion whose owner pid was alive and three minutes in.
- Records that mark something in use need an owner to remove them: `.channels/release-users` leases were never cleared -- 67 records for 28 roots, 46 naming releases that no longer existed. Retirement now clears a lease whose root is gone. An open lease left by a killed launch is no longer permanent either: `scripts/process-evidence.mjs` lists the real process table and the lease is closed only when its pid and every pid its launch records name are gone, nothing has those pids as a parent, and nothing's image or command line runs out of the release root. A dead launcher pid alone still proves nothing -- Windows had already reissued 40820 to a `tail.exe` -- so a pid that started after the record that names it is treated as a handed-on number, and a pass that cannot list processes retires nothing and says so.
- The typed quest tool filters `run`'s arguments explicitly. Adding a field to the `quest run` API is invisible to the giver until it is declared in `quest/tool-schema.mjs` and forwarded at both `quest/typed-tool.ts` call sites; two driven dispatches told to set `run.task` came back "unclassified" before that.

- File Jon's stated intent as a draft Quest in the same turn he states it, before starting work:
  `bun ~/.agents/quest-draft.mjs "<outcome>" "<what he asked>" [step]...`. A session is not durable;
  the board is. Bad Quest titles, project_route latency, the runaway executes and Code Mode batching
  all had to be raised twice because they lived in chat.
- When Jon points out a missed behaviour, answer why it was missed and change what caused it before
  doing the task. Doing the task alone leaves the cause in place.
- A harness that starts a host must redirect every real home together -- `OPENCODE_DB`,
  `OPENCODE_QUEST_ROOT`, `OPENCODE_ORCHESTRATION_LEDGER`, `OPENCODE_TELEMETRY_FILE`,
  `XDG_STATE_HOME` -- or none of them. A partial redirect is a check writing real data: eight
  "Trim greeting input" fixtures reached Jon's live board from a `.visual-e2e` sample root. The
  table is `scripts/drive-isolation.ts`; `drive-giver.ts --live` is the deliberate none-of-them case.
- Recorded tool duration includes time blocked on a human approval, so a tool can look slow when it
  never ran. 19 calls out of 39,597 hold 152.4h, 53.1% of all turn wall time, and 18 ended in error;
  the worst were `glob` waiting on an external-directory prompt, not searching — `glob`'s median
  execution is 79ms. Split blocked from running before concluding a tool is slow.
- `runtime-channel.mjs prepare dev --ref agents` resolves a stale ref and silently builds the wrong
  commit. Pass `--ref origin/agents` after fetching; activation then checks the tree matches — and
  that check makes a candidate stale the moment anything else merges, so prepare, gate and activate
  in one pass when the branch is quiet, not alongside other agents' merges.
- A drive through `key {name,ctrl}` proves nothing about terminal encodings: the embedded terminal
  answers the host's kitty keyboard query, so keys always arrive modifier-tagged. Byte-level claims
  need `raw {hex}` — Windows Terminal sends bare `08` for Ctrl+Backspace, `17` for Ctrl+W,
  `1b 7f` for Alt+Backspace.
- A harness that starts a host takes its workers with it. `drive-giver` now records every run the
  board already carried and holds the host open until anything it started reaches completed, failed
  or cancelled (`--worker-grace`, default 30m). Two VPS workers died before that, one after reading
  502,165 input tokens of real investigation.
- The Quest board is an importable API, not a CLI: `openBoard()` from `~/.agents/quest-api.mjs`
  returns plain data and throws `BoardError` with a `code`. `quest.mjs` is only argv, printing and
  exit codes. Code Mode composes calls; it should never spawn a process to parse text back.
- An object cannot carry a field and a method of the same name — `release` as both the release root
  and release-a-step silently resolved to the function, and a caller reading the field got one.
- A cause is traced or it is inferred, and the two must never be written the same way. "Usage limit
  reached" printed above "Switched agent to Build" produced a confident wrong mechanism that reached
  a commit, a PR, a Quest and this file before one grep of "Switched agent" disproved it. The real
  path is `app/src/composer/submit.ts sendPrompt()`, which calls `switchAgent` whenever the composer
  selection differs from the session — `session_v2.agent` follows the dropdown, nothing recovers
  anything. A claim naming a mechanism carries a file:line or says it is a guess.
- A report ends a turn; it never interrupts one. The two-heading format manufactured a closing every
  turn -- a tidy summary was available, so the turn ended and Jon had to say "continue" for work
  already decided. If the next action can be named, take it. Background work running is not a
  stopping point.

## Maintenance

Correct a stale line in place, delete a wrong one, keep the evidence. User instructions outrank memory.
