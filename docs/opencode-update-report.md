# OpenCode2 update reports

Run from this package inside the managed OpenCode environment:

```powershell
bun run runtime:update-report
bun run runtime:update-report --format json
```

- The running baseline comes from the current launch receipt beside `OPENCODE_RUNTIME_RECEIPT`. The shared host resolver separately checks the executable selected **now** with `--version`; disagreement is visible. A receipt is historical launch evidence, not a live process or binary-hash check. Without one, the running baseline stays unknown.
- Outside that environment, `--receipt <launch.json>` and `--config-root <installed-config>` select existing launch and installed-plugin evidence. Never point the inventory at an unrelated source checkout and call it installed.
- The official latest V2 candidate is the default comparison target. Both latest and beta discovery results are shown. `--channel beta` explicitly selects beta. The setup's `dev` plugin channel and a beta-looking version do not establish the host's compiled update channel.
- Official npm versions define the published gap, including prereleases. Official GitHub notes are collected first, with pagination and explicit missing-note coverage. V1 entries are ignored. Empty notes, network failures, custom versions and unknown ancestry remain partial/unknown, never “no changes.” Equal versions have no version gap, but do not certify plugins.
- Selective pinned source evidence covers core architecture, host instructions and SDK/loader surfaces. An official npm `gitHead` may identify the baseline; the beta build number never substitutes for a source SHA. Source hashes establish changed/identical files, not semantic compatibility. Official-note claims are attributed to their publisher.
- Installed owners, import locations, used API names, SDK exports and peers are read from the selected generation and actual dependency metadata. Raw local prompts, configuration secrets and transcripts are not collected. Load receipts prove past loading only. Namespace/peer mismatches are suspected risks until the affected plugin is exercised on the target host.
- Markdown starts with a short summary; structured JSON contains full notes, evidence URLs, digests, validators, timestamps, coverage and per-plugin API locations. The saved JSON and pair/assessment paths appear at the end.

## Cache and repeat use

```powershell
bun run runtime:update-report --offline
bun run runtime:update-report --refresh
```

- Persistent cache defaults to `$XDG_STATE_HOME/opencode/update-reports`, or `~/.local/state/opencode/update-reports`. `--cache-dir <path>` selects isolated evidence storage.
- Pair keys include schema, product/package, exact baseline version/SHA, target version/SHA and selected host channel. Installed assessment keys additionally include the generation, owner source digests, SDK metadata and loaded-component inventory. New latest targets and changed inventories cannot reuse another pair/assessment.
- Moving discovery endpoints are conditionally revalidated on each online request. Pair evidence is reused until `--refresh`; the timestamp is always shown. There is no background polling or invented expiry. `--offline` uses only saved public responses, while still checking local identity/inventory.
- HTTP/parse failures preserve prior successful response evidence and disclose stale-cache use. A partial refresh does not overwrite a complete note comparison. Missing evidence remains visible; refresh explicitly when partial upstream coverage becomes available.
- This command performs read-only discovery and writes report/cache files. It does not invoke an updater, modify installed plugins, restart sessions, or make compatibility changes.
