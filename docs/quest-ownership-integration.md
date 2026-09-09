# Quest ownership recovery integration

This source integrates the verified Codex ownership recovery repair into the
current production branch while preserving OpenCode2's native Quest API,
parallel dispatch and workspace runtime. OpenCode2 remains the Quest product
target; this adapter is a bounded, separately verified compatibility path.

## Source lineage

PR #11 (`fix/quest-ownership-recovery`) contains the recovery repair against an
unmerged adapter snapshot. Its complete branch also includes unrelated changes,
so this integration imports only the Codex adapter, recovery implementation,
candidate builder and focused checks. The MCP adapter uses the production
Quest schema: step outcomes use `note`, and deliverables use `reward` and
artifacts. The newer snapshot's `include`, `handoff` and `result` fields are
not imported into the native API.

PR #2 (`cursor/quest-codex`) is reconciled by this selective integration. Its
Codex adapter is superseded by hook-owned context and recovery, without adding
its manual join/reserve/release tools. The existing native OpenCode2 tool
surface is preserved. Neither earlier PR is merged, retargeted or closed by
this change.

## Recovery boundary

Native read-only file and web tools remain available during an ownership
conflict. A conflicting Windows shell or patch operation creates or reuses a
deterministic session-owned worktree. The host applies `updatedInput` to the
original operation; shell execution runs through the installed Codex app-server
`command/exec` boundary with only the recovered worktree writable. The original
owner's reservation, dirty files and running process remain intact.

The logical session directory does not change. Shell operations preserve their
requested package subdirectory inside the recovered worktree. Codex 0.153.4's
hook omits `workdir`, so the runner maps the original native wrapper cwd; explicit
hook workdirs and the hub/config junction are also supported. Paths resolving
outside the bound repository and recovered-tree junction escapes are refused.
The executor rechecks containment before starting the command. Recovery uses
Windows PowerShell
without profiles, disables network access and limits commands to 90 seconds.
Persistent tools without a verified binding stay blocked. Durable claimed
command tickets preserve unknown outcomes and prevent automatic duplicate
execution. These checks do not establish general Codex session integration,
automatic diff attribution or a new native OpenCode2 recovery mechanism.

## Candidate verification

Build with `bun scripts/build-codex-quest.ts <new-candidate-directory>`, then run
`bun scripts/verify-codex-recovery-tool.ts <candidate-directory>` and
`bun scripts/verify-codex-recovery.ts <candidate-directory>`. The first uses a
local scripted Responses endpoint to drive an actual host tool call; the
second verifies the restricted command boundary denies an absolute write into
the protected checkout while its fixture owner remains running. Both use
throwaway repositories and ledgers, with no remote model calls. Reports are
saved under `.visual-e2e/ownership-recovery/` in this worktree.

The builder creates candidate files only. It does not install a plugin, promote
an OpenCode2 generation, change live trust settings or modify shared records.
The production plugin and already running sessions retain their installed
revision until a separately authorized release.

## Observed integration verification (2026-09-07)

The candidate built from this production-lineage integration passed both real
host probes using installed Codex 0.153.4. The original tool completed in its
requested package subdirectory in the recovery worktree, preserving both owner
root and package files. The separate boundary probe denied the absolute owner
write while preserving the owner's dirty file, reservation and running fixture
process. Both probes recorded zero remote model calls. The actual-tool receipt
contains a local fixture model-catalog 404 and a configured Cloudflare MCP auth
closure in stderr; these did not block the observed recovery operation.

The configuration smoke gate passed 103 tests and reported a healthy config.
The standalone candidate and all disposable fixture work remain local evidence;
no live plugin or selected OpenCode2 generation was changed.

Final recovery gate: `bun test --timeout 30000` passed 825 tests, with one
existing skip and zero failures (120 files, 127.15 seconds). It includes package
workdirs, the configured hub/config junction and external/junction escape
rejections. This run started before reconciling master's unrelated usage-label
update; its seven affected tests and the 103-test configuration smoke then
passed on the combined revision. Checks used the installed Git executable first
on PATH and a dedicated temporary root.

The package-workdir regression first reproduced execution at the recovery root.
An installed-host probe then exposed that the Bash hook omits native workdir;
the verified executor now maps the wrapper's actual cwd. The final candidate
passed both host probes after this correction. These receipts establish this
bounded operation and owner boundary, not general host integration.
