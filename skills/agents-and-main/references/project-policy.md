# Project release policy

Use this as a compact record in the project's existing instructions or release documentation. Fill in observed values; an unknown is a task to resolve, not a permission grant. Omit components the project does not have.

## Minimal root AGENTS.md note

Adapt this paragraph to the project's actual authorization and policy path; add it
once to the repository-root `AGENTS.md`, creating that file if absent. Keep the
project's existing mission and unrelated instructions. The example assumes agents
integration is already authorized; otherwise record the actual approval boundary.

> Follow the agents-and-main workflow in [DEVELOPMENT.md](DEVELOPMENT.md).
> Use `sb agents` / `sb main` only in a checkout you own; do agent work in isolated
> worktrees. Authorized agents integrate into `agents` after verification and CI.
> Only the human merges `main`; prepare releases only when the user requests them.

Keep detailed commands and gates in the linked project policy. Reopen both files
after saving and check that no old instruction contradicts the authorized workflow.

| Decision | Project value |
| --- | --- |
| Stable branch and customer URL/runtime | |
| Dev branch and developer URL/runtime | |
| Frontend and backend revision evidence | |
| Dev data, storage, jobs and integration targets | |
| Stable data, storage, jobs and integration targets | |
| Local readiness and required check commands, with working directories | |
| CI workflow and exact required checks | |
| Authorized dev actions and who authorized them | |
| Maintainer eligibility, all-agent automation trigger and branch protection | |
| Dev deployment trigger and verification operation | |
| Human who personally merges stable (agents never merge stable) | |
| Stable deployment trigger and verification operation | |
| Release candidate pinning, automatic patch notes and release CI | |
| Previous artifact, rollback command and data compatibility limits | |

For a web application, a typical mapping is `dev` to an internal environment with its own backend/data and `main` to the customer environment. Choose real provider resources before enabling deployment triggers. Feature flags can control exposure within an environment, but do not provide data isolation.

For local source checkouts, adopt the shared `sb agents` / `sb main` command from this skill. Git retains the selected branch. Agents use owned worktrees and preserve active sessions. A branch switch changes disk files; running processes and mutable runtime state need their own explicit lifecycle when applicable.

Define automatic dev integration narrowly enough to enforce: eligible actor or trusted PR source, dev as base, required checks at the reviewed head, and excluded actions requiring separate approval. If branch protection or automation is unavailable on the host or plan, document the limitation and use an authorized coordinator to enforce the checks; do not claim server enforcement exists.
