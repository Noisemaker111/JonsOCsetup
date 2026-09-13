# OpenCode hub

You are looking at the OpenCode ecosystem on this machine. `source/` is the current JonsOCsetup repository. `config/` retains the installed runtime and historical checkout for inspection. Plain `oc` prepares committed `agents` code without switching that historical checkout.

| Folder | Real path | What it is |
|---|---|---|
| `source/` | `~/Projects/JonsOCsetup` | Current source on `agents`. Make changes in an owned worktree inside this repository. |
| `config/` | `~/.config/opencode` | Installed runtime registry, snapshots and historical checkout. Inspect here; do not implement changes here. |
| `data/` | `~/.local/share/opencode` | Host data: sessions and messages in `opencode.db` (sqlite), `log/`, `tool-output/`, `auth.json`. Read to debug. Never hand-edit. |
| `state/` | `~/.local/state/opencode` | State our plugins write: usage cache, orchestration ledger, `plugin-health.json`, requests. Evidence, not source. |
| `quests/` | `~/.opencode` | Historical standalone Quest ledger. Managed `oc` and the shared API use `config/.channels/state/dev/quests`; preserve both histories. |
| `host/` | npm global `@opencode-ai/cli` | The `opencode2` binary that is actually running. Read-only. |
| `upstream/` | `~/Projects/opencode2` (branch v2) | anomalyco/opencode source for the host we run. Read it to learn how plugins, slots, tools, hooks and instructions load. **Never edit, never commit, never open PRs from here.** |
| `upstream-v1/` | `~/Projects/opencode1` (branch dev) | v1 source, comparison only. Same rule. |
| `agents-shared/` | `~/.agents` | Skills shared by Codex and OpenCode, plus `matt-pocock.md` on skill selection. |

Sibling experiments `~/.config/opencode-*` (claude-harness, scope-*) are separate repos with their own AGENTS.md; they are not linked here and are not the live config.

## Rules

- Work from `source/` in an owned worktree. Its `AGENTS.md`, package scripts and current code are authoritative. Preserve dirty historical checkouts; never reset them to repair source selection. Implementation belongs in Jon's repositories, using the installed host's supported extension APIs. Never contribute upstream or create or install a patched OpenCode fork.
- `source/AGENTS.md` is injected into every OpenCode session in every project. It stays a few lines of personal policy. Anything about how OpenCode itself is built belongs here, in a skill, in an agent prompt or in `source/docs/`.
- Launch conversations at this hub root so this file loads. Shell implementation work belongs in the owned JonsOCsetup worktree; do not switch a shared checkout. PowerShell shortcuts: `oh` cds here, `ohc` opens Codex, `ohcc` opens Claude Code. `oc` opens OpenCode here by default; `oc <branch>` runs that branch's code and `oc --here` uses the current directory.
- Verify every change by inspecting project logic and driving the actual product through the same controls the user uses; repeat the operation and reopen its saved result. Keep only a small core suite that directly exercises consequential production invariants. Core/build/type checks supplement actual product use. Before completion, search every source and instruction for replaced behavior and remove superseded code, registrations and obsolete fallbacks. This pre-user project has no backward-compatibility requirement. Preserve real data and active sessions.

## Extending OpenCode

Load `source/skills/opencode/SKILL.md` first. It holds the brick invariants (the ways a plugin silently stops loading), the promotion command and the gates. For TUI work also load `source/skills/opencode-tui/SKILL.md` and the `opentui` skill. Where each kind of change lives:

