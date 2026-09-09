# Plugin distribution standard

Each owner has one `plugin.json`: `usage/`, `quest/`, `models/`, `papercut/`,
and `harnesses/`. `plugin-set.json` lists these manifests. The manifest names
its package, server entrypoint, optional TUI entrypoint, and runtime assets.
New imported helpers are discovered automatically, including type imports,
re-exports, side-effect imports and literal dynamic imports.

Every generated package has `package.json`, `plugin.json`, `README.md`,
`LICENSE`, `distribution.json`, a scoped Bun test configuration and packaging
tests. Dependencies use the installed versions that were validated. TUI
packages also have a `tui.tsx` directory-discovery shim and `./tui` export.

Relative dependencies are vendored from the same source revision and recorded
with SHA-256 hashes. A name in another package's file list does not make an
unresolved relative import valid. No sibling checkout is required. This
preserves the current runtime paths without pretending that shared helpers
are independently installed packages. Root discovery shims and the existing
`orchestration/` source directory remain compatibility layout; the latter is
owned by Quests. All server implementations now live in their owner's
`server.ts`; the three harness helpers also live under `harnesses/`.
`plugins-active/` contains compatibility exports only. Smoke checks scan all
owned source directories so a move cannot hide implementation from validation.

The builder rejects private root configuration, unknown source roots, missing
files, paths outside the source tree, and symlink escapes. Runtime-spawned
collectors and filesystem-loaded assets are explicitly included. All package
entrypoints must bundle before the previous staging directory is replaced.
Previous outputs are moved to a backup, with mirror Git history transferred
to the new output; the builder does not delete prior working files.

Build locally with `bun scripts/build-plugin-repos.ts`. Each output runs
`bun test` to verify its source hashes and entrypoint import graph. These are
static distribution checks, not proof of provider login or native host UI
behavior. Full source regression tests remain in this private repository.
Nothing in the build pushes, publishes, restarts OpenCode or changes accounts.
