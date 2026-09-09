---
name: github
description: Use whenever running git or gh commands on this machine — cloning, auth, staging, committing, pushing, PRs, or GitHub API calls. The one standard — existing repository authentication and remotes, explicit-path staging, and verification of authorized external changes.
---

# Git and GitHub

Use the current repository and its existing authentication and remotes.
The personal setup described below is not a rule for other users or machines. Windows mechanics live in the `windows-shell`
skill; publish gates live in `contribute`. This skill owns the mechanics.

## Authentication

- Use the existing authenticated transport. This personal setup uses gh over HTTPS; other repositories may use SSH or a different supported helper. Never put tokens in URLs or change authentication as a side effect of ordinary Git work.
- Anything 401/403 → `gh auth status` first. Expired → `gh auth login`.
  Missing scope → `gh auth refresh -s <scope>` and relay the one-time code to
  Jk (browser: github.com/login/device). Inspect current scopes when needed; do not assume a saved list is current.
- Preserve the configured Git identity. Inspect it when necessary; do not rewrite global identity or authentication as a side effect of repository work.

## Everyday mechanics

- Clone: `gh repo clone owner/repo` — https + auth, zero setup. Upstream
  or fork remotes as required by the target repository's contribution workflow.
- Defaults set globally: `core.autocrlf=input` (LF everywhere — never
  "fix" line-ending warnings by committing CRLF), `pull.ff=only` (a diverged
  branch is a decision, not an auto-merge), `push.default=simple`,
  `fetch.prune=true`, `init.defaultbranch=main`.
- **Staging discipline: never `git add -A` / `-u` in shared trees** (this
  config repo runs parallel sessions — `-A` once committed another session's
  WIP). `git status --short` FIRST, then add explicit paths only. Same rule
  for reset/checkout: read status before any tree-wide command, or you nuke
  someone's uncommitted work.
- Full lists need `--paginate` — page one silently truncates (that is how a
  whole `v2` branch went missing from a branch listing).
- Long/networked commands get a timeout; background ones write to a file.

## Destructive ops — verify or it didn't happen

- Use the repo's CURRENT name: renames redirect GETs but can silently no-op
  DELETEs through the redirect (a branch delete once reported success while
  the branch lived on under the new name).
- Every delete is followed by a verification GET that expects 404. No
  verification = not done.
- `--force` pushes, repo/branch deletion, scope grants: all need Jk's
  explicit go (the `contribute` skill's publish gate applies even here).

## PRs

- Specify the verified target repository, base and head when creating a PR.
  Use `<fork>:<branch>` only when the head actually lives in a fork. The base comes from the target repository contribution
  check — never the default branch, never whatever the UI preselected.
- After any push: `gh pr view` / `gh pr diff` and reconcile body vs
  diff. JSON field names differ between `gh pr view` and the REST API —
  when a field 404s in one, try the other (`author_association` lives only
  in REST).

## Failure playbook

- EBUSY / "file in use" on an exe: Windows locks running binaries — never
  update the running opencode host in place; side-by-side install, or wait
  until sessions are closed.
- npm `@opencode-ai/cli` postinstall fails: install the platform package
  explicitly (`@opencode-ai/cli-windows-x64@<same tag>`) or `npm pack` +
  extract the tarball and run `bin/opencode2.exe` directly.
- "Not Found" on a repo that exists: renamed repo — check redirect target
  with `gh api repos/<old>/ --jq .full_name`.
- Diverged branches: `pull.ff=only` makes pull refuse; rebase deliberately,
  never blind-merge.
