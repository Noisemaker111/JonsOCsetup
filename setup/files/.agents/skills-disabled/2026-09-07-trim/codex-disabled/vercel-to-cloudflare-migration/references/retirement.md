# Vercel retirement and billing

Retirement is separate from cutover and happens last.

## Readiness gate

- Active repository changes are merged to default branches.
- Cloudflare can clean-build and deploy without Vercel secrets or artifacts.
- Runtime/build/deploy environment categories are complete; values remain secret.
- Apex, `www`, wildcard, and non-web DNS no longer depend on Vercel unless explicitly retained.
- Storage, databases, cron, queues, callbacks, analytics, and integrations have a recorded disposition.
- Production smoke tests pass after old-origin DNS retirement.
- Rollback evidence and the observation result are recorded.

## Dashboard sequence

Use logged-in Chrome. Inspect team billing, domains, projects, Storage, and Integrations directly. Downgrade flows may merge an existing Hobby team into the paid team and delete the selected Hobby team. Read the final review literally and record the effect without copying personal billing details.

Treat **Will not transfer** as a discovery prompt, not proof that a resource is active. Open the named product/integration and inspect connections. Delete only when read-only evidence shows it is orphaned or empty and the user separately authorizes that exact deletion.

The final subscription downgrade/cancel action is a commercial mutation. Obtain action-time confirmation on the final review, click once, then verify the resulting plan/status and rerun production smoke tests.