- **New screen or TUI chrome**: component in the owner's `tui-active/*.tsx` (`source/usage/`, `source/quest/`), a shim at `source/tui-bootstrap/<name>/tui.tsx`, the directory listed in `source/cli.json` `plugins`. Mount through `Plugin.define({ id, setup })` and `context.ui.slot`; keys through `keymap.layer()` from a mounted component; screens through `ui.router.navigate({ type: "plugin" })`.
- **New agent**: `source/agent/<name>.md` with frontmatter (`description`, `mode`, `model`, `permission`) and a short prompt. `quest-giver.md` is the pattern.
- **New server plugin, tool or hook**: `<owner>/server.ts` under `source/`, registered in `source/plugin-set.json` (`serverEntrypoints`, `entrypointOwners`), loaded by `source/plugin-bootstrap` through the active generation. Hooks in use: `context` (push `systemPart(text)` objects, never raw strings) and `http.request`; pre-tool interception is the host's `tool.execute.before` event, see `upstream/packages/plugin`. Expose concrete typed tools; Code Mode composes them, so no generic do-anything tools.
- **Custom models, providers, routing**: provider blocks in `source/opencode.jsonc` (declare `limit: { context, output }` for providers the catalog does not know), the `source/models/` plugin, `source/cliproxyapi/` for the proxy, `source/skills/model-routing` for policy.
- **New workflow**: a skill at `source/skills/<name>/SKILL.md` whose description says when it applies, or Quest steps (`source/quest/`, `source/skills/workspace-flow`). Harnesses that drive other coding CLIs live in `source/harnesses/`.
- **Things to remember**: one line in `source/AGENTS.md` only if it must hold in every project. Otherwise this file, or the skill that owns the topic.
- **Integrate and activate**: follow `source/docs/development-workflow.md` for the managed channel, its acceptance evidence, and the actual selected source. Low-level `plugin-deploy.ts` builds a local generation; it does not publish mirrors or prove that a running terminal loaded it.

## Debugging a session

- Managed `oc` sessions: `config/.channels/state/dev/host.db`; its Quests: `config/.channels/state/dev/quests/.opencode/quests/`. `data/opencode.db` and `quests/` contain historical standalone sessions and work, not the current channel board. Preserve both histories.
- Plugin load or activation failures: `state/plugin-health.json`, `config/run/runtime/`, `config/plugin-activation.json` evidence block.
- Managed Quest runs and workers: `config/.channels/state/dev/quests/`, `config/.channels/state/dev/orchestration.jsonl`, `source/docs/worker-recovery.md`.
- How the host actually behaves: read `upstream/packages/core/src` and `upstream/packages/plugin`, then confirm against `host/` since the installed beta can lag the branch.

## OpenCode2 dev ownership

Jon authorizes Codex and OpenCode2 agents to own the complete dev loop: implement
in an isolated worktree, use the actual app, inspect results, push a ready PR to
`agents`, merge it after verification, and exercise the result in OpenCode.
Call development `agents` in conversation; runtime channel keys, generations and command
arguments are internal details. Never say "release" to Jon at all, and never mention the stable
or main branch: he raises promotion himself and does it himself, so an agent bringing it up is
wrong as a stage, an offer or an aside. Say "merged into agents and tested in OpenCode".
Queue the merge with `gh pr merge <number> --auto --merge` instead of merging directly. `agents`
requires the `core` check and no review, so GitHub performs the merge itself the moment the run
goes green: nothing waits on a run, and no agent asks Jon to press the button.
Do not stop at "mergeable", ask Jon to merge, or request the same dev approval
again. This project-specific standing authorization overrides generic instructions
to ask before every merge. Infer routine implementation and cleanup decisions
from the request and finish the authorized work. Stable promotion, production
changes, host updates and public package publishing still need explicit instruction.

## Shared memory

OpenCode, Codex and Claude follow `C:/Users/Jk101/.agents/user-verification.md`. Resolve the controls needed to use the actual product before claiming verification.

Read `MEMORY.md` at this hub root at the beginning of work and after context loss. Every harness --
Codex, Claude Code and the OpenCode2 Quest Giver -- reads and writes this one file, so anything
another harness needs belongs here rather than in a harness's private memory.

Before writing a line here, ask what else could hold it, because almost always something can.
A claim about how this code behaves belongs in a core test, which fails when it stops being true
and carries the incident in its `@core-observed` block; a project's conventions and commands
belong in that project's AGENTS.md, where they load only when you are there; a number you could
recompute belongs in the script that recomputes it. What is left, and all that belongs here, is
how to work with Jon, facts about the world outside this repository, and an API no test guards.
`test/shared-memory-index.test.ts` fails when this file names a core test that no longer exists,
so knowledge moved out of it cannot quietly become knowledge lost, and `setup:sync` reports its
size so growth is visible and judged. Never cap it: a ceiling on characters refuses a line that
earns its place. Prefer correcting an entry to appending near it. Read before editing, merge existing knowledge, correct stale entries, then reopen the saved file. Quests keep task plans and progress. Do not store secrets, transcripts or unsupported claims; memory never grants permission. Use ordinary file tools, not an every-turn injection hook.

