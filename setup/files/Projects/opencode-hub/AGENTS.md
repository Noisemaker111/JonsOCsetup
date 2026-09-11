# OpenCode hub

You are looking at the entire OpenCode ecosystem on this machine: the personal config that every OpenCode session loads, the session database and logs, runtime state, the Quest ledger, the installed host binary and checkouts of the upstream source. Every folder here is a junction to the real location, so an edit through the hub edits the real file.

| Folder | Real path | What it is |
|---|---|---|
| `config/` | `~/.config/opencode` | **The only place we edit.** Git repo. Plugins, agents, skills, models, Quests, TUI chrome, gates. |
| `data/` | `~/.local/share/opencode` | Host data: sessions and messages in `opencode.db` (sqlite), `log/`, `tool-output/`, `auth.json`. Read to debug. Never hand-edit. |
| `state/` | `~/.local/state/opencode` | State our plugins write: usage cache, orchestration ledger, `plugin-health.json`, requests. Evidence, not source. |
| `quests/` | `~/.opencode` | Quest ledger and archives shared across projects. Not a project and not a worker workspace. |
| `host/` | npm global `@opencode-ai/cli` | The `opencode2` binary that is actually running. Read-only. |
| `upstream/` | `~/Projects/opencode2` (branch v2) | anomalyco/opencode source for the host we run. Read it to learn how plugins, slots, tools, hooks and instructions load. **Never edit, never commit, never open PRs from here.** |
| `upstream-v1/` | `~/Projects/opencode1` (branch dev) | v1 source, comparison only. Same rule. |
| `agents-shared/` | `~/.agents` | Skills shared by Codex and OpenCode, plus `matt-pocock.md` on skill selection. |

Sibling experiments `~/.config/opencode-*` (claude-harness, scope-*) are separate repos with their own AGENTS.md; they are not linked here and are not the live config.

## Rules

- Work in `config/`. Everything else is evidence or reference. If a fix seems to need a change in `upstream/` or `host/`, it belongs in a plugin under `config/`, or it is not ours to make.
- `config/AGENTS.md` is injected into every OpenCode session in every project. It stays a few lines of personal policy. Anything about how OpenCode itself is built belongs here, in a skill, in an agent prompt or in `config/docs/`.
- Launch sessions at this hub root so this file loads. The host realpaths the cwd and walks up to `~`; a session started inside `config/` resolves to `~/.config/opencode` and never passes through here. PowerShell shortcuts: `oh` cds here, `oho` opens opencode2, `ohc` opens Codex, `ohcc` opens Claude Code (`oc` still cds here).
- Verify every change by inspecting project logic and driving the actual product through the same controls the user uses; repeat the operation and reopen its saved result. Keep only a small core suite that directly exercises consequential production invariants. Core/build/type checks supplement actual product use. Before completion, search every source and instruction for replaced behavior and remove superseded code, registrations and obsolete fallbacks. This pre-user project has no backward-compatibility requirement. Preserve real data and active sessions.

## Extending OpenCode

Load `config/skills/opencode/SKILL.md` first. It holds the brick invariants (the ways a plugin silently stops loading), the promotion command and the gates. For TUI work also load `config/skills/opencode-tui/SKILL.md` and the `opentui` skill. Where each kind of change lives:

