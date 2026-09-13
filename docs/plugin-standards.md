# Plugin ownership and local packaging

All plugins live in this repository. [plugin-set.json](../plugin-set.json) is the current registry of server entrypoints, TUI entrypoints, package manifests, discovery shims, and public cross-owner surfaces. Do not maintain a second hardcoded package list in documentation.

Each package owns its source directory and `plugin.json`. Cross-owner imports use the declared public surfaces. Server and TUI discovery shims load the selected source; `orchestration/` is owned by Quests. Read the [OpenCode skill](../skills/opencode/SKILL.md) before changing registration or host APIs.

`bun scripts/build-plugin-repos.ts` builds local package output under `.candidates/repos`. It validates dependency closure and entrypoint bundling before replacing that output. The directory name is historical: this command does not create or publish separate GitHub repositories. Previous output is retained as a backup.

Package README files come from [scripts/plugin-package.ts](../scripts/plugin-package.ts) and each manifest. Root `README.md` is hand-maintained; `scripts/build-plugin-readmes.ts` only rewrites generated package READMEs.

Local packaging does not push, publish, restart OpenCode, or select a runtime. Individual plugin mirror publishing is retired. For integration and actual installed-host verification, follow the [development workflow](development-workflow.md).
