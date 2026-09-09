# Instruction scope and maintenance audit

This config checkout is both a global runtime configuration and, when opened
here, a project in its own right. The global AGENTS.md must make sense when
loaded before an unrelated project's instructions. Skill availability does
not make every skill applicable. README commands are for maintaining this
checkout, not commands agents should run from every project.

## Corrected in this cleanup

- AGENTS.md now explicitly separates global personal rules, the active project,
  config maintenance, and shared ledger storage. Quest and usage instructions
  account for unavailable tools rather than requiring agents to invent access.
- README has a scope map and labels existing model pins, payment restrictions,
  historical host observations and planned Quest behavior appropriately.
- The giver resolves follow-ups from conversation/project context rather than
  the globally last-touched Quest. Questions do not require a board call or a
  new Quest. Failed dispatch must be explained separately from saving a Quest.
- Model-routing guidance no longer embeds model rankings, stale prices,
  subscription-only permission rules or a cheapest-first policy.
- Favorite synchronization no longer rewrites the hand-maintained routing
  skill. Inventory maintenance must not regenerate personal policy.
- Contribution and review skills no longer force unrelated repositories into
  fixed OpenCode checkouts, require unrelated deployment scripts, prohibit
  local development or impose repetitive approval and review ceremonies.
- Config maintenance guidance distinguishes the current shared-tree limitation
  from the requested worktree design, removes prescribed automatic failover,
  and uses a non-publishing promotion example with the managed README workflow.
- TUI guidance labels historical host observations and uses isolated captures.
  Windows guidance has discoverable skill metadata and project-neutral paths.
- Git guidance preserves repository identity/remotes and removes stale scope
  claims, mandatory fork-head syntax and browser-opening review instructions.

## Remaining runtime work, not fixed by instruction edits

1. Source now wires Quest run to the account-aware planner and reservations. The live spawn fallback and competing pick_model tool are removed. Configurable access rules preserve previous transport boundaries. Historical scoring helpers still need cleanup where used by presentation; no production policy/evidence values have been invented.
2. opencode.jsonc and agent/quest-giver.md retain current personal pins. The selected generation and validation receipt are recorded in plugin-activation.json; existing running processes were not restarted.
3. The typed Quest contract, owned workspaces, deterministic configured commands, shared request telemetry and offline calibration are implemented. Isolated native model-worker dispatch and real terminal views passed acceptance. The personal configured-worker dispatch policy is populated from existing settings and live accounts. Current migration and compaction status is recorded in the dated section below: 62 of 63 contracts migrated, one malformed journal deferred, and no supported server-plugin compaction transport established. The earlier capture and migration counts are historical checkpoints; consult the linked receipts for their exact scope.
4. Favorite sync now preserves old model-* files, configured agents and legacy
   TODO.md/TEAMWORK.md/DONE.md records. It reports legacy inventory without
   deleting it. The destructive off command is retired. An isolated byte-for-byte
   preservation test covers user-edited agents, configuration, state and ledgers;
   no live favorite sync or legacy deletion was executed.
5. Host API notes span several beta versions. Existing acceptance scripts are
   the place to verify the installed host; no new host-load-order or live-session
   verification was performed for this document cleanup. The scope model uses
   the user's described global-before-project loading behavior.
6. Historical audits are snapshots, not current configuration authorities.
   Keep their dated observations; link to implementation status rather than
   copying model and host facts into more prompts.

## Keeping this small

Put personal behavior in AGENTS.md, project commands in the project README,
role behavior in the agent prompt, and task-specific procedure in an on-demand
skill. Put changing account/model facts in runtime data. Maintain one owner for
each rule. Do not turn an incident workaround into a permanent global mandate.

## Validation

The focused instruction, orchestration, shared-tree and routing import checks
passed: 64 tests, 228 assertions, zero failures. Skill frontmatter and local
Markdown links passed validation. Log: run/instruction-scope-tests.log.
No live host restart, provider request, favorite sync or deployment was run.

### Quest board ownership filter (2026-09-05)

The board now defaults to the trusted current project's ID, resolving worker worktrees through projectIdentity. The host session location takes precedence when available; ledger storage is never used as a cwd fallback. All projects is an explicit toggle and includes historical records whose ownership is unresolved. Unknown location produces a visible diagnostic instead of claiming the ledger's directory is the project. Deterministic ownership/root/package checks passed (12), and the terminal module compiles.

### Canonical ledger migration applied (2026-09-05)

Applied the saved preview to 60 inactive, readable legacy Quests with revision checks and per-record backups under the canonical runtime contract-backups directory. Verified each original backup, title, objective, created/activity timestamps, sessions, evidence, relationships, scope, archive reason and post-write replay. Three records were deferred: active/uncertain worker state or a malformed historical journal. No journal repair or invented session binding was performed. Project ownership remains unresolved where the source records do not establish it; the shared ledger path was not used as ownership. Private receipt: .visual-e2e/live-contract-migration-1788597758482/result.json. This is an applied live storage migration, not generation promotion or native compaction acceptance.

### Current migration and compaction status (2026-09-05)

The later compatible migrations now cover 62 of 63 canonical Quest contracts. Waiting worker state was preserved without terminalization. One malformed historical journal remains deferred; unresolved project ownership remains explicit. See the dated receipts in docs/quest-cleanup-review.md for the applied migrations rather than treating the earlier 60-record checkpoint above as current.

Installed binary inspection reconfirmed that both server plugin wrappers omit compaction admission even though the internal session service and HTTP API expose it. Native /compact uses the separate TUI client. No supported owning-host transport has been established for the server plugin. Private inspection receipt: .visual-e2e/compaction-interface-audit-1788601186583/result.json. This was read-only code inspection, not a capture retry or native compaction acceptance.

### Global overlay cut to policy only; hub added (2026-09-06)

AGENTS.md went from 742 to about 120 words. It keeps only project-ownership, authorization, model-honoring and worker-description policy. Quest, worker, workspace, tool-design and product-target paragraphs were removed: the worker prompt in quest/runtime.ts, agent/quest-giver.md, skills/workspace-flow and skills/opencode already carry them. Orientation for maintaining OpenCode now lives outside this repo at `C:\Users\Jk101\Projects\opencode-hub\AGENTS.md`, a folder of junctions to this config, `~/.local/share/opencode`, `~/.local/state/opencode`, `~/.opencode`, the installed host and the upstream checkouts. The host's instruction loader realpaths the cwd and walks up to `~`, so that file loads for sessions started at the hub root, not for sessions started inside this repo.
