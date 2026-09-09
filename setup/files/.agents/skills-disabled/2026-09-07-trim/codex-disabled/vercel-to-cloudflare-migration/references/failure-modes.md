# Failure modes and fast checks

| Symptom | Check first | Common resolution |
|---|---|---|
| Build works locally, fails on Cloudflare | Clean checkout, package-manager pin, ignored/generated files | Track or generate required modules; align commands/runtime |
| App has missing config | Where the key is consumed | Put frontend-prefixed keys in build config; runtime secrets in Worker secrets |
| Copied environment value is invalid | Dashboard reveal state | Reveal actual value; reject bullets, ellipsis, or copied label fragments |
| Correct-looking build uses wrong code | Git owner/repo, branch, root | Correct the source mapping before retrying |
| `www` fails after origin deletion | Explicit `www` DNS record and Worker route | Add/repair both; prior fallback may have masked the gap |
| Zone active but HTTPS temporarily fails | Edge certificate status and propagation | Wait/retry; do not weaken TLS as a shortcut |
| Redirect loses path/query | Redirect Worker mapping/tests | Preserve pathname and search explicitly |
| DNS cutover breaks mail | MX/SPF/DKIM/DMARC parity | Restore preserved records or rollback nameservers |
| Downgrade says resource will not transfer | Storage/Integration connection list | Inspect exact resource; retain if active, separately authorize deletion if orphaned |
| Browser button/status is ambiguous | Final log, resulting account state | Do not infer from button text; inspect authoritative result |

