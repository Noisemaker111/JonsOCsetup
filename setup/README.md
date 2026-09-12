# Tracked personal setup

`manifest.json` maps 137 external instruction, skill and helper files to their tracked sources. The source files include hub and Codex instructions, shared active and disabled skills, and personal helper scripts. Most OpenCode extensions already live in their owner directories at repository root.

- `bun run setup:plan` verifies source hashes and previews installation.
- `bun run setup:install` applies missing or previously managed files, refusing independent local edits.
- `node scripts/install-setup.mjs --root <empty-home> --apply` restores into an isolated home without executing installed scripts or plugins.
- `node scripts/install-channel-shortcuts.mjs` installs `oc` after the channel runtime has been prepared, and removes the superseded `oca`/`ocm`/`ocd`/`ocs`/`ocb` names.

Keep source bytes and manifest hashes synchronized in the same PR. `capture-setup.mjs` is an explicit private import tool, not an automatic synchronization job. Review imported material before adding it to this public repository. The live-source capture script produces private recovery snapshots that must never be committed or published here.

Shared instruction installation is explicit; checking out dev does not rewrite another host's global instructions. Dependencies, authentication and the native host remain separate installation prerequisites. No bare-machine completeness percentage is claimed.

The public baseline was restored into an isolated home and checked against the manifest. Prior private work and histories remain in local migration backups, not this public tree. The proposal under `proposals/` is recorded wording, not an installed policy change.
