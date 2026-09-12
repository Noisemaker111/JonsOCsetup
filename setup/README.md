# Tracked personal setup

`manifest.json` maps 154 external instruction, configuration, skill and helper files to their tracked sources, covering every harness that reads instructions on this machine: hub, Codex and Claude Code instructions, `.codex/config.toml` and its command rules, `.claude/settings.json`, shared active and disabled skills, and personal helper scripts. Most OpenCode extensions already live in their owner directories at repository root.

Upstream skills that are their own checkouts are pinned under `dependencies` by origin and commit rather than copied, so this tree does not republish another project's repository or bury real configuration under vendored files.

A file that is only installed is a file that gets corrected repeatedly and lost: the dev-workflow skill was reworded away from "dev release" twice before the wording ever reached here. `test/setup-manifest.test.ts` fails when an entry's recorded hash stops matching its source, and `setup:plan` reports an installed file that has drifted from the tree — run it before assuming the two agree.

- `bun run setup:plan` verifies source hashes and previews installation.
- `bun run setup:install` applies missing or previously managed files, refusing independent local edits.
- `node scripts/install-setup.mjs --root <empty-home> --apply` restores into an isolated home without executing installed scripts or plugins.
- `node scripts/install-channel-shortcuts.mjs` installs `oc` after the channel runtime has been prepared, and removes the superseded `oca`/`ocm`/`ocd`/`ocs`/`ocb` names.

Keep source bytes and manifest hashes synchronized in the same PR. `capture-setup.mjs` is an explicit private import tool, not an automatic synchronization job. Review imported material before adding it to this public repository. The live-source capture script produces private recovery snapshots that must never be committed or published here.

Shared instruction installation is explicit; checking out dev does not rewrite another host's global instructions. Dependencies, authentication and the native host remain separate installation prerequisites. No bare-machine completeness percentage is claimed.

The public baseline was restored into an isolated home and checked against the manifest. Prior private work and histories remain in local migration backups, not this public tree. The proposal under `proposals/` is recorded wording, not an installed policy change.
