# stealth/union-alpha — route proof (2026-09-17)

Jon's call: only OpenCode Go (the v2 host) matters here, not the v1 CLI / OpenCode Zen. The model
named `stealth/union-alpha` on OpenRouter / `union-alpha` on OpenCode Zen (catalog:
`bench/union-alpha/catalog.md`) is reached on the Go provider as `opencode-go/union-alpha`, through
a route string the caller supplies (`-m opencode-go/union-alpha`), not a hardcoded model name in
any production file — the same mechanism used to call any other model this setup routes.

## OpenCode Go, v2 CLI, `opencode-go/union-alpha`

```bash
EXE="/c/Users/Jk101/AppData/Roaming/npm/node_modules/@opencode/cli/bin/opencode2.exe"
CFG="$(cygpath -w "$TMP/oc-headless/cfg")"       # holds an empty opencode.json
cd <worktree>
OPENCODE_CONFIG_DIR="$CFG" "$EXE" run --standalone --auto --agent build \
  -m "opencode-go/union-alpha" --title "<task>" "<message>"
```

`--agent build` is required inside JonsOCsetup checkouts (otherwise the repository's quest-giver
agent becomes the default and every tool read is denied). `--auto` approves tool permissions.

Captured real turn (prompt: "Reply with exactly one line: the name of this model as you understand
it, and the sum 47+58."), run from
`C:/Users/Jk101/Projects/JonsOCsetup/.worktrees/union-alpha-bench`:
`.evidence/union-alpha-bench/route/go-v2-turn.txt` (git-ignored). The model self-identified as
"Union Alpha" and answered the arithmetic check (47+58=105) correctly.

## Verdict on routing

This path is callable from this machine today. It is not wired into production routing —
`bench/` is a standalone tool tree, and no file under `quest/`, `usage/`, or `scripts/` (outside
`bench/`) names `union-alpha` or `stealth/union-alpha`. A user who wants to route real work to this
model adds it as a route the same way any other model becomes selectable — through user settings —
not through a code change.

## History: the v1 CLI path was also proven, then dropped from scope

The Zen v1 path (`opencode run -m opencode/union-alpha` through the isolated v1 CLI) was proven
callable too, with two headless-CLI bugs found and fixed while wiring it into the scoring harness:
Git Bash's `PWD` environment variable overriding the v1 binary's actual working directory (it reads
`PWD` as a hint and prefers it over the OS-level cwd a spawner sets, causing `Session not found`
until `PWD`/`OLDPWD` were pinned in the child's env), and the v1 npm shim being a Windows `.cmd`
file — `.cmd` execution goes through `cmd.exe`, which collapses a multi-line prompt argument to its
first line. Jon decided only the v2 host matters for this benchmark, so this path and its code
(`call-model.ts`'s former `zen-v1` branch, `route.ts`'s former `union-alpha-zen` entry) were removed
from the harness; this section is kept only as a record that the path works, in case it becomes in
scope again later.
