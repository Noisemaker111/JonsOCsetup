---
name: opencode
description: Use when working on the OpenCode config repo (~/Projects/JonsOCsetup) — plugins, TUI chrome, harnesses, quota/failover, Quests, or promoting a generation. Holds the brick invariants and the deploy gate.
---

# OpenCode config / plugin work

Internals for this repo only. Global rules stay in `AGENTS.md`, which every OpenCode session in every project loads because the host reads `<config dir>/AGENTS.md` and this repository is the config dir. Repository-only guidance is here.

## The ecosystem on this machine

`~/Projects/JonsOCsetup` (this repository, branch `agents`) is the source of truth and the hub: `oh` cds here, `ohc` opens Codex here, `ohcc` opens Claude Code here, `oc` launches OpenCode here on committed `agents` code, `oc <branch>` runs that branch and `oc --here` uses the current directory. Make changes in an owned worktree inside this repository.

| Real path | What it is |
|---|---|
| `~/.config/opencode` | Installed configuration, runtime registry and snapshots. Inspect here; edit the maintained source in this repository. Not a source checkout: never initialize Git there again. Preserve dirty historical checkouts under it; never reset them to repair source selection. |
| `~/.local/share/opencode` | Host data: sessions and messages in `opencode.db` (sqlite), `log/`, `tool-output/`, `auth.json`. Read to debug. Never hand-edit. |
| `~/.local/state/opencode` | State our plugins write: usage cache, orchestration ledger, `plugin-health.json`, requests. Evidence, not source. |
| `~/.opencode` | Historical standalone Quest ledger. Managed `oc` and the shared API use `~/.config/opencode/.channels/state/dev/quests`; preserve both histories. |
| npm global `@opencode-ai/cli` | The `opencode2` binary that is actually running. Read-only. |
| `~/Projects/opencode2` (branch v2) | anomalyco/opencode source for the host we run. Read it to learn how plugins, slots, tools, hooks and instructions load. **Never edit, never commit, never open PRs from here.** |
| `~/Projects/opencode1` (branch dev) | v1 source, comparison only. Same rule. |
| `~/.agents` | Skills shared by Codex and OpenCode, plus `matt-pocock.md` on skill selection. |

OpenCode configuration (`opencode.jsonc`, `cli.json`), agents, skills and plugins are maintained directly here. `setup/files/` captures other installed settings; it is not a complete mirror of `~/.config/opencode`. Implementation belongs in Jon's repositories, using the installed host's supported extension APIs. Never contribute upstream or create or install a patched OpenCode fork.

Verify every change by inspecting project logic and driving the actual product through the same controls the user uses; repeat the operation and reopen its saved result. Keep only a small core suite that directly exercises consequential production invariants. Core/build/type checks supplement actual product use. Before completion, search every source and instruction for replaced behavior and remove superseded code, registrations and obsolete fallbacks. This pre-user project has no backward-compatibility requirement. Preserve real data and active sessions.

## Extending OpenCode

For TUI work also load `skills/opencode-tui/SKILL.md` and the `opentui` skill. Where each kind of change lives:

- **New screen or TUI chrome**: component in the owner's `tui-active/*.tsx` (`usage/`, `quest/`), a shim at `tui-bootstrap/<name>/tui.tsx`, the directory listed in `cli.json` `plugins`. Mount through `Plugin.define({ id, setup })` and `context.ui.slot`; keys through `keymap.layer()` from a mounted component; screens through `ui.router.navigate({ type: "plugin" })`.
- **New agent**: `agent/<name>.md` with frontmatter (`description`, `mode`, `model`, `permission`) and a short prompt. `quest-giver.md` is the pattern.
- **New server plugin, tool or hook**: `<owner>/server.ts`, registered in `plugin-set.json` (`serverEntrypoints`, `entrypointOwners`), loaded by `plugin-bootstrap` through the active generation. Hooks in use: `context` (push `systemPart(text)` objects, never raw strings) and `http.request`; pre-tool interception is the host's `tool.execute.before` event, see `~/Projects/opencode2/packages/plugin`. Expose concrete typed tools; Code Mode composes them, so no generic do-anything tools.
- **Custom models, providers, routing**: provider blocks in `opencode.jsonc` (declare `limit: { context, output }` for providers the catalog does not know), the `models/` plugin, `cliproxyapi/` for the proxy, `skills/model-routing` for policy.
- **New workflow**: a skill at `skills/<name>/SKILL.md` whose description says when it applies, or Quest steps (`quest/`, `skills/workspace-flow`). Harnesses that drive other coding CLIs live in `harnesses/`.
- **Things to remember**: one line in root `AGENTS.md` only if it must hold in every project. Otherwise this skill, or the skill that owns the topic.
- **Integrate and activate**: follow `docs/development-workflow.md` for the managed channel, its acceptance evidence, and the actual selected source. Low-level `plugin-deploy.ts` builds a local generation; it does not publish mirrors or prove that a running terminal loaded it.