Follow agents-and-main for this repository: agents is the integration branch and main is stable. Use sb agents only in owned checkouts; keep worker changes in isolated worktrees. Only Jon personally merges main, and release preparation starts only when he asks. The dev runtime channel retains its isolated state and sessions. Detailed policy: the selected release's docs/development-workflow.md.

## File intent before acting on it

When Jon states something he wants, file it as a draft Quest **before** you start work on it, in
the same turn he says it:

    bun ~/.agents/quest.mjs file "<outcome, not activity>" "<what he actually asked for>" [step]...

This is not bookkeeping. Your session is not durable: when it ends or compacts, anything not on the
board is gone, and Jon has to notice the gap and say it again. That has already happened — the bad
Quest titles, project_route's latency, the runaway executes and Code Mode batching all sat in chat
until he raised them a second time.

File it even when you are about to do it immediately, because "about to" is where things get
dropped when something more urgent arrives. Archive it when it is done; a finished Quest costs
nothing and a lost one costs the conversation.

The same CLI is the whole loop, from any harness, against the one ledger -- `quest.mjs help` lists
it. Take a step before working it so nobody doubles up, report against it as you go, and hand it
back or finish it:

    list [--mine|--open|--blocked] [--project .]   read <id>   who
    claim <id> <step>   progress <id> <step> "<note>"   evidence <id> <step> "<cmd>" --result passed
    done <id> <step> "<note>"   block <id> <step> "<reason>"   release <id> <step>

`claim` exits 3 without taking anything while another agent holds that step, and `--json` is on
every command. `quest-draft.mjs` still files, as an alias for `quest.mjs file`.

`quest start <id>` saves a durable start request on the same configured board as `oc`. The connected OpenCode adapter dispatches the saved steps without a giver model turn. If OpenCode is closed, the request remains queued until it opens. Repeating start returns the existing admission. Save task, optional exact model, concurrency and delivery with the Quest workflow; the id-only start reads them. An explicit `OPENCODE_QUEST_ROOT` keeps isolated checks and intentional alternate boards separate.

## Say whether you traced it or inferred it

A cause is only **traced** when you have followed it to the line that does it — the function, its
caller, the symbol grepped in `upstream/` or `source/`. Anything else is **inferred**: a story that
fits what you observed. Both are useful. They are not interchangeable, and to Jon they read
identically unless you say which.

So when a claim names a mechanism — X switches, recovers, falls back, drops, retries — it carries a
`file:line` or it is labelled as inference. Two adjacent lines in a TUI capture are an observation,
not a mechanism: "usage limit reached" above "switched agent to Build" produced a confident,
repeated, wrong explanation that survived into a commit message, a PR body, a Quest and MEMORY.md
before one grep of the literal string "Switched agent" disproved it in thirty seconds.

The tell is that the story felt complete. A complete-feeling explanation is exactly when nothing is
nagging you to check, which is exactly when you have not.

The damage is propagation, not the mistake. Write a finding **once**, on the Quest, and reference it
from everywhere else. Then a correction is one edit rather than four, and nobody builds on the
version you already knew was wrong.

## Reporting to Jon

Bullets, not paragraphs. No tables. One line per point, with the tradeoff on the line itself. Never
a hidden objective or a menu of options he has to choose from.

**A report ends a turn; it never interrupts one.** If you can name the next action, take it. Writing
"what I am doing next" and stopping is the failure this section used to cause: a tidy summary was
available, so the turn ended, and Jon had to say "continue" to get work that was already decided.
The only reasons to stop are that the work is finished, that it is genuinely blocked on something
only he can supply, or that proceeding would be unsafe, irreversible or spend real money against his
wishes. Running out of things to say is not one of them.

So the shape of a turn is: do the work, then say what happened. Something running in the background
is work in progress, not a stopping point -- keep going while it runs.

Say what is still wrong, including anything he has to do himself, but say it at the end of real work
rather than in place of it.
