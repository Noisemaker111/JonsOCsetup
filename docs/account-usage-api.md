# Shared account and usage API

The account API discovers existing connections and retrieves plans and limits.
The Quest giver does not need the user to transcribe usage percentages or reset
times. It is the source used by `usage_status`, the usage dialog, the collector,
the model capacity adapter, the account-status command, and the pre-dispatch check.

## Use it

In OpenCode2, call the globally registered `usage_status` tool directly:

```json
{"format": "json"}
```

Use the same tool through code mode's tool API. It works from any project
working directory and needs no shell command, Bun process, relative import,
or checkout of this config repository. `refresh` and `accountID` are optional.
Normal calls refresh due accounts and reuse fresh observations.

Trusted plugin code can import the public `usage/account-api.ts` surface and
call `getAccountUsage()` in-process. Resolve it from the installed plugin,
not from the user's project directory.

For manual maintenance **inside this config repository**, the CLI is optional:

```powershell
bun run runtime:usage --text
bun run runtime:usage --refresh
bun run runtime:usage --cached --account <opaque-account-id>
```

Default CLI output is JSON; `--cached` makes no provider calls.

The API returns account IDs, discovered connection owners, the connection that
provided the latest observation, plan metadata, scoped quota windows, absolute
reset timestamps, per-account freshness, retry times, and errors. It never returns
access tokens, refresh tokens, upstream account IDs, email addresses, or raw
provider error bodies.

`usage_status` answers with a digest whose size does not depend on how much history
the machine holds: the accounts and their pools, pacing, the calling conversation's
own request and token counters, and collector freshness. History is behind a named
`view`, each one a page the caller sizes with `offset` and `limit` and each one
reporting `total` and `nextOffset`: `requests`, `sessions`, `timeline`,
`pools` (needs an exact `accountID`), `models`, `workloads`, `harvest`. The text
format follows the same rule. `usage_pacing` remains the compact controller view
and `usage_experience` the cached-evidence view.

## Identity and authentication

An account and a credential are different things. OpenCode, Codex, and a broker
can all hold credentials for one ChatGPT account. Those connections share one
account's quota observation. Two ChatGPT accounts remain two account records,
even behind one broker.

Discovery currently reads:

- CLIProxyAPI's configured auth directory, including enabled Codex, Claude,
  and xAI records and account prefixes.
- OpenCode OAuth entries and its OpenCode Go subscription key.
- Codex's file-backed OAuth credentials, honoring `CODEX_HOME`.
- Claude Code's credentials and account/organization metadata, honoring
  `CLAUDE_CONFIG_DIR`.

OpenAI identity comes from the account field or account JWT claim. Claude identity
includes both account and organization. Emails are never deduplication keys.
When no authoritative identity exists, a record is explicitly a connection
identity rather than a claimed account identity. IDs are opaque stable hashes.

No credentials are copied between stores. The existing application or broker
retains refresh-token ownership. An authentication failure tries other existing
connections **for the same account**, and the successful connection is preferred
on subsequent refreshes. Removing a connection removes it from the next inventory;
removing all connections removes the cached account from active results.

If every credential stops working, the API reports `auth-required` with an
existing-owner refresh instruction. It does not run an interactive login or
rotate another application's refresh token. Keyring-only credentials without a
readable supported owner adapter are not discovered yet.

For future voice or other plugins, reuse this account service and add the
capability's provider adapter. Do not add a separate usage login. A credential
grant still has an audience, scope, and entitlement: recognizing the account
does not prove a voice endpoint is authorized or included in its subscription.
Universal credential transfer is not implemented or assumed.

