# Central router runtime scout

2026-09-09 UTC. Assigned step: `central-runtime-scout`, in **Build project-router: one conversational entry point for all projects**. Investigation only; no runtime implementation or activation.

## Finding

The central Giver's missing project tools have a demonstrated configuration split: **the selected plugin generation contains project-router, but ordinary startup still reads the live Giver permission rules**. Those rules deny all tools, then allow `execute`, `quest`, `usage_status`, read/web/question tools, with no `project_*` exceptions. Installing/selecting plugin code does not grant its tools to an agent. This matches the parent-observed central catalog and its independently checked live agent API.

A second, independent mismatch is executable discovery: the ordinary `opencode2` shim now launches `@opencode/cli` beta-19296, while router discovery, managed startup and prior acceptance default to the still-installed `@opencode-ai/cli` beta-19242. Tests against the latter do not establish current-user-host acceptance.

## Evidence and capabilities

- Read hub `AGENTS.md`, checkout `skills/opencode/SKILL.md`, README and instruction-scope documentation. Exposed `patch` satisfies editing capability; `git status --short` established working shell capability. Applying and reading this brief verifies editing. No missing alias blocked work.
- Actual `usage_status({format:"json"})` at 03:35:54 UTC recorded this worker as native `openai/gpt-6-astra`, reasoning/variant `medium`. OpenAI Pro shared pool was 67% remaining, reset 2026-09-15 01:24:10 UTC. Astra availability was reported available, but its model-specific percentage/reset were unknown. No substitute or additional worker was launched.
- Read assigned Quest through `quest get`. Related **Make Quest tool calls recoverable across the hub and project sessions** is hub-owned: this worker's `quest get` correctly rejected its different project. Read its canonical Markdown through the hub's `quests/quests/5a5d85c2bfda95d704cf209ae4--quest.md` read-only. Its four completed steps cover tool/ownership recovery and prior integration; that completion is not current central-host acceptance. No ownership or ledger binding was changed.
- Initial checkout status had staged `quest/runtime.ts`, `test/quest-runtime.test.ts`, and `tmp/central-scout.ts`. These were preserved. The last is the pre-existing coordinator, not a script executed by this scout.
- Live `config/opencode.jsonc:234-249` (hub-relative) has V2 `permissions` with the older deny-all Giver policy and no router grants. “Legacy” here describes the policy, not the syntax.
- Live `config/plugin-activation.json` selects `gen-1788921318839`, source commit `511903d1b84798873dbcb0e8670550a736fd702c`, with a successful deterministic validation-fixture receipt. Its `opencode.jsonc:337-345` grants all nine router tools. This pointer is selected-state evidence, not proof of the central process's loaded module.
- `plugin-bootstrap/index.ts:30-40` resolves/imports selected server entrypoints during setup; it does not apply selected agent configuration. `scripts/runtime-contract.mjs:61-67` separately implements `reviewedAgentConfig`; `scripts/opencode-runtime.mjs:57` applies it as `OPENCODE_CONFIG_CONTENT` only for managed startup.
- `Get-Command opencode2 -All` resolved npm shims. The inspected `.ps1` shim invokes `node_modules/@opencode/cli/bin/opencode2.exe`. That package declares `0.0.0-beta-19296`; invoking that exact executable with `--version` returned `opencode2 v0.0.0-beta-19296`, exit 0. The old package separately declares beta-19242. Hub `host/` still names the older package, so it is insufficient discovery authority.
- Current executable `api --help` confirms `api --standalone`, `--server`, HTTP method/path and OpenAPI operation IDs. `--standalone` is a private server. Read-only `GET /api/agent` probes from this worker returned `{location, data: []}`, both with inherited fixture configuration and with a shell-local live config directory. These short-lived probes did **not** establish the central agent's effective permissions; the parent separately verified those. Do not use an empty short-lived agent list as proof that registration failed.

## Host configuration, catalog and caching

Task-relevant upstream references are relative to the hub:

