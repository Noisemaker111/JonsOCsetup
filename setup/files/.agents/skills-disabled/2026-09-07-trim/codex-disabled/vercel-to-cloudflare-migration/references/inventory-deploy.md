# Inventory and deployment

Use this phase until every active hostname has a reproducible Cloudflare target.

## Inventory once

Record Vercel team/project/domain mappings, intended behavior, registrar, authoritative nameservers, framework, repository, branch, root, commands, environment key names, storage, cron, queues, callbacks, analytics, and integrations. Mark inactive registrations as excluded inventory; they do not block active sites.

## Choose the target

- Static/SPA: Pages or static-assets Worker.
- Next.js/SSR: supported Cloudflare adapter; test middleware, server APIs, image handling, caching, and Node compatibility.
- API/background work: Workers plus the required Cloudflare or external services.
- Redirect-only: shared Worker with an explicit host map; preserve path/query.
- Intentional 404: shared Worker returning an explicit 404.

## Environment transfer

Classify keys as runtime secret, runtime non-secret, build-time public input, deploy credential, obsolete, or intentionally disabled. Copy real revealed values through secret stores; never place them in evidence files. Validate URL/boolean/number/key shapes in memory.

## Reproducibility gate

From a clean checkout, verify repository owner/name, default/production branch, root, package-manager pin, install/build/deploy commands, ignored/generated modules, and all required secret stores. The final build/deploy log and deployed version are authoritative; a **Retry build** button is not failure evidence.

Do not advance until each active target builds and deploys without reading Vercel's environment store.

