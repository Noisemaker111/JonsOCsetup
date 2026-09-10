# Personal Claude Code runtime (all repos)

Keep this short. Project `CLAUDE.md` / skills own deep conventions.

## Bootstrap first

- Cold checkouts and `claude --worktree` trees need install/build before package typechecks.

## Scripts

- Prefer `bun --cwd=<dir> run <script>` (the `=` form; the space form mis-parses).

## Scope & evidence

- Never merge unless the user asks.

## Quick navigation

- BTG (btggutters.com + appforgutters.com) work: hub at `C:\Users\Jk101\Projects\btg-hub` (`AGENTS.md` there has repos/sites/commands). Terminal shortcut: `btg`.
- OpenCode work (config, plugins, Quests, TUI): hub at `C:\Users\Jk101\Projects\opencode-hub` (`AGENTS.md` there maps config/data/state/host/upstream). Terminal shortcut: `oc`.

Read C:/Users/Jk101/.agents/user-verification.md before implementation. Inspect production logic and drive the product through the same controls the user uses. Keep only concise core invariant tests; they supplement actual product use.