## Debugging a session

- Managed `oc` sessions: `~/.config/opencode/.channels/state/dev/host.db`; its Quests: `~/.config/opencode/.channels/state/dev/quests/.opencode/quests/`. `~/.local/share/opencode/opencode.db` and `~/.opencode` contain historical standalone sessions and work, not the current channel board. Preserve both histories.
- Plugin load or activation failures: `~/.local/state/opencode/plugin-health.json`, `~/.config/opencode/run/runtime/`, `~/.config/opencode/plugin-activation.json` evidence block.
- Managed Quest runs and workers: `~/.config/opencode/.channels/state/dev/quests/`, `~/.config/opencode/.channels/state/dev/orchestration.jsonl`, `docs/worker-recovery.md`.
- How the host actually behaves: read `~/Projects/opencode2/packages/core/src` and `~/Projects/opencode2/packages/plugin`, then confirm against the installed `@opencode-ai/cli` since the installed beta can lag the branch.

## Development ownership

Jon authorizes Codex, Claude Code and OpenCode2 agents to own the complete dev loop: implement in an isolated worktree, use the actual app, inspect results, push a ready PR to `agents`, merge it after verification, and exercise the result in OpenCode. Follow `docs/development-workflow.md` for every change. Call development `agents` in conversation; runtime channel keys, generations and command arguments are internal details. Never say "release" to Jon at all, and never mention the stable or main branch: he raises promotion himself and does it himself, so an agent bringing it up is wrong as a stage, an offer or an aside. Say "merged into agents and tested in OpenCode". Queue the merge with `gh pr merge <number> --auto --merge` instead of merging directly. `agents` requires the `core` check and no review, so GitHub performs the merge itself the moment the run goes green: nothing waits on a run, and no agent asks Jon to press the button. Do not stop at "mergeable", ask Jon to merge, or request the same dev approval again. This project-specific standing authorization overrides generic instructions to ask before every merge. Infer routine implementation and cleanup decisions from the request and finish the authorized work. Stable promotion, production changes, host updates and public package publishing still need explicit instruction. Exercise the real flow twice and inspect captures and saved outcomes; synthetic providers are not acceptance evidence.

Follow agents-and-main for this repository: agents is the integration branch and main is stable. Use `sb agents` only in owned checkouts; keep worker changes in isolated worktrees. Only Jon personally merges main, and release preparation starts only when he asks. The dev runtime channel retains its isolated state and sessions.

## Shared memory

OpenCode, Codex and Claude follow `~/.agents/user-verification.md`. Resolve the controls needed to use the actual product before claiming verification.

Read root `MEMORY.md` at the beginning of work and after context loss. Every harness -- Codex, Claude Code and the OpenCode2 Quest Giver -- reads and writes this one file, so anything another harness needs belongs there rather than in a harness's private memory.

Before writing a line there, ask what else could hold it, because almost always something can. A claim about how this code behaves belongs in a core test, which fails when it stops being true and carries the incident in its `@core-observed` block; a project's conventions and commands belong in that project's AGENTS.md, where they load only when you are there; a number you could recompute belongs in the script that recomputes it. What is left, and all that belongs there, is how to work with Jon, facts about the world outside this repository, and an API no test guards. `test/shared-memory-index.test.ts` fails when that file names a core test that no longer exists, so knowledge moved out of it cannot quietly become knowledge lost, and `setup:sync` reports its size so growth is visible and judged. Never cap it: a ceiling on characters refuses a line that earns its place. Prefer correcting an entry to appending near it. Read before editing, merge existing knowledge, correct stale entries, then reopen the saved file. Quests keep task plans and progress. Do not store secrets, transcripts or unsupported claims; memory never grants permission. Use ordinary file tools, not an every-turn injection hook.

