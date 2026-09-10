---
name: opencode
description: Use when working on the OpenCode config repo (~/.config/opencode) — plugins, TUI chrome, harnesses, quota/failover, Quests, or promoting a generation. Holds the brick invariants and the deploy gate.
---

# OpenCode config / plugin work

Internals for this repo only. Global rules stay in `AGENTS.md`; the ecosystem map (config, sessions, state, host, upstream source) and the extension guide are `C:\Users\Jk101\Projects\opencode-hub\AGENTS.md`.

## Development ownership

Follow `docs/development-workflow.md` for every OpenCode2 change. The user has
authorized the agent to own coherent commits, ready PRs targeting dev, verified
merges into dev, and dev activation. Do not ask the user to perform technical
review or approve each dev merge. Stable master promotion and mirror publishing
remain separate explicit actions. Exercise the real flow twice and inspect
captures and saved outcomes; synthetic providers are not acceptance evidence.

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

## Promotion

Use README.md for the current managed launch/restart and deployment commands.
Local candidate promotion uses:

```powershell
bun scripts/plugin-deploy.ts --no-publish --no-prune
```

Promotion changes the runtime generation and needs to be within the task's
scope. Omitting --no-publish can push public mirrors; only do that with explicit
publish authorization. Never restart or terminate unrelated running sessions.
Immutable generations are build output; edit source in this checkout.

## Acceptance

Follow the app-use, removal and memory policy in `docs/development-workflow.md`.
Use the installed app for every change, inspect actual output and saved results
after reload, and search for and delete superseded code and instructions before
finishing. Do not create or regenerate test suites, fixtures or old compatibility
paths. Build/type checks supplement actual app use. Root MEMORY.md preserves
durable decisions separately from Quest task progress.