Relevant first-party references:
[Codex authentication](https://learn.chatgpt.com/docs/auth),
[Claude Code authentication](https://code.claude.com/docs/en/authentication).
Provider web usage endpoints are isolated behind adapters because their schemas
can change independently of public inference APIs.

## Provider observations

OpenAI uses `GET https://chatgpt.com/backend-api/wham/usage`, with the selected
account's bearer and account header. It preserves the plan type, exact durations,
shared windows, additional named-model/feature windows, and per-model availability.
A model availability flag does not fabricate a usage percentage. A response
naming another account is rejected.

Claude uses `GET https://api.anthropic.com/api/oauth/usage` and a separately
cached `/api/oauth/profile`. The latter supplies plan and rate-limit tier,
including observed Max 5x/20x multipliers. Shared session/weekly, model-family,
and unknown future pools retain distinct scope. Extra usage enabled/disabled
is observed, never changed.

OpenCode Go uses its existing subscription key at
`https://opencode.ai/zen/go/v1/usage`. Its real rolling, weekly and monthly
windows survive. A monthly window without a supplied duration is not invented
as exactly thirty days. When the response does not name a plan tier, the API
leaves the tier unknown.

Grok accounts can be discovered, but a verified subscription-usage adapter is
not available here yet. Such an account reports `unsupported`; the service
does not try paid xAI APIs or guess a balance from a plan's dollar price.
Legacy local spending/history for other providers remains in the usage view.

## Freshness and failure behavior

| Case | Behavior |
|---|---|
| Many callers in one process | One shared in-flight promise per cache |
| TUI, CLI, collector, different generations | One file lock and atomic shared cache |
| Several host processes on one machine | One holds the refresh lease and polls; the rest read the cache it writes |
| A lease that stops being renewed | Another process takes it over; no process inspection or termination |
| Healthy account | The lease holder refreshes every 30 seconds while the usage server is running; refresh on demand otherwise |
| Repeated provider throttling | The interval widens with each consecutive rejection, starting at the refresh interval and stopping at five minutes; Retry-After is a floor, never a ceiling |
| Approaching reset | Next refresh scheduled at the observed boundary when sooner than the normal TTL |
| Reset passed | Old observation cannot authorize restored capacity |
| One provider fails | Other accounts still refresh |
| Request fails | Preserve previous observation time and windows, mark state/error honestly |
| Repeated failure / Retry-After | Account-specific bounded backoff; forced calls still respect it |
| Stale observation | Explicit freshness metadata and unknown routing capacity |
| Duplicate credentials | One account; try existing alternatives and remember the working connection |
| Multiple accounts behind an unprefixed route | Ambiguous/unknown; require an account-prefixed route |
| One model is exhausted | Block that model's pool; retain other models' independent eligibility |
| Unknown pool or duration | Preserve it as unknown; never coerce to a 5h/7d/30d bucket |
| Provider profile failure | Keep valid usage; retain prior plan with its own provenance/time |
| Missing or invalid cache | Rediscover and rebuild; no invented healthy balance |

All adapter requests use fixed HTTPS provider URLs, disallow redirects, and have
a timeout. Quota calls do not send inference prompts. An in-flight credential
owner refresh may make a later retry succeed without another login.

State lives under `~/.local/state/opencode/` by default, honoring
`XDG_STATE_HOME`. `account-usage.json` is the shared account snapshot;
`usage-cache.json` holds the legacy local usage history. Neither is written into
immutable generation directories. The old config-local cache is read only as a
migration fallback. Reset countdowns are recomputed from absolute timestamps.

Overrides: `OPENCODE_ACCOUNT_USAGE_FILE`, `OPENCODE_USAGE_CACHE_FILE`,
`OPENCODE_CONFIG_DIR`, and the vendor directories above.
`OPENCODE_ACCOUNT_DISCOVERY_ROOT` provides an isolated home layout for tests.
Tests pin discovery and caches to scratch paths, so no test reads real credentials
or refreshes live usage.

## Routing and presentation

The router resolves native and broker routes to account pools. A prefixed broker
model selects that account; an unprefixed model matching multiple accounts is
not assigned an aggregate balance. Confirmed exhaustion or an unusable credential
blocks the native pre-dispatch path rather than silently replacing a named model.

The TUI and text/JSON tool consume the same API. The TUI refreshes while its dialog
is open and recomputes countdowns locally. Its account headings show the plan
and a short account identifier; full window IDs and provenance remain available
in JSON. Model-specific exhaustion does not label the whole account exhausted.

The account service supplies quota facts. The [dispatch planner](account-aware-routing.md) combines them with the user's task, price, quality, and route policies; account discovery does not itself choose a model.

## Request and task telemetry

`usage_status` accepts `view`, `sessionID`, `questID`, `accountID`, `from`/`to` (Unix milliseconds), `includeWorkers`, `allSessions`, `offset`, and `limit`. Without `sessionID` it scopes to the calling conversation; `allSessions` widens it. The same status API supplies the terminal usage view. Its context size is the last observed primary request, not a sum of historical token use or a guarantee of the next request size.

Captured requests reach the SQLite ledger beside the request log as they happen, and the passive collector backfills only what the events missed: the bytes appended to the request log since its recorded cursor, the Codex rollouts whose size or modification time moved, and the host messages recorded since the last host scan. A collection tick that finds nothing new writes no request rows. The request log remains the durable append-only record; the ledger is what every bounded query reads.

Captured requests retain account and exact route identity, request kind, exclusive input/cache/output/reasoning counters, timing, and a saved price schedule when available. Auxiliary calls and failed attempts remain visible. Repeated observations are deduplicated by request identity. Stored telemetry does not contain prompt/response prose or credentials.

Task reports join observed native requests to recorded Quest runs. Linked permission reviews are shown separately and included in captured task totals. Missing support coverage and unallocated giver/integration overhead remain explicit. API-equivalent estimates are separate from recorded actual charges. See [task and model measurements](account-aware-routing.md#task-and-model-measurements).

Source counters can overlap. Native host corroboration is not added to HTTP telemetry a second time; imported Codex observations retain their own account and source coverage. Missing external activity prevents claiming a complete account bill or complete cross-harness task attribution.

## Allowance calibration

Sanitized account-window observations are retained alongside the cache. Calibration requires compatible account/plan/reset scopes, settled request intervals, known coverage, and identifiable token mixes. Precision, reporting delay, external activity, and reset movement can leave the result insufficient-data. List prices never become subscription percentages.

`usage/calibration.ts` separates training from later held-out observations. Stale fits, drift, missing components, unknown coverage, and changed regimes disable prediction. Empirical error bounds describe observed performance, not a guarantee. No calibration is created merely because a task report has token totals.

See [usage pacing](usage-reset-planning.md) for targets and [historical implementation evidence](history/account-usage-implementation.md) for dated observations. Current values must come from the API or provider observation, not that history.
