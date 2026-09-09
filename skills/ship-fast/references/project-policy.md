# Project release policy

Use this as a compact record in the project's existing instructions or release documentation. Fill in observed values; an unknown is a task to resolve, not a permission grant. Omit components the project does not have.

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
| Auto-merge actor, trigger and branch protection | |
| Dev deployment trigger and verification operation | |
| Stable approver and release gate | |
| Stable deployment trigger and verification operation | |
| Release candidate pinning and customer notes | |
| Previous artifact, rollback command and data compatibility limits | |

For a web application, a typical mapping is `dev` to an internal environment with its own backend/data and `main` to the customer environment. Choose real provider resources before enabling deployment triggers. Feature flags can control exposure within an environment, but do not provide data isolation.

For a local tool, a typical mapping is a dev launcher and a stable launcher selecting immutable release directories with separate mutable runtime state. Verify both launchers and preserve already running sessions.

Define automatic dev integration narrowly enough to enforce: eligible actor or trusted PR source, dev as base, required checks at the reviewed head, and excluded actions requiring separate approval. If branch protection or automation is unavailable on the host or plan, document the limitation and use an authorized coordinator to enforce the checks; do not claim server enforcement exists.
