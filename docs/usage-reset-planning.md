# Planning useful work toward a usage reset

Call `usage_status` with `format: "json"`. `planning` is account-wide even when
request history is filtered to the current conversation. Every pool keeps its
own scope, percentage, observation time and reset. Never apply the Spark reset
to Astra or combine weekly and five-hour percentages. Missing/reset/stale pools
remain unavailable. The default reserve is zero; `reservePoints` explicitly
leaves that many percentage points in every pool.

`requiredPointsPerMinute` is remaining spendable percentage points divided by
minutes until reset. `observedPointsPerMinute` uses a monotonic same-regime,
same-reset interval between one and thirty minutes, ending at the current
observation. It includes other applications using the account. A flat rounded
counter gives zero observed movement, not evidence that requests are free.
The pace multiplier is a feedback target, not a worker concurrency multiplier.
Provider precision and reporting delays may be unknown; rate projections are
estimates. Refresh during useful work and reassess after batches. Do not promise
exact exhaustion at the reset boundary.

`models` supplies the last thirty minutes of measured requests grouped by account
and exact route (including reasoning and service tier). It shows sample counts,
complete-token coverage, token means and overlapping versus summed request time.
These are requests observed in sessions, not completed-session prices. An empty
model history is missing evidence. Auxiliary calls remain included.

For a model comparison, pass up to twenty independent `workloads`, each with a
label, accountID, exact route, requests and per-request token counts:

```json
{
  "format": "json",
  "workloads": [{
    "label": "Ten Luna requests of this size",
    "accountID": "<account ID from usage_status>",
    "route": {"providerID": "openai", "modelID": "gpt-5.6-luna", "serviceTier": "standard"},
    "requests": 10,
    "tokens": {"input": 100000, "cacheRead": 200000, "outputIncludingReasoning": 10000}
  }]
}
```

Input excludes cached input. Output includes reasoning. Copy observed route
reasoning/variant/harness when asking for calibrated quota estimates; do not
invent missing tier metadata. Ten sessions only become comparable once their
request counts and token mixes are estimated from relevant work. Means from
recent history are a starting point, not a guarantee for a different task.