## File intent before acting on it

When Jon states something he wants, file it as a draft Quest **before** you start work on it, in the same turn he says it: the `quests.create` MCP operation in OpenCode Code Mode, or the installed `quest create` command (`quest create --help` describes its generated arguments).

This is not bookkeeping. Your session is not durable: when it ends or compacts, anything not on the board is gone, and Jon has to notice the gap and say it again. That has already happened -- the bad Quest titles, project_route's latency, the runaway executes and Code Mode batching all sat in chat until he raised them a second time.

File it even when you are about to do it immediately, because "about to" is where things get dropped when something more urgent arrives. Archive it when it is done; a finished Quest costs nothing and a lost one costs the conversation.

The API exposes list, get, create, update, start, run and wait through generated CLI commands and MCP operations. `quest --help` lists them; results are JSON. Standard MCP clients use command `quest` with argument `mcp`. Record step progress and deliverables through update. The runtime owns assignment and workspace coordination. Use these public interfaces, never implementation file paths or direct ledger writes.

`quest start <id>` saves a durable start request on the same board as `oc`, without a giver planning turn. OpenCode must be running to accept calls; accepted requests survive restart. Repeating start returns the existing admission. Save task, optional exact model, concurrency, readOnly and delivery on the Quest workflow. The giver stays in this repository; the runtime maps its reviewed source for research and owned editing workspaces. `QUEST_API_REGISTRY` selects an intentional alternate service.

## Say whether you traced it or inferred it

A cause is only **traced** when you have followed it to the line that does it -- the function, its caller, the symbol grepped in `~/Projects/opencode2` or here. Anything else is **inferred**: a story that fits what you observed. Both are useful. They are not interchangeable, and to Jon they read identically unless you say which.

So when a claim names a mechanism -- X switches, recovers, falls back, drops, retries -- it carries a `file:line` or it is labelled as inference. Two adjacent lines in a TUI capture are an observation, not a mechanism: "usage limit reached" above "switched agent to Build" produced a confident, repeated, wrong explanation that survived into a commit message, a PR body, a Quest and MEMORY.md before one grep of the literal string "Switched agent" disproved it in thirty seconds.

The tell is that the story felt complete. A complete-feeling explanation is exactly when nothing is nagging you to check, which is exactly when you have not.

The damage is propagation, not the mistake. Write a finding **once**, on the Quest, and reference it from everywhere else. Then a correction is one edit rather than four, and nobody builds on the version you already knew was wrong.

## Reporting to Jon

Bullets, not paragraphs. No tables. One line per point, with the tradeoff on the line itself. Never a hidden objective or a menu of options he has to choose from.

**For a Quest report, replace prose bullets with one fixed stack: `STATE | NAME | NEXT`.** Put one Quest on each line with those three fields in that order. `STATE` is exactly one of `RUNNING`, `QUEUED`, `NEEDS YOU`, or `DONE`. Order the stack `NEEDS YOU`, `RUNNING`, `QUEUED`, then one `DONE` line giving the completed count. Every Quest has a concrete `NEXT` because no Quest may sit without one. End the report with exactly one `NEXT` line stating the giver's next action. Use no emoji, bullet prose, history, reasons, or evidence, and report nothing else unless Jon asks. Never fold an action item into a sentence; keep the tradeoff on the same line as its point. Use this form wherever Jon reads Quest lists, including handoffs and completion summaries; it does not change machine return payloads.

**A report ends a turn; it never interrupts one.** If you can name the next action, take it. Writing "what I am doing next" and stopping is the failure this section used to cause: a tidy summary was available, so the turn ended, and Jon had to say "continue" to get work that was already decided. The only reasons to stop are that the work is finished, that it is genuinely blocked on something only he can supply, or that proceeding would be unsafe, irreversible or spend real money against his wishes. Running out of things to say is not one of them.

So the shape of a turn is: do the work, then say what happened. Something running in the background is work in progress, not a stopping point -- keep going while it runs.

Say what is still wrong, including anything he has to do himself, but say it at the end of real work rather than in place of it.

