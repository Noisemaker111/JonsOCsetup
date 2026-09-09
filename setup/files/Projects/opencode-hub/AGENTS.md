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
- Gates run from `config/`: `bun test` and `pwsh -NoProfile -File .\smoke-test.ps1`. Local checks need no permission. Promotion, publish, restart of running sessions and anything outside `config/` need explicit authorization.

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
