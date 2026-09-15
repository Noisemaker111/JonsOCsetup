# Personal setup

The [manifest](manifest.json) maps tracked instructions, skills, configuration, and helpers to their paths on a user's machine. OpenCode extensions live in their owner directories at repository root. External skill checkouts are recorded under `dependencies` with their origin and revision.

## Preview and install

Install the OpenCode2 host, Git, Bun, and Node first. Use a checkout of `agents`, restore its dependencies with `bun install --frozen-lockfile`, and review the personal instructions and provider settings. Accounts must be authenticated locally.

```powershell
bun run setup:plan
bun run setup:install
```

The plan checks source hashes and compares target files. Installation applies missing or previously managed files and keeps a receipt. Independent local edits are conflicts; it does not overwrite them. To inspect installation in an empty isolated home, use `node scripts/install-setup.mjs --root <empty-home> --apply`.

Prepare the configured runtime following the [development workflow](../docs/development-workflow.md), then install the `oc` command with `node scripts/install-channel-shortcuts.mjs`. See [launch options](../docs/plain-opencode-launch.md). These commands do not install or authenticate the native host for you.

## Maintain tracked instructions

Instruction paths can be symbolic links into an owned checkout. `bun run setup:link` previews their state; `bun run setup:link -- --apply` creates the supported links. Inspect the actual target before editing. A link changes when its target checkout changes, so the checkout must remain available. The linker refuses independent installed changes.

Application-managed files such as Codex configuration and Claude settings remain copies because their applications can replace the path. `bun run setup:sync` re-captures supported machine files, reports added/changed/removed entries and link drift, and writes updated source and manifest data. It does not stage or push. Review that private import before committing; do not run it merely to update a hash for an unrelated change.

When editing a tracked source, update its corresponding manifest hash in the same PR. `test/setup-manifest.test.ts` checks source presence, hashes, and unique installation targets. This prevents an instruction correction from being lost at the next install.

Logs, credentials, session databases, and live-source recovery snapshots stay private. Installing or selecting code does not move existing conversations or authorize changing their data. The old proposal in `proposals/` is historical wording; current authorization lives in the project's instructions.