- `upstream/packages/core/src/config.ts:245-282,285-337`: config documents are rediscovered on watched changes, changed values publish `config.updated`, and `OPENCODE_CONFIG_CONTENT` has highest priority. An inherited content overlay can therefore continue overriding a changed file.
- `upstream/packages/core/src/config/plugin/agent.ts:54-75,88-117`: config updates and agent-source changes are debounced, reload documents, then invoke `ctx.agent.reload()`. Agent permissions append in document order.
- `upstream/packages/core/src/agent.ts:65-108`: agent state rebuild publishes `agent.updated`.
- `upstream/packages/core/src/session/context.ts:122-156`: context selection flushes plugin/MCP setup, resolves the current agent and builds `registry.snapshot(agent.info.permissions)`, including the Code Mode catalog.
- `upstream/packages/core/src/tool.ts:204-229`: wholly disabled tools are filtered before Code Mode catalog/definitions are created. Merely allowing `execute` does not expose otherwise-denied tools.

Read-only binary inspection found `ConfigAgentPlugin.load`, `agent.updated` and `config.updated` strings in beta-19296. It did not recover equivalent readable implementation; source reasoning alone is not installed-host proof.

The decisive installed-host corroboration is the parent's private receipt, read by this scout: owning-config-relative `.worktrees/central-router-runtime/.visual-e2e/config-reload-1788924995143/report.json`. It reports `ok: true`, one PID (9040), a before Giver with deny-all plus execute/quest/usage grants, and an after Giver with `project_discover` allowed in the **same process**. Parent identifies the fixture host as beta-19296. The receipt proves permission hot reload, not a completed router call in the existing central conversation.

### Can the same conversation recover without restart?

**Yes, permission-only recovery is supported without a process restart.** Update the effective file-based Giver rules, wait for reload, and obtain a fresh context/catalog on the next turn in the same session. The private installed-host receipt proves the process can reload permissions; source explains how the subsequent catalog is rebuilt. Already-issued model/tool snapshots are not retroactively rewritten.

This is conditional on router already being registered in that process, and on no higher-priority fixed content overlay overriding the repaired file. A selected-generation pointer change alone neither applies agent rules nor proves plugin hot replacement. Same-central-session model-facing recovery is the remaining acceptance, not something this scout has executed. Avoid a blanket “restart required” instruction and avoid promising that permission reload replaces an older loaded plugin build.

## Smallest supported fix

1. Integrator adds the nine explicit selected router grants to the effective live Giver's V2 permission list **after** its deny-all rule: `project_discover`, `project_resolve`, `project_select`, `project_route`, `project_result`, `project_clone`, `project_route_status`, `project_verify`, `project_goal`. Preserve existing implementation/delegation restrictions and unrelated dirty configuration. Do not wholesale copy the selected agent: its configuration also contains legacy `tools` and broader task/subagent allowances that are unnecessary for this repair.
2. Verify agent reload and next-turn catalog in the owning central host. Check loaded router identity through `project_route_status` once available. Keep missing registration, denied permission and wrong executable as separate diagnoses.
3. For reproducible new isolated launches, bind both reviewed agent config and selected generation using existing runtime-contract helpers, with the **verified current executable**. No host-source edit or new dispatch machinery is needed.
4. Coordinate executable discovery in `project-router/host.ts:34-36` and `scripts/opencode-runtime.mjs:18`: replace stale package assumptions with verified native executable resolution, preserving explicit overrides and failing with a concrete diagnostic if unresolved. Existing overrides are `OPENCODE_PROJECT_ROUTER_CLI` and `OPENCODE2_EXE`; they must identify the same tested executable when both paths are exercised.

Parent reports it has independently fixed Windows native path casing at the Quest `session.create` boundary and passed focused runtime tests. The inherited snapshot shows `realpathSync.native(workspace.path)` at `quest/runtime.ts:64`. That work belongs to the parent. `project-router/routing.ts:53-57` also creates and then verifies destination session locations; acceptance should check physical path identity there rather than assuming canonical lower-case identity keys are safe host location strings.

