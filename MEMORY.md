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
- Keep installed skills sparse. A skill must add task-specific capability beyond AGENTS.md, and its discovery description must be one precise activation sentence.
- Deepseek 4.1 routes run at `high`, never `max`, for workers, reviewers and fallbacks.
- Luna medium is prohibited; Luna max is allowed. `models/access-policy.json` is the user setting and
  `test/model-selection-policy.test.ts` enforces it, so this line exists only so you do not propose the
  banned effort and lose a turn.
- Kimi K3 is banned on every route: the cost is high and the work is not good enough to justify it.
  Never pick it, propose it or fall back to it.
- Read account usage before choosing or proposing any model. An account whose window is spent is not
  a candidate, and finding that out from a failed turn is the circle he is tired of.
- His Chrome is signed in to his accounts (Google Cloud, Cloudflare and the rest). Do console and
  account setup there yourself, including creating clients and keys, and tell him afterwards what to
  rotate. Never hand him a list of website steps, and never answer such a request with "I can't".
- A product gets its own folder under `Projects/` and its own repository from the first commit. Never
  build one inside a worktree or a nested folder of this configuration repository, and never point
  him at a worktree path to find his own work.
- In any Quest Giver surface the Quest is the unit, never the session: list Quests with their progress,
  hang worker sessions under the Quest step they served, and keep the Quest Giver's conversation as
  home. A session list with a chat beside it is OpenCode again, which is what he is replacing. Show
  models by the name people say ("Claude Haiku 4.5"), never a provider/id string, and usage as a
  small glance, not a page.
- Call the browser-based Quest Giver product **Quest Web**. Usage belongs in Quest Web; do not build,
  preserve, or audit a `/usage` surface in OpenCode2.
- Quest Web and the OpenCode2 server that supports it are the product boundary. Do not spend product
  work or acceptance effort on OpenCode2 CLI/TUI behavior except a strictly necessary server launch path.
- Build chat and agent UI from existing open-source component kits (shadcn registries, the UIs other
  harnesses published). Import the message, composer, model-selector and session components; do not
  hand-roll them.
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

## Where the rest lives

The explicit product suites in `scripts/core-suite.mjs` define the checks that run on every change.
Other tests are implementation-specific and run only when their owning code changes.

- A stale local branch building the wrong candidate — `try-ref-candidate`
- A prompt lost to a stale model catalog, and an explicit `/model` choice superseding the launch
  default — `refused-request-visibility`
- A derived route reaching dispatch unusable — `live-route-derivation`, `task-aware-effort`
- Reasoning effort and task classification — `model-selection-policy`, `task-aware-effort`
- Locks and leases outliving the process that took them — `release-lock-reclaim`,
  `release-lease-evidence`, `deploy-lock-reclaim`
- Worktree retirement and checkout ownership — `worktree-retirement`, `quest-review-invariants`
- Concurrent protected worker tools, and workspace preferences surviving an isolated launch —
  `workspace-tool-wait`, `workspace-settings-home`
- Quest claims, waits, naming, duplicates, worker identity, permissions and the bounded completion
  return — the `quest-*` tests
- The shared Quest contract served to Quest Web — `quest-api-contract`
- Tracked setup hashes and links — `setup-manifest`