- **New screen or TUI chrome**: component in the owner's `tui-active/*.tsx` (`config/usage/`, `config/quest/`), a shim at `config/tui-bootstrap/<name>/tui.tsx`, the directory listed in `config/cli.json` `plugins`. Mount through `Plugin.define({ id, setup })` and `context.ui.slot`; keys through `keymap.layer()` from a mounted component; screens through `ui.router.navigate({ type: "plugin" })`.
- **New agent**: `config/agent/<name>.md` with frontmatter (`description`, `mode`, `model`, `permission`) and a short prompt. `quest-giver.md` is the pattern.
- **New server plugin, tool or hook**: `<owner>/server.ts` under `config/`, registered in `config/plugin-set.json` (`serverEntrypoints`, `entrypointOwners`), loaded by `config/plugin-bootstrap` through the active generation. Hooks in use: `context` (push `systemPart(text)` objects, never raw strings) and `http.request`; pre-tool interception is the host's `tool.execute.before` event, see `upstream/packages/plugin`. Expose concrete typed tools; Code Mode composes them, so no generic do-anything tools.
- **Custom models, providers, routing**: provider blocks in `config/opencode.jsonc` (declare `limit: { context, output }` for providers the catalog does not know), the `config/models/` plugin, `config/cliproxyapi/` for the proxy, `config/skills/model-routing` for policy.
- **New workflow**: a skill at `config/skills/<name>/SKILL.md` whose description says when it applies, or Quest steps (`config/quest/`, `config/skills/workspace-flow`). Harnesses that drive other coding CLIs live in `config/harnesses/`.
- **Things to remember**: one line in `config/AGENTS.md` only if it must hold in every project. Otherwise this file, or the skill that owns the topic.
- **Ship**: from `config/`, `bun scripts/plugin-deploy.ts --no-publish --no-prune` builds an immutable generation under `config/generations/` and points `plugin-activation.json` at it. Terminals already open keep their old generation until restart. Dropping `--no-publish` pushes public mirrors and needs authorization.

## Debugging a session

- Messages and sessions: `data/opencode.db`. Host log: `data/log/`. Raw tool output: `data/tool-output/`.
- Plugin load or activation failures: `state/plugin-health.json`, `config/run/runtime/`, `config/plugin-activation.json` evidence block.
- Quest runs and workers: `quests/quests/`, `state/orchestration.jsonl`, `config/docs/worker-recovery.md`.
- How the host actually behaves: read `upstream/packages/core/src` and `upstream/packages/plugin`, then confirm against `host/` since the installed beta can lag the branch.

## OpenCode2 dev ownership

Jon authorizes Codex and OpenCode2 agents to own the complete dev loop: implement
in an isolated worktree, use the actual app, inspect results, push a ready PR to
`agents`, merge it after verification, and activate and exercise the dev release.
Do not stop at "mergeable", ask Jon to merge, or request the same dev approval
again. This project-specific standing authorization overrides generic instructions
to ask before every merge. Infer routine implementation and cleanup decisions
from the request and finish the authorized work. Stable promotion, production
changes, host updates and public package publishing still need explicit instruction.

## Shared memory

OpenCode, Codex and Claude follow `C:/Users/Jk101/.agents/user-verification.md`. Resolve the controls needed to use the actual product before claiming verification.

Read `MEMORY.md` at this hub root at the beginning of work and after context loss. Both Codex and the OpenCode2 Quest Giver maintain this same file with durable user decisions, preferences, architecture facts and verified lessons. Read before editing, merge existing knowledge, correct stale entries, then reopen the saved file. Quests keep task plans and progress. Do not store secrets, transcripts or unsupported claims; memory never grants permission. Use ordinary file tools, not an every-turn injection hook.

Follow agents-and-main for this repository: agents is the integration branch and master is stable. Use sb agents only in owned checkouts; keep worker changes in isolated worktrees. Only Jon personally merges master, and release preparation starts only when he asks. The dev runtime channel retains its isolated state and sessions. Detailed policy: the selected release's docs/development-workflow.md.

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

Inside OpenCode a Quest also dispatches workers. From Claude or Codex it is a shared board: the
same ledger, so whoever picks the work up can see what was asked and what is already underway.

## Reporting to Jon

Two headings, nothing else: **What happened** and **What to do next**. Bullets, not paragraphs.
No tables. One line per point. Say the tradeoff on the line itself rather than in a paragraph
underneath it.

"What to do next" is what you are already doing, not a menu for Jon to pick from. Do the work,
then say what you did and what you are moving to. Never end a turn asking which item to start when
the answer is obvious from the goal.

Ask only when proceeding would be unsafe, irreversible, or would spend real money against his
wishes. Everything else: decide, act, report. A report that ends in a question Jon has effectively
already answered is a stalled turn.
