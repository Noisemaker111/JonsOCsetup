# Publishing to skills.sh

Sources: [skills CLI](https://github.com/vercel-labs/skills), [FAQ](https://skills.sh/docs/faq). Check them if a command fails.

## Commands

The CLI installs from a public GitHub repo's default branch (`skills/<name>/SKILL.md`) or from an explicit tree URL.

```text
# Discover locally
npx --yes skills add <local-path> --list

# Test install (in a temp dir, project scope)
npx --yes skills add <local-path> --skill <name> --agent <agent> --yes

# Real install after merge
npx --yes skills add <owner>/<repo> --skill <name> --global --agent <agent> --yes
```

`<agent>` is the user's host (`claude-code`, `codex`, `opencode`), not every host. Installs may be symlinks, so check the resolved contents or use `--copy`.

## Listing

The skill lives at `https://skills.sh/<owner>/<repo>/<name>`. There is no submission step: the directory indexes from install telemetry, so the real install is what gets it listed. Never fake or repeat installs to trigger indexing. If `DISABLE_TELEMETRY` or `DO_NOT_TRACK` is set, leave it alone and report indexing as blocked unless the user says otherwise.

The page can return 200 with an error shell, so confirm it actually shows the skill. Search results lag behind detail pages.