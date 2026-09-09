---
name: vercel-to-cloudflare-migration
description: Migrate portfolios of Vercel projects and domains to Cloudflare Workers or Pages. Use for inventory, framework/runtime porting, environment-variable transfer, DNS and nameserver cutover, Vercel resource retirement, subscription cancellation readiness, rollback, and production verification.
---

# Vercel to Cloudflare Migration

Use the manifest as memory. Do not repeatedly narrate facts already recorded there.

## Start

1. If no manifest exists, run `scripts/new-manifest.ps1`.
2. Run `node scripts/portfolio-status.mjs <manifest.json>`.
3. Load only the reference for the reported phase:
   - inventory/deployment: [inventory-deploy.md](references/inventory-deploy.md)
   - DNS/cutover: [dns-cutover.md](references/dns-cutover.md)
   - Vercel retirement/billing: [retirement.md](references/retirement.md)
   - a known anomaly: [failure-modes.md](references/failure-modes.md)
4. Record evidence in the manifest after each batch. Report only changed state, blockers, approvals needed now, and the next action.

## Non-negotiable rules

- Prefer the user's logged-in Chrome for dashboards, OAuth, ambiguous mappings, and production mutations.
- APIs/CLIs are preferred for repeatable inventory, builds, and verification when already authenticated.
- Treat apex, `www`, wildcard, redirects, APIs, and intentional 404s as separate behaviors.
- Preserve MX, SPF, DKIM, DMARC, CAA, verification, SRV, and other non-web records.
- Never put tokens, cookies, passwords, secret values, registrant details, or billing details in the manifest or logs.
- Reveal dashboard environment values before copying. Reject bullets, truncation, or key-name fragments; validate shape without printing the value.
- `VITE_*` and similar frontend variables are build-time inputs, not Worker runtime variables.
- Verify Git owner/repo, production branch, root, package-manager pin, build command, and deploy command from a clean checkout.
- A successful prebuilt artifact is not proof that Cloudflare can rebuild without Vercel.
- Classify every domain: `application`, `redirect`, `intentional-404`, `inactive`, or `blocked`. Do not turn an old 404 into an invented application.
- Make production changes in named batches with action-time approval. Resource deletion and billing cancellation need their own confirmation.
- Keep rollback data until post-cutover verification passes. Cancellation is last.

## Commands

```powershell
./scripts/new-manifest.ps1 -Domains a.com,b.com -Output migration.json
./scripts/audit-dns.ps1 -Manifest migration.json -Output dns.json
node ./scripts/portfolio-status.mjs migration.json
node ./scripts/verify-sites.mjs migration.json
```

The scripts are read-only except `new-manifest.ps1`, which creates a local manifest. Dashboard or infrastructure changes remain visible, reviewed actions.