## Host identity

Use the shared `project-router/executable.mjs` resolver for every OpenCode2 launch and host check. Never hardcode an npm package executable path or silently use another installed beta. `bun run runtime:host` reports the selected native executable and version; include that identity separately from the plugin generation in integration evidence. The `host/` junction is reference material, not executable-selection authority. Conflicting launchers or overrides must fail explicitly.

## Scope and maintenance

This skill applies only when editing this configuration repository or its plugins.
The global AGENTS.md is also loaded in other projects; never put this repo's
commands, model preferences or implementation details into that overlay.
Read README.md and docs/instruction-scope.md for the scope map and current limitations.

- Inspect focused Git status and preserve existing edits. If node_modules is missing, run bun install here before package checks.
- Inspect the loaded Quest tool schema: source now registers list/get/create/update/run in Code Mode. Older running generations may expose the legacy schema. Report actual step results; never manufacture proof.
- V2 run manages owned worktrees under the owning project and verifies the host session directory before prompting. Preserve dirty or unintegrated workspaces. A configured policy, project bootstrap and supported host adapter are required; source tests do not prove a running generation has adopted them.
- Save verified changes in focused local commits. Publishing requires explicit authorization, which remains valid for the action already authorized.
- Respect configured dispatch and access policy. Access rules are fail-closed data; the live spawn guard no longer silently selects fallbacks. Historical scoring helpers are not authority for user model or billing preferences.
- A persisted Quest or saved dispatch is not proof of a running worker. Check the owned runtime's actual outcome and explain failures.

## Ownership boundaries

- One plugin is one self-contained owned directory in JonsOCsetup. There are no separate mirror repositories.
  The directory names its owner (`models/`, `usage/`, `orchestration/` (owned by quests),
  `quest/`, `harnesses/`, `papercut/`). Cross-plugin imports may use only a
  surface declared in `plugin-set.json` or a surface vendored/published by the
  second owner; discovery shims must be classified by `entrypointOwners`.

## Brick invariants

Break one of these and the host stops loading plugins, usually silently.

- **System pushes are objects.** `event.system.push(systemPart(text))` or
  `{ type: "text", text }`. A raw string fails opencode2 schema validation.
- **TUI modules export `Plugin.define({ id, setup })`.** A default
  `{ id, tui }` without `setup` is rejected as *Invalid V2 TUI plugin module*.
  `cli.json` `plugins` entries are **directories** resolved as `<dir>/tui.tsx`
  (`tui-bootstrap/<name>/tui.tsx`); an entry naming a file is skipped silently.
- **Host event and tool facts (19059).** A backgrounded `subagent` returns
  `The subagent is working in the background (sessionID: ses_x)…`; turn ends
  are `session.execution.succeeded|failed|interrupted` (no `.cancelled`);
  `message.updated` carries `info.{sessionID, providerID, modelID, agent}`.
- **Verify the installed host and SDK separately.** Read package.json and the isolated host receipts; do not assume a version from this skill is current. The observations below describe previously tested host contracts. Re-exercise affected operations in the installed app after host updates.
- **Chrome mounts via `context.ui.slot({ <placement>: "<slot>", render })`**,
  where placement is exactly one of `prepend` `append` `before` `after`
  `replace` — two or none throws *Slot claim requires exactly one placement
  key*. `context.slots.register` is gone: live log,
  `undefined is not an object (evaluating 'context.slots.register')`.
- **Slot names are dotted**, from the host's own renderer calls: `app`,
  `home.footer`, `prompt.footer`, `prompt.footer.file`, `prompt.footer.status`,
  `session.composer.top`, `sidebar.content`, `sidebar.footer`. `app` renders
  nothing itself and is where you mount a component that needs a render
  context; `prompt.footer` is the always-present composer footer;
  `sidebar.content` / `sidebar.footer` are the in-session panel beside
  Subagents and receive `{ sessionID }`.
- **Commands register through `keymap.layer()` from a mounted component.**
  Live keys are `active,commands,dispatch,layer,mode,pending,shortcuts` —
  `registerLayer` is gone. `layer()` reads the Keymap context, so calling it
  from `setup()` throws *Keymap.Provider is missing*; mount a component on the
  `app` slot and call it from there. Slash autocomplete reads
  `command.slash` — an object, `{ name, aliases? }`. The flat `slashName`
  string is gone.