## Current-host discovery and launch recipe

Use `Get-Command opencode2 -All`, inspect the selected shim/package bin mapping, then invoke the resolved native executable with `--version`. Do not assume the `host/` junction or the old npm namespace tracks the user's command. Windows `spawn(..., {shell:false})` needs the native executable rather than a `.cmd` shim. Explicit verified override wins; resolution must not silently choose a different beta.

For this machine the observed package is `@opencode/cli`, beta-19296. From the hub, its inspected native path is `../../AppData/Roaming/npm/node_modules/@opencode/cli/bin/opencode2.exe`. The following are supported **acceptance recipes**, not additional commands run by this scout:

```powershell
& $verifiedExe api --standalone GET /api/project
& $verifiedExe api --standalone GET '/api/session?limit=3'
& $verifiedExe api --standalone GET "/api/session/$discoveredSession/message?limit=3&order=desc"
```

Existing `DiscoveryHost` uses these argv-only endpoints with bounded time/output and validates project arrays, paginated session envelopes and paginated message content. Isolated routing acceptance uses `run --standalone --auto --agent quest-giver -m <explicit-test-route> <fixture-prompt>` with private configuration/ledger/journal, not the production daemon. Keep the original hub session bound to the hub; destination creation uses supported `ctx.session.create/get/prompt` and must verify agent, exact model/variant, instructions and workspace before delivery. A local deterministic provider is a catalog fixture, not proof of Astra inference. Real substantive worker acceptance must retain exact `openai/gpt-6-astra#medium`.

## Exact acceptance and handoff

Integrator acceptance, in order:

1. Record current executable path/version, effective Giver permissions, central session identity, selected generation and loaded router module. Inspect highest-priority config overlays without printing secrets.
2. Reproduce missing catalog under the old rules in one isolated current-host process. Apply only explicit project grants; observe agent update under the same PID. On the next turn of the same fixture session, capture actual provider-facing Code Mode catalog and successfully execute bounded `project_discover`. No replacement session counts as this check.
3. After authorized live configuration repair, repeat the next-turn `project_discover` check in the **existing central conversation**, then `project_route_status` for the exact route. Record same session/process and actual loaded module; do not infer these from the pointer. If unavailable, distinguish denied grant, stale overlay, absent registration and reload failure.
4. With isolated destinations, select an explicit project, route once, verify destination physical/native Windows path and instructions, preserve hub identity, exercise destination-owned Quest get/update plus configured harmless command receipt, and retrieve results at the hub. Repeat request keys must not duplicate launch. Wrong-project Quest access must remain rejected. Check correction and unknown-delivery handling.
5. Reuse `scripts/verify-project-router.ts` with the current executable override and reviewed configuration; historical beta-19242 results remain historical. Run relevant host/path/runtime focused checks. Full `bun test` and `pwsh -NoProfile -File ./smoke-test.ps1` remain implementation/integration gates. Exact Astra worker dispatch, goal lifecycle and any TUI change have their own existing acceptance; this documentation scout supplies no new completion claim for them.

### Scout checks and result

Read-only configuration/source/package inspection and version/help commands passed. Private reload JSON was inspected directly: same PID before/after and the additional grant, `ok: true`. Cross-project Quest get rejection was expected and preserved; related evidence was read without mutation. Empty short-lived agent API results are reported above rather than treated as successful central-host inspection. No full suite, model acceptance, TUI capture or production reload was run by this scout.

The only new file is this brief. Final verification is readback plus a required-section/receipt/acceptance structure check and `git diff --check` for this path. Per the parent's latest instruction, no commit, launch, activation or restart is performed. Reward: a bounded fix plan that separates permissions from plugin selection and current-host identity, with demonstrated same-process permission reload and explicit same-conversation acceptance still to run. Update only the assigned scout step; parent owns integration and final rollout.
