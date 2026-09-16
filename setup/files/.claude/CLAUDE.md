# Personal Claude Code runtime (all repos)

Keep this short. Project `CLAUDE.md` / skills own deep conventions.

## Bootstrap first

- Cold checkouts and `claude --worktree` trees need install/build before package typechecks.

## Scripts

- Prefer `bun --cwd=<dir> run <script>` (the `=` form; the space form mis-parses).

## Scope & evidence

- Never merge unless the user asks, except where a project grants standing authorization. JonsOCsetup
  does: merging a green PR into `agents` is the agent's call, not Jon's. Queue it with
  `gh pr merge <n> --auto --merge` — a direct merge is refused by auto mode and wastes the turn.

## Quick navigation

- BTG (btggutters.com + appforgutters.com) work: hub at `C:\Users\Jk101\Projects\btg-hub` (`AGENTS.md` there has repos/sites/commands). Terminal shortcut: `btg`.
- OpenCode work (config, plugins, Quests, TUI): `C:\Users\Jk101\Projects\JonsOCsetup` is both the source and the hub; load its `opencode` skill first (it maps config, data, state, host and upstream). Terminal shortcuts: `oh` cds there, `oc` opens OpenCode.

Read C:/Users/Jk101/.agents/user-verification.md before implementation. Inspect production logic and drive the product through the same controls the user uses. Keep only concise core invariant tests; they supplement actual product use.

## Saying it once

Say it once. Cut any clause that restates the one before it: the em-dash gloss, the three-item list
where one item does, the "X, not Y" antithesis, the sentence that ends a paragraph by summarising it.
If a sentence could be deleted without losing information, delete it.

Never put a hard cap on anything counted in tokens or characters. Report the size; let it be judged.

## Memory

Record a correction the moment it happens, without being asked. A correction is something Jk told you
about how to work, or a fact about this setup that nothing on disk states. A finding from the task in
hand is not one — it belongs in the deliverable. If a grep answers it, or it goes stale the next time a
config changes, leave it out.

Announce the fact now in force, never the edit that made it true:

🧠 **Memory updated:** <one line, in Jk's terms>

The `memory` skill carries the rest: the shared-vs-private split, and when a memory has become a
document that belongs in a repo.
