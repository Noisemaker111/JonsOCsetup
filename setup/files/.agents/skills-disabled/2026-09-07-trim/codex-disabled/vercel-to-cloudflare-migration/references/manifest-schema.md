# Manifest schema

The JSON manifest is operational evidence, not a secret store.

Top-level fields:

- `migration`: name, created date, Vercel team label, Cloudflare account label, assigned nameservers, and status.
- `domains`: one object per registered domain.

Domain fields:

- `domain`: apex domain.
- `registrar`: provider, managed-access boolean, and old nameservers.
- `classification`: `application`, `redirect`, `intentional-404`, `inactive`, or `blocked`.
- `source`: Vercel project and current apex/`www` behavior.
- `target`: Cloudflare service type, Worker/Pages name, and route patterns.
- `dns`: zone status, parity status, mail-record parity, DNSSEC status, and optional notes.
- `approval`: scope and timestamp for the production change.
- `cutover`: nameserver result, authoritative confirmation, route result, and timestamp.
- `verification`: checks with URL, expected behavior, observed behavior, timestamp, and result.
- `rollback`: prior nameservers, fallback origin retained, and any route-removal note.
- `blockers`: unresolved access, certificate, runtime, or DNS issues.

Use ISO 8601 timestamps. Do not include tokens, cookies, passwords, secret environment variables, full registrant contact data, or billing data.