The published credit card is dated and expires after two weeks so changed
pricing cannot silently persist. Its source and speed rules are returned with
estimates. Broker model aliases and unknown service tiers are not guessed.
Published credits are neither actual charges nor a known denominator for
included-plan percentage. Standard Astra rates are 250/25/1250 credits per
million uncached/cached/output tokens; Luna rates are 5/0.5/30. For the example,
ten Luna requests value at 9 credits, versus 42.5 credits for one identical
Astra request. This does not claim equivalent work quality or elapsed time.
Sources checked 2026-09-07: [pricing](https://learn.chatgpt.com/docs/pricing),
[speed](https://learn.chatgpt.com/docs/agent-configuration/speed).

Quota estimates require the existing independently validated calibration for
the exact account, plan regime, route and window. All applicable windows retain
separate bounds and fit results. `requestsWithinUpperEstimate` uses the upper
estimated per-request cost and the reserve. It is not a guarantee or a dispatch
authorization. Missing, expired or drifting calibration stays unknown. No
calibration is automatically manufactured from mixed-account activity or API
prices. Offline calibration remains `scripts/calibrate-usage.ts`; its coverage,
precision, reporting delay and independent holdout requirements still apply.

The Quest giver obtains these fields from the global typed tool; it needs no
project-relative shell command or additional generic orchestration tool. Use
real pending work to decide scope and model, then use these measurements to
adjust batch size. The tool does not launch workers or purchase credits.

The shared status reader now loads quota history from `ACCOUNT_USAGE_FILE +
".observations"`, matching the account service writer. Previously it looked beside
the request log, so the recorded account history was absent from its calculations.
The text tool and terminal conversation-usage view share the same formatter.

## Harvest actual concurrent sessions

Call `usage_status` with `{"format":"json","harvest":true}` to read numeric
Codex rollout counters for all local sessions, children and guardians. This is
supplemental read-only evidence, not Codex dispatch support. The default range
is four hours; `from`/`to` select at most seven days. Current-conversation filters
do not hide sibling sessions from the harvest. The result is separate from
OpenCode request totals to prevent cross-host double counting.

Every accepted point reconciles cumulative token-counter movement against the
last-request counters. Repeated cumulative counters contribute no extra tokens.
The first session metadata record owns a forked rollout; inherited metadata
cannot replace its identity, and records before its creation are excluded.
Counter resets, gaps and unknown components remain rejected intervals. Cached
input and reasoning are separated from their enclosing totals exactly once.
Guardian activity retains its actual recorded model, not a guessed Astra price.

Rollouts do not supply authoritative account identity. Their quota readings are
not attributed charges. Multiple accounts, activity outside these logs, guardian
cost rules and provider reporting lag still prevent causal per-model allowance
calibration from concurrent usage alone. The rollout reader makes no new login or network request
and returns no prompts, tool arguments, response text or credentials.

For repeatable local graphs inside this repository:

```powershell
bun scripts/harvest-usage.ts --from 2026-09-07T21:00:00Z
```

This refreshes provider quota into an isolated output cache, reads live rollouts,
and writes sanitized `run/usage-evidence/usage-evidence.json` plus
`astra-evidence.html`. The graph is a dated snapshot, not a live polling display.
The figure uses official account observations for its quota series, and refuses
to combine accounts or independent pools. Legend controls toggle family lines
and token components; cursor/touch details show exact measured values. It can
be regenerated while the sessions continue. No sessions are started or stopped.

The on-demand reader bounds inventory to 20,000 files, parses at most 500 recent
rollouts, and caps file/batch bytes at 64/256 MiB. Missing files, malformed lines,
truncation and counter gaps are coverage limitations, never evidence of zero use.
Tests set a scratch CODEX_HOME; no test reads real rollouts.

## Passive accounting and saved deadlines

The usage server starts a shared collector automatically. Native HTTP counters
update the ledger immediately; a 30-second collector imports local Codex rollouts
and backfills native records. It also reads numeric projections from the current
OpenCode2 `session_message` table as a separate `opencode-host` source. Host
normalization can coerce missing components to zero, so this is corroborating
evidence and is excluded from empirical fitting. Host message counters can also
omit auxiliary calls: the isolated fixture observed two HTTP calls but one
stored assistant message. Every fixture call remained in HTTP accounting; it is not added to HTTP counts
as unique billed activity. A cross-process lease prevents every open host
from scanning the same files. The ledger is SQLite beside the request telemetry
file, with durable source/request identities, session lineage, quota observations
and explicitly unclassified counter intervals. Replaying a scan cannot add the
same tokens twice or overwrite finalized native counters with an older running
snapshot. The first scan covers up to seven days; later scans overlap by five
minutes. Capture boundaries, scanner caps, staleness and missing components remain
visible. Counts cover provider-reported activity, not unobservable tokens on
other machines or usage without a counter breakdown.

The session footer displays uncached input, cached input and output including
reasoning, with pending/partial markers. Each OpenCode turn receives bounded,
cached accounting feedback and any saved deadline; the prompt path does not
probe providers or scan Codex logs. `usage_status` returns persisted accounting
by default. Source totals are shown separately: overlapping captures through a
harness cannot be deduplicated authoritatively without a shared provider request
identity. The combined recorded sum is not a claim of unique billed tokens.
Set `allSessions:true` for every captured session, or `sessionID` and
`includeWorkers:true` for a session family. Request/model tokens, context size,
published credit equivalents and provider quota percentages remain distinct.

`usage_target` saves an exact account ID, `deadlineAt` (future Unix milliseconds)
and optional `reservePoints`. Set `deadlineAt:null` to clear it. Targets survive
reload and are shared across sessions. `usage_status.deadlineAt` can override the
saved target for one query. Each pool uses the earlier of its reset and the target
deadline; forecasts never extrapolate remaining capacity through a reset. Expired
targets are reported as expired. No work is dispatched automatically.

The accounting view stores nonoverlapping quota/token intervals per account,
plan regime and pool. It can show “2.05 points observed alongside X uncached,
Y cached and Z output tokens.” This is a coincident measurement, not proof that
those tokens caused the entire charge. Unbound Codex activity can be associated
provisionally only when exactly one OpenAI account is connected; multiple accounts
remain ambiguous. Missing counters, known gaps and scanner limitations exclude
intervals from model fitting.

Empirical rates use observed token components grouped by provider, model, reasoning,
service tier and host. The fitter needs enough independent token mixes, rejects
rank-deficient categories, enforces nonnegative rates, and evaluates three later
held-out intervals against an observed-rate baseline. Its coefficients are always
provisional while external activity, meter precision or reporting delay is unknown.
The strict validated calibration used for workload admission remains a separate
contract. A fit is not an exact subscription billing formula.

Exhaustion forecasts use the latest account-wide pace with scenarios from recent
5/15/30-minute observations. These are pace scenarios, not statistical confidence
intervals. Unknown provider precision and reporting delay are returned explicitly.
The terminal shows plan-specific quota sparklines and the latest observed token
mix; the JSON result contains the interval history and held-out model errors.

An isolated, repeatable monitor is available for read-only evidence collection:

```powershell
bun scripts/usage-monitor.ts --out run/passive-evidence --samples 2
bun scripts/usage-monitor.ts --out run/passive-evidence --watch --deadline 2026-09-08T02:00:00Z
```

The monitor refreshes quota into its own output cache and atomically updates
`accounting.json`; its SQLite ledger survives a restart. `--watch` continues until
stopped. This is a diagnostic command, not a deployment or session restart.
Production server/TUI activation still follows the reviewed merge and promotion
gates. The host check uses an anonymous local fixture provider, and the footer
check renders the actual component at 80 and 120 columns:

```powershell
bun scripts/verify-telemetry-host.ts
bun --preload @opentui/solid/preload scripts/verify-usage-footer.ts
```

Unchanged valid cumulative counters take precedence over an inconsistent
last-request field. These rows are repeated readings, not lost token intervals.
Previously flagged rows retain a resolution record in SQLite, and the parser
version triggers a bounded replay so the coverage report is repaired without
changing measured token totals. Genuine cumulative movement that cannot be
reconciled remains an unresolved gap.

Workload comparisons also return `empiricalScenario` once a provisional fit is
available for the exact account, plan, pool, reset, provider and model route.
Evidence older than 30 minutes, unseen token categories and token proportions
outside the observed range are rejected. The scenario multiplies learned rates
by the supplied per-request token mix and request count; ten sessions alone do
not specify a workload. Its historical-error range scales the maximum held-out
error by the requested volume relative to observed intervals. This is explicitly
not a confidence bound. Strict `estimate`, `fit` and admission capacity remain
unavailable without validated calibration. The terminal labels these provisional
scenarios separately from published credits and verified allowance estimates.


Opt-in Quest pacing uses the existing `usage_target` tool. Supply
`questPacing: {windowID, maxConcurrent}` with the exact shared pool and a finite
ceiling from 1 to 16. The saved target pins the current plan and reset. Explicit
`quest run.continue=true` requests supply the authorized useful work; the target
never creates Quests, mines historical backlogs, or starts a second scheduler.
The supporting OpenCode server must remain running for continuations to advance.

The controller begins at one desired slot, changes at most one slot every five
minutes, and uses a 20% pace adjustment band. Above-target activity can reduce
new admissions to zero while current work finishes. `usage_status.burnControl`
reports desired concurrency, actual account pace, decision time and reason.
Actual launches and outcomes remain in the Quest run records. Unknown launches
count against reservations. Existing exclusive holds remain intact. For new
explicit configured-choice subscription runs, opting into pacing replaces the
default single-worker restriction with the finite desired cap. These reservations
are labeled paced and uncalibrated. Without this opt-in the default is unchanged;
route access, other quota pools, quality and billing restrictions still apply. A desired ceiling is not a promise
that those workers are admitted or that quota will reach exactly zero on time.

Stale observations pause admission. Depletion, an expired deadline, or changed
plan/reset stops the scoped controller until the user explicitly saves a new
target. The runtime rechecks after workspace setup and before the worker prompt.
Cancellation of a continuation prevents its future launches; existing workers
are preserved. Clearing the usage target disables pacing controls; cancel the
continuation as well when the intent is to stop the authorized work.

Verify the native pacing tool with `bun scripts/verify-burn-host.ts`. It uses an
anonymous local provider and isolated state, and confirms the real Code Mode
call, exact shared target, and durable desired-concurrency record. Reservation
and continuation tests separately verify actual admission/hold transitions.

`bun scripts/verify-model-worker-host.ts --paced` additionally runs a real
installed-host worker on a synthetic subscription route, checks the paced
reservation, verifies its owned file change, and observes terminal settlement
and attributed telemetry. No live model allowance is used by this fixture.

## Per-session burn and reconciliation

`usage_status` returns `accounting.sessionBurn`: separate account/plan/pool/reset scopes, exact known token counters by session and route, pending requests, 1/5/15-minute wall-clock token rates, and the latest 20 request breakdowns for each route. Cached reads, uncached input, cache writes, visible output and reasoning remain separate; the combined output category includes reasoning once. A context window size is not a count of newly consumed tokens. In-flight tokens become measurable when the provider returns counters.

Allowance rates and request estimates require an identifiable, fresh empirical model and an observed token mix. Unknown values remain null. Host message counters corroborate HTTP counters and are excluded from this estimator; ambiguous Codex account mappings are excluded. Source counters are not a proof of unique account billing coverage.

The reconciliation graph predicts each interval from strictly earlier observations, then measures provider movement minus that prediction. It reports maximum/mean absolute error and the fraction within **0.01 percentage points**. Eight chronological tests are required before reporting that the observed tests meet the target. This chronological replay uses currently available counters, including late arrivals; it is not a log of forecasts recorded in real time. It does not establish provider precision or guarantee future accuracy. Missing requests and coverage gaps cannot produce a successful prediction. Empty captured activity without calibration cannot count as an accurate zero prediction. Training uses at most 96 prior five-minute intervals; the graph displays at most 48 intervals. Resets and plan changes stay separate.

Generate a private, offline graph and numeric report with:

```powershell
bun scripts/session-burn-report.ts --out run/session-burn-report
```

Add `--watch` to collect every 30 seconds and rebuild the report; the HTML refreshes automatically. `--ledger` and `--accounts` select existing diagnostic evidence without changing it. The graph compares observed movement, prior predictions and residuals; clicking a session shows request token details. The runtime's existing passive collector and global status API supply ongoing collection without a separate report process.

A small displayed decimal is not evidence of precision. `evidence` reports the number of complete intervals and active token features alongside the minimum sample requirement. Rate changes, unknown external activity, reporting lag, meter rounding and correlated token mixes can prevent 1:1 attribution. These conditions must remain visible rather than being corrected by assigning all residual usage to the latest session.


## Subscription portfolio pacing

`usage_pacing` is the compact scheduler-facing tool. It returns each account's own quota pools, deadline/reset, measured and required pace, desired concurrency and constraints. It deliberately omits token history and calibration matrices; `usage_status` remains the detailed accounting view. Keep this small status in the giver's context and leave project backlogs and investigation evidence in Quests. Requested slots are not actual worker counts or an eligible-work queue.

Accounts keep separate balances even when they share a provider or subscription name. All shared limits constrain admission; model-specific limits remain scoped to their models. Ambiguous account selection is not usable capacity: dispatch requires the transport/model mapping to identify one account, including for routes with quality evidence. A broker prefix can distinguish accounts only when its actual configured mapping is unique. No prices or account percentages are summed into a fictional shared balance.

For a one-off notification, save the desired future `deadlineAt` with `usage_target`. It stops at that deadline and does not automatically extend. For recurring use, explicitly pass `followResets: true`, `questPacing`, and a `deadlineAt` exactly equal to the selected pool's observed reset. After that reset, passive collection may renew this same account/plan/pool only when a fresh post-reset observation establishes its next reset. Missing, stale, changed-plan and disconnected accounts do not renew. Clearing the target prevents renewal. Each account opts in independently; existing targets remain one-off by default.

The passive usage timer now updates feedback as well as counters. A measured deficit can increase desired slots by the required pace ratio, capped at 2x per five-minute adjustment and the account's configured ceiling (currently 16). Unknown pace permits at most one initial worker; downward pacing lets current work finish. The controller still respects access, billing policy, reservations and all quota limits. Recurring mode does not buy additional usage or bypass a provider limit. Cross-project work supply and verified actual dispatch remain separate integration work.


Capture diagnostics accompany HTTP request history: normalized media type, detected framing, parsed/usage payload counts, parse failures and truncated buffers. No response text is saved. The observer detects SSE even when the media type is absent or unexpected, accepts CR/LF framing, and flushes already-received terminal usage on cancellation. Regression tests reproduce lost counters in these cases; an installed-host fixture verifies SSE carried as `application/octet-stream`. This does not retroactively repair historical missing counters or prove which framing issue affected a particular live session. Fresh capture evidence must verify that gap before fitting allowance rates.
