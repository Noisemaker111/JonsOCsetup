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
provider error bodies. The model context receives a bounded summary; full
observations are available on demand through the tool or CLI.

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
| Healthy account | Refresh every 30 seconds while the usage server is running; refresh on demand otherwise |
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

This supplies live capacity to the existing router. The earlier offline planner's
benchmark/quality policy is still separate: no inferred benchmark scores or
unmeasured cost-per-task data were added by this change.

## Observed verification

Live, read-only checks reused existing authentication and discovered:

- One Claude account shared by broker and native Claude Code, with a provider
  profile reporting Max 5x. The initial response showed 87% session use and 17%
  weekly use with the weekly reset about nineteen hours away.
- One OpenAI account shared by broker, OpenCode and Codex. Later checks exercised
  broker/OpenCode authentication failures and successful native Codex fallback,
  with the response account identity checked before acceptance.
- OpenCode Go's real rolling, weekly and monthly observations.

The programmatic CLI, cache projection, compact context summary, and broker/native
routing telemetry were exercised against those observations without asking the
user for balances or another login. These are time-stamped observations, not
permanent account facts. No browser or visible application was controlled.

Deterministic tests cover discovery, multiple accounts, duplicate grants,
model/feature scope, unfamiliar windows, malformed data, stale caches, reset
boundaries, auth fallback, provider isolation, backoff, and three independent
processes sharing one refresh. Bun builds the CLI and its dependency graph.

The full suite initially exposed a stale host-slot verifier. The installed binary
uses a different minified JSX factory and includes `session.panel`; the verifier
was updated from observed binary calls and rechecked without a screenshot.
Standalone TypeScript checking is not configured in this checkout: Node/Bun type
definitions are absent. No standalone tsc pass is claimed.

No Quest tool is exposed in this Codex session. Canonical file claims were read
and no active claims were found before edits; evidence is recorded here and in
the focused local commit rather than falsely reported as posted on the board.

Final verification: 580 tests passed, 1 skipped, 0 failed; smoke checks passed
103 tests. Commit 6046387 was promoted locally to gen-1788578957954 with no
publishing or pruning. Static plugin validation passed and the isolated host
completed a model turn with exit 0. It did not return the exact requested VALID
text; this is load/execution evidence, not exact-response evidence. Existing
host sessions pick up the generation on their next normal restart.

## Global-project regression checks

Global instructions and the usage tool description direct agents to call
`usage_status` through tools/code mode, not a repository-relative Bun script.
The registered plugin tool was exercised from two empty foreign project
working directories, sharing one account observation and leaving both projects
empty. Provider responses in this regression are deterministic fixtures.

Quest storage has a separate global boundary. The `fix_papercut` tool previously
passed `process.cwd()` as the ledger parent, creating project-local Quests.
It now uses the same canonical resolver as the board, Quest tool and dispatch.
The legacy `OPENCODE_PROJECT_ROOT` no longer redirects storage; an explicit
`OPENCODE_QUEST_ROOT` must be absolute and names the parent containing
`.opencode/quests`. The harness bridge forwards that dedicated pin.

The regression first failed against the old papercut tool, then passed:
a follow-up called twice from a foreign project creates one canonical Quest
and no project `.opencode` directory. Existing ledgers are preserved. A read-only
scan of roots known to OpenCode found the home ledger and isolated runtime
verification fixtures; it is not an exhaustive filesystem inventory.

Global-runtime verification: 583 tests passed, 1 skipped, 0 failed; 103 smoke
checks passed. The six Quest-root checks also passed after Windows drive-relative
pin hardening. Commit 70837fe was promoted to gen-1788579508573; static plugin
validation passed and the isolated host returned VALID (exit 0). No publishing,
pruning, or existing-host restart was performed.


## Conversation telemetry scope

