# stealth/union-alpha — route proof (2026-09-17)

Two paths on this machine reach the model named `stealth/union-alpha` on OpenRouter / `union-alpha`
on OpenCode Zen (catalog: `bench/union-alpha/catalog.md`). Both are driven by user-selected routes,
not by a hardcoded model name in any production file: the route strings below are CLI arguments
(`-m ...`) picked by the caller, exactly the same mechanism used to call any other model this setup
routes. Nothing under `bench/` is loaded by production code (`quest/`, `usage/`, `scripts/` outside
`bench/`) — it is a standalone local tool.

## Path 1 — OpenCode Zen, v1 CLI, isolated config

The free tier of Union Alpha on Zen answers through the v1 `opencode` binary with an isolated global
config, because v1 rejects the V2 keys under `~/.config/opencode` and also rejects this repository's
own `opencode.jsonc` (V2-only `permissions` blocks: "V2 permissions are not supported by OpenCode
V1. Use V1 "permission" rules or run opencode2."). The v1 binary must therefore run from a directory
that holds no project `opencode.jsonc`/`opencode.json` — a plain scratch directory works, the
worktree does not.

```bash
XDG_CONFIG_HOME="$(cygpath -w "$TMP/oc-headless/xdgcfg")"
OPENCODE_CONFIG_DIR="$(cygpath -w "$TMP/oc-headless/cfg")"
cd "$(cygpath -w "$TMP/oc-headless/work")"   # a directory with no opencode.jsonc of its own
XDG_CONFIG_HOME="$XDG_CONFIG_HOME" OPENCODE_CONFIG_DIR="$OPENCODE_CONFIG_DIR" \
  opencode run -m opencode/union-alpha "<message>"
```

Captured real turn (prompt: "Reply with exactly one line: the name of this model as you understand
it, and the sum 47+58."): `.evidence/union-alpha-bench/route/zen-v1-turn.txt` (git-ignored, not
committed; run the command above to reproduce).

## Path 2 — OpenCode Go, v2 CLI, `opencode-go/union-alpha`

The same model is also reachable on the Go provider through the standard v2 recipe, which every
other `opencode-go/*` model in this Quest uses (see `bench/union-alpha/harness/` runner):

```bash
EXE="/c/Users/Jk101/AppData/Roaming/npm/node_modules/@opencode/cli/bin/opencode2.exe"
CFG="$(cygpath -w "$TMP/oc-headless/cfg")"       # holds an empty opencode.json
cd <worktree>
OPENCODE_CONFIG_DIR="$CFG" "$EXE" run --standalone --auto --agent build \
  -m "opencode-go/union-alpha" --title "<task>" "<message>"
```

`--agent build` is required inside JonsOCsetup checkouts (otherwise the repository's quest-giver
agent becomes the default and every tool read is denied). `--auto` approves tool permissions.

Captured real turn (same prompt as Path 1), run from
`C:/Users/Jk101/Projects/JonsOCsetup/.worktrees/union-alpha-bench`:
`.evidence/union-alpha-bench/route/go-v2-turn.txt` (git-ignored). The model self-identified as
"Union Alpha" and answered the arithmetic check (47+58=105) correctly.

## Gotchas found while wiring the harness to Path 1

Two things broke the Zen v1 path only when it was called from a spawned child process (not from an
interactive shell) and only surfaced once the harness sent real multi-line benchmark prompts, not
the one-line checks above — worth recording so nobody re-discovers them the slow way:

- **PWD wins over the child process's actual working directory.** The v1 binary reads the `PWD`
  environment variable (set by Git Bash, the shell this whole toolchain runs under) as a hint for
  "the invoking shell's directory" and prefers it over the OS-level cwd a spawner sets. Every
  harness call happens to run from inside a git worktree, so an unset/inherited `PWD` made the v1
  binary silently re-bootstrap against that worktree's own `opencode.jsonc` (a V2-only config) and
  fail with `Session not found`. Fix: explicitly set `PWD`/`OLDPWD` in the child's environment to
  match the intended working directory.
- **The npm shim is a Windows `.cmd` file, and `.cmd` execution goes through `cmd.exe`.** `cmd.exe`
  collapses a multi-line argument to its first line, so a real problem statement (many lines)
  arrived at the model as nothing — it replied asking for the problem. Fix: invoke the real binary
  the shim wraps (`node_modules\opencode-ai\bin\opencode.exe`) directly; Bun's array-argv spawn
  reaches a native `.exe` without a `cmd.exe` re-parse, and embedded newlines survive intact.

`bench/union-alpha/harness/call-model.ts` implements both fixes; `route.md`'s Path 1 commands above
are the minimal proof-of-life shape and remain correct for a single-line message run interactively
or via the Bash tool (Git Bash sets `PWD` to wherever the caller `cd`ed, which is exactly right
there) — the two gotchas are specific to driving it headlessly from another process.

## Verdict on routing

Both paths are callable from this machine today. Neither path is wired into production routing —
`bench/` is a standalone tool tree, and no file under `quest/`, `usage/`, or `scripts/` (outside
`bench/`) names `union-alpha` or `stealth/union-alpha`. A user who wants to route real work to this
model adds it as a route the same way any other model becomes selectable — through user settings —
not through a code change.