- **`ui.dialog` is `{ alert, clear, confirm, prompt, select, set, show }`** —
  `replace` is gone, and a `typeof dialog.replace !== "function"` guard turns
  every command into a silent no-op. `show(render, onClose?)` is the direct
  replacement. `select({ title, placeholder, options, current })` resolves to
  the chosen `option.value` (or `undefined` when dismissed) and gives
  filtering, scrolling, keyboard and mouse for free; an option is
  `{ value, title, category?, searchText?, details?, description?, footer?,
  disabled? }` and `category` renders as a group header. `confirm({ title,
  message, label })` resolves `true` / `false` / `undefined`.
- **Navigation is `ui.router.navigate(...)`** with `{ type: "home" }`,
  `{ type: "session", sessionID }` or `{ type: "plugin", id, name, data? }`.
  `context.client` is the SDK: `session.create({ title?, agent?, model?,
  location })` returns the session, `session.prompt({ sessionID, text })`
  sends the first turn.
- **No `bun:test` import under `plugins-active/`.** The loader can evaluate
  sibling files and throws *Cannot use test outside of the test runner*.

## Harnesses

A harness drives another coding agent through its CLI. Authentication and billing depend on the configured account; the transport name does not prove subscription coverage or zero marginal cost. `harness-registry.ts`
describes each one (argv for a single non-interactive turn, how to parse the
answer); `plugins-active/harness-run.ts` runs it; the bridge on **3012** serves
all of them behind one OpenAI-compatible endpoint.

- Registered: `claude-code` (claude), `grok-build` (grok), `codex` (codex).
- Each inherits only its own vendor's auth vars — never another's.
- Claude Code keeps the richer path in `claude-code-task.ts` (scope envelope,
  session resume, ledger). Others use the plain path.
- **Windows: npm CLI shims are `.CMD`** and cannot be spawned without a shell
  (`EINVAL`). `windowsBatchLaunch` routes them through `cmd.exe /d /s /c`.
- **The CLI reports API failures in-band and still exits 0.** Check the
  terminal `result` event's `is_error` / `api_error_status` before the exit
  code, or an expired login reads as `provider: exited with code 1` — or worse,
  the error prose is returned as the assistant's answer.
- `--include-partial-messages` emits deltas *and* a terminal result carrying
  the same text. Prefer the terminal result or every answer doubles.
- **SSE events need a blank line between them.** Joining with `\n` produces
  *stream ended without finish_reason*.

## Provider failures

Show the actual failure cause and whether a retry recovered. Authentication,
entitlement, rate limiting and exhausted quota are different failures; HTTP
403 or 429 alone does not prove an exhausted plan. Preserve sanitized details.
Fallback requires the user's policy; do not prescribe an automatic one-hour
lane block or a branded substitute here. Existing failure/fallback code must
be reconciled with docs/quest-cleanup-review.md before claiming this behavior.

## Context limits

Providers OpenCode has no catalog entry for (`grok-sub`, `claude-code`,
`grok-build`, `codex`) **must** declare `limit: { context, output }` per model
in `opencode.jsonc`. Omit it and the host invents a default — which is what
made a 500k Grok model compact at 200k. Do not add a `limit` to a provider the
catalog already knows (e.g. `openai`).

## Integration and runtime selection

Follow [the development workflow](../../docs/development-workflow.md) for candidate preparation, installed-app acceptance, agents integration, and activation. `oc` selects the configured branch or gated version; it does not require replacing the vendor CLI.

`scripts/plugin-deploy.ts` is the low-level local generation builder used by maintenance tooling. Its activation is scoped to the supplied root. It does not publish mirrors; omitting an obsolete `--no-publish` flag does not turn it into a publishing command. Do not use a low-level pointer change as evidence that the managed channel or a running terminal adopted the change.

## Acceptance

Follow the app-use, removal and memory policy in `docs/development-workflow.md`.
Use the installed app for every change, inspect actual output and saved results
after reload, and search for and delete superseded code and instructions before
finishing. Do not create or regenerate test suites, fixtures or old compatibility
paths. Build/type checks supplement actual app use. Root MEMORY.md preserves
durable decisions separately from Quest task progress.