The [Quest design](quest-cleanup-review.md#complete-telemetry-shared-by-agents-and-usage) specifies shared request/session telemetry, throughput, calibrated subscription attribution and API-equivalent valuation for usage_status and /usage. The shared status API now adds these aggregates alongside the preserved account snapshot contract; implementation and evidence are recorded below. Preserve existing callers and expose the same aggregates to agents and the terminal; use measured token records before inferring token equivalents from quota.


## Conversation telemetry implementation checkpoint — 2026-09-05

usage_status now accepts sessionID, questID, accountID, from/to (Unix ms),
includeWorkers, offset, and limit. Existing account snapshot fields remain
compatible. The host receives typed output as well as text/JSON content.
usage/status-api.ts supplies the same aggregates used by /usage.

The request collector observes host HTTP request/response hooks, preserving
response bytes and backpressure. It records sanitized identity, request kind
(including auxiliary/title/compaction calls), token/cache counters, response
and visible-output timing, and available per-request catalog price snapshots.
Provider totals are normalized into exclusive categories; combined output
remains recorded when a reasoning breakdown is unavailable. Missing rates or
timing are unavailable. Stored records contain no prompt/response prose or
credentials. Requests are deduplicated by ID in the shared JSONL store, honoring
OPENCODE_TELEMETRY_FILE and XDG_STATE_HOME. Tests use isolated paths.

/usage now starts with conversation totals and a worker-inclusive toggle.
Its context row uses the last measured primary request size and observation
age, not a sum of historical per-message token usage. It does not claim this
is an authoritative count of the next request. Both text/JSON and UI use the
same calculation and formatting modules.

Observed acceptance: actual installed standalone host, isolated config, and
a deterministic local HTTP provider passed load/identity/token/marker checks.
Report: .visual-e2e/telemetry-host-1788584557015/report.json. Earlier fixture
failures exposed the current directory-only plugin loader and an SSE end-marker
cancellation behavior; the latter now has a regression test. No real model
quota was consumed. Actual UsageDialog before/after captures with the same
fixture are .visual-e2e/usage-redesign/before-telemetry.png and
after-telemetry.png (100 x 40 cells). These are component captures, not a
claim of complete interactive host acceptance.

At this historical checkpoint these remained incomplete. Later checkpoints implement calibration/allowance rates, recoverable context, native event timelines, recorded benchmark evaluation and filtered usage views. Remaining gaps include live calibration evidence, older history import and complete production price schedules.
HTTP failures before a response remain pending observations; reconciliation
must distinguish them from actual running inference. No real-provider accuracy
or savings has been measured.

### Empirical calibration implementation checkpoint

Account refresh now appends deduplicated, sanitized window observations beside the account cache. Native numeric precision is retained; unknown meter rounding and reporting delay remain null. Request records carry an account-plan regime hash. No credentials or response prose enter these ledgers.

`usage/calibration.ts` pairs fully covered, settled intervals, rejects reset/replenishment, unknown external activity, missing components and unresolved rounded movement, and fits four nonnegative token weights where identifiable. Rank-deficient inputs use a labelled aggregate scale restricted to the observed token mix. Later independent sessions provide held-out bias, absolute error, observed interval coverage and comparison against a token-total baseline. Drift and regime/age mismatch disable prediction. Bounds are empirical errors, not guaranteed statistical confidence intervals.

`bun scripts/calibrate-usage.ts <replay.json>` replays recorded requests and explicit interval coverage without provider calls; `--save` saves a versioned fit. Input includes intervals (before/after observations, coverage, training/held-out split), requests or requestFile, and options (now, maxAgeMilliseconds, maxErrorPoints). This is a measurement pipeline, not a live accuracy claim. Naturally collected observations need established precision, delay and coverage before fitting. No paid or subscription benchmark was run.

The shared usage result includes separate calibrated account/window totals, conservative summed empirical bounds, versions, unknown request counts and percentage points per wall-clock minute. Overlapping quota windows are never summed together. Replay tests cover exact weight recovery, delayed/rounded readings, concurrency, missing activity, non-identifiability, held-out leakage, plan changes and drift: 43 focused tests passed including account API, collector and package boundaries. Live attribution remains insufficient-data until a valid fit exists.

### Shared calculation consolidation (2026-09-05)

The compatibility collector now reads request telemetry and delegates token/cache totals and request-specific valuation to usage/telemetry.ts. The former hardcoded database path, fuzzy model-price matching and cache-ignoring arithmetic were removed from its execution path. API-equivalent known subtotals remain separate from recorded actual charges. Legacy quota forecasts require two observed percentages from the same reset cycle; dollar movement cannot stand in for percentage-point movement. Missing observations remain unknown.

Recorded benchmark evaluation uses the same telemetry and rejects parent/descendant overlap across trials. The old unbudgeted benchmark launcher and destructive cleanup are retired; bench/runner.ts evaluates recorded-trials JSON without invoking a model. Historical result files are preserved. Focused account/collector/format/benchmark checks passed (47); follow-up shared forecast checks passed (14).

### Observed-history calibration batching (2026-09-05)

The existing calibrate-usage replay command also accepts observations, requests/requestFile, coverage and options. Coverage entries specify accountID, from/to timestamps, complete, externalActivity and an evidence source. Options add maxIntervalMilliseconds and heldOutIntervals (at least two) to the existing age/error policy. The pipeline groups account/window histories, batches unresolved rounded readings and delayed completions, rejects coverage gaps, contradictory observations, resets, mixed routes and unknown precision, and reserves later independent sessions for validation. Unexplained positive account movement remains explicitly unattributed. It never infers account-wide exclusivity from a local request log. Malformed request history blocks fitting instead of silently dropping records.

Eleven deterministic calibration tests passed (56 assertions). This extends offline automation; natural live observations still require established precision, reporting delay and account-wide coverage. No real quota consumption, accuracy or savings was claimed.

### Shared calibration validity (2026-09-05)

Fits now record validUntil from the explicit replay age policy. Both usage views use that recorded validity instead of an independent seven-day default; dispatch may impose a stricter configured maximum age. Older stored fits are preserved and can still be read, but require explicit age policy or revalidation before attribution. Expired/unknown-validity fits remain unavailable. Sixteen focused calibration/reservation tests passed.

## Reset pacing and model workload comparison

The shared status API and terminal now include account-wide reset pacing, recent
model workload evidence, dated published credit rates and typed workload
comparisons. See [reset planning](usage-reset-planning.md) for units, examples,
calibration requirements and the account-history path fix.
