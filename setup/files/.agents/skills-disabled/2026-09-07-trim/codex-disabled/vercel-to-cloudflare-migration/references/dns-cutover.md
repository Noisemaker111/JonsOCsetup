# DNS and cutover

## Before mutation

Create each Cloudflare zone and compare normalized name, type, value, priority, TTL relevance, and proxy state. Preserve all mail, verification, CAA, SRV, and application subdomain records. Check DNSSEC/DS state and save old nameservers.

## Reversible sequence

1. Pilot a representative low-risk domain.
2. Change registrar nameservers to the assigned Cloudflare pair.
3. Confirm saved registrar rows and public authoritative NS.
4. Wait for the zone and edge TLS to become active.
5. Attach both apex and `www` routes after the target exists.
6. Keep the old proxied origin temporarily as rollback where safe.
7. Verify TLS, apex, `www`, important paths/APIs, redirects, 404s, and mail DNS.
8. Process the approved named batch, verifying after each save.

Worker routes are usually more reversible than deleting a conflicting origin record. For an originless Worker route, a proxied documentation-range placeholder such as `192.0.2.0` can provide a DNS record after the old web origin is retired. Confirm the route works first and never replace mail or verification records.

If a route fails, remove only that route so retained fallback DNS can reach the old origin. For a zone-wide failure, restore recorded nameservers.

Run `audit-dns.ps1` and `verify-sites.mjs` after each batch.

