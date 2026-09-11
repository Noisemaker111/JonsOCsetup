# Account-aware routing and dispatch

Follow-up: the [shared account/usage API](account-usage-api.md) now automatically discovers existing connections and supplies live capacity to the existing router. Manual account balances are not required. Quest run now calls the shared planner through the dispatch adapter; production policy and host acceptance remain outstanding.

Current source integrates the existing planner with Quest run, shared and matching model-specific account windows, and durable concurrent reservations. User policy controls allowed routes, quality, cash limits and reserves; metered routes are not categorically excluded. The existing personal worker configuration was migrated into explicit configured-choice routes without invented measurements. Verified local generations have been selected without restarting live sessions; benchmark evidence and native compaction acceptance remain limited as recorded below.

The 19-hour example and inventory below are historical synthetic/offline observations. They do not describe current user balances. See the implementation checkpoints below for verified source behavior and remaining host acceptance.

## Findings in this checkout

The offline inventory found **70 configured provider/model pairs, 76 catalog rows
including variants**, and 10 usage source records. These counts are configuration,
not a count of subscriptions or proven entitlements. The read-only
`runtime:accounts status` command found Claude and Codex OAuth providers;
both named Grok slots (Gmail and X/Yahoo) were not connected. This does not
establish plan levels, model entitlements, or current allowances.

The inspected cache was collected at 2026-09-05T00:12:57.267Z and was stale.
Claude windows had unknown provenance and no observed percentage. The cache
therefore cannot establish the user's current 19-hour weekly reset. Some unknown
sources contain placeholder reset intervals; the inventory command deliberately
prints no reset timestamp unless its provenance is provider-observed.

- `models/model-router.ts:pickAvailableModel` scores capability booleans,
  output-token list prices, capacity states, and hard-coded Sol/Luna bonuses.
  It excludes harness entries and automatic Astra selection. It does not read
  benchmark results, task latency, or measured task cost.
- Live Quest admission uses `models/dispatch-planner.ts` and account-scoped route
  evidence. The obsolete favorite/profile scorer and provider lane-block registry
  have been removed; they do not select models or supply worker status.
- `usage/usage-lib.ts:capacitySnapshot` reduces healthy sources to state/auth.
  It retains resetAt only for capped windows. `telemetryFromCapacity` maps by
  providerID, so broker routes do not automatically inherit the correct
  Claude/Codex account's allowance. A broker provider can contain multiple
  accounts and vendors: mapping the whole provider to one subscription is wrong.
- `models/benchmarks.md` has useful research notes, including effort and harness
  distinctions, but they are not executable routing evidence. No benchmark
  numbers from those notes were copied into automatic scoring in this change.
- `docs/provider-harness-audit.md` distinguishes working broker transports,
  native OpenCode workers, and blocked legacy CLI bridges. CLIProxyAPI is a
  transport; it does not itself provide Codex's or Claude Code's agent loop.
- Native Quest dispatch needs model/agent/description decided at
  prepare-dispatch, before the host persists the worker chip. Rewriting a model
  afterward is not sufficient to guarantee the selected harness or reasoning.

## Run locally

```powershell
bun scripts/route-plan.ts inventory
bun scripts/route-plan.ts evaluate test/fixtures/routing-19h.json
bun test ./test/route-planner.test.ts
```

Inventory reads only the local configuration and existing usage cache. It does
not load credentials, list browser sessions, refresh providers, or send prompts.

Evaluate accepts a JSON `PlannerInput` as defined in
[`models/route-planner.ts`](../models/route-planner.ts). Use the fixture as a schema
example, replacing all synthetic accounts and outcomes. Its `request.now` is an
explicit replay clock; a live caller must supply the actual current timestamp.
Exit 2 means no eligible route; exit 1 means invalid invocation/input.

The result has a compact `summary`, ranked alternatives, and per-route exclusion
reasons. Keep only the selected identity and summary in the model context.
Store full inputs and explanations locally for inspection and replay.

## Decision contract implemented

A route has a stable account ID, exact provider/model, harness version, reasoning
level, and service tier. Each route carries its own task-specific measured
outcomes. The same model through another harness or reasoning setting is a
different route and needs its own evidence. Names such as "fast" do not create
measured speed or quality.

1. Restrict an explicitly requested route; never silently substitute.
2. Require verified route, authenticated account, user-allowed route and known
   billing, fresh capacity, and sufficient unreserved allowance in **every**
   shared account window. Missing consumption, elapsed resets, and unknown
   windows block the route. A reset timestamp is not proof of restored quota.
3. Require enough recent task outcomes to meet the requested success floor and
   latency/cash limits. Use the newest record for a task, including regressions.
4. Keep routes within a configurable quality tolerance of the best eligible
   route. That tolerance is a policy parameter, not a claim about a model.
5. Rank by the configured preference (capacity by default), marginal cash and time
   per successful task, then quality and stable route ID.

Time and cash totals include unsuccessful attempts. Subscription fees are sunk
fixed costs for the current billing period; API list prices are not the user's
marginal task cost. Quota consumption is separate, measured in the same units
as each window's remaining allowance.

The planner trusts supplied normalized observations and evidence; it does not
authenticate them, run benchmarks, reserve capacity, or validate a harness by
launching it. Those responsibilities must be satisfied by the integration.
Observed success rates are sample estimates, not statistical guarantees.

## The 19-hour case

The fixture provides a Claude session resetting in two hours and a weekly pool
resetting in nineteen hours, plus a qualified Codex route and a qualified free
route. All have zero marginal cash cost. Claude wins because usable subscription
capacity is expiring sooner.

For each window the planner converts allowance to task slots, subtracting
reserve and in-flight reservations. It estimates the slots still available in
future short windows before the longer reset, when period and next capacity are
actually known. If skipping the current session could strand weekly capacity,
urgency rises. It bounds useful current work by the tightest shared window and
execution time before expiry.

This is a deterministic scheduling heuristic. Future-window estimates assume the
reported period repeats and useful work is available. They are not a guarantee
that a weekly pool can be drained. Unknown future capacity is left unknown.

It does not launch filler work to burn allowance. It selects among supplied,
authorized tasks. It also refuses a spent week even if a session has room, and
refuses a low-quality route even if it is free or about to reset.

## Original production integration plan (read with implementation checkpoints)

**Account registry.** Record stable account IDs, plan names, billing type,
allowed routes, and shared quota pools. Provider IDs are not account IDs.
Different transports using the same subscription must share reservations.
Different accounts behind the same broker must remain distinct.

**Usage adapter.** Reuse a process-shared cache and in-flight refresh promise.
Read the cache on decisions, refresh in the background with per-source TTL and
backoff, and ingest response headers/CLI events when supported. Reset boundaries
and observed quota errors should invalidate the relevant account. Do not ask
every model to poll every provider. Provider-reported timestamps are absolute;
recompute countdowns locally. Allow explicitly marked, expiring user reports
when the provider exposes no usable telemetry, without relabeling them official.

**Evidence ledger.** Record task class, dataset version, model snapshot, harness
version, reasoning, service tier, pass/fail, retries, total elapsed time, cash,
and observed quota deltas. Use public benchmarks to choose what to test; keep
benchmark version, metric, harness, effort, date, and source attached. Do not
average incomparable leaderboards or infer a missing reasoning level.
Evaluate representative repository tasks with deterministic tests and blinded
review where needed. Separate holdout tasks from tuning tasks. Re-test after
model/harness changes. This change launches no paid benchmark matrix.

**New models.** Add an explicit, expiring user-approved exploration policy with a
small budget for a trusted new release such as Astra. Keep provisional approval
distinct from benchmarked quality. The strict offline planner currently excludes
unevidenced routes; it does not fabricate a score for them.

**Dispatch.** Feed the decision into runtime-owned Quest run, resolve the exact
worker/harness/variant, reserve quota atomically, then reconcile real outcomes.
A failed or unavailable named route must be reported, not replaced silently.
Account-aware reservation and observed identity checks are required before
this planner should control concurrent live workers.

**Presentation.** Use a compact selected-route reason in context. A local view
can show account, reset countdown, remaining allowance, reserve, evidence age,
success estimate, time/cash per success, and rejected alternatives. Missing data
must stay visibly missing. No extra recurring prompt containing the whole
catalog or benchmark tables is necessary.

## Research checked this session

Official [Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra)
lists API reasoning levels low, medium, high, xhigh, and max.
The [model guide](https://developers.openai.com/api/docs/guides/latest-model)
describes model-specific configuration. The pages inspected did not establish
a universal "medium loses 1% quality and saves 25% cost" rule. API settings and
prices also do not prove an account's subscription allowance or a CLI harness's
effective settings. Keep that ratio as a hypothesis for paired local evaluation.

## Tracking

No Quest tool is exposed to this Codex session. The canonical ledger was read
through its repository API: the related routing Quests had completed steps and
there were no active file claims. No new Quest was created, no completed Quest
was repurposed, and no test result was represented as recorded on the Quest board.
Implementation and verification evidence are in the focused local commit and
the test output reported in this session.


## Verification observed

- Full `bun test`: 559 passed, 1 skipped, 0 failed (560 tests, 74 files).
- Static `pwsh -NoProfile -File .\smoke-test.ps1`: healthy; 103 passed, 0 failed.
- Standalone TypeScript check of `models/route-planner.ts`: exit 0.
- Offline inventory and synthetic evaluation commands: exit 0.
- No live routing acceptance or real-model benchmark was run.


## Redesign implementation checkpoint — 2026-09-05

The planner no longer categorically excludes metered billing or ranks cash
first unconditionally. Its request supports explicit allowed route IDs, a
capacity/latency/cash preference, and absolute account-window reserves. Exact
route requests remain exact. Offline supplied routes are input data; live
reservation calls require a nonempty user allowlist.

RouteReservations provides atomic shared-account reservations, durable retry
identity, and unknown-outcome retention. A settled request holds its allowance
until an explicitly reconciled observation accounts for it; a newer poll alone
is insufficient because provider counters may lag. This foundation is not yet
connected to all production dispatch paths. Existing branded selectors and
subscription transport guards still require replacement.

Focused planner/reservation/package verification: 25 tests passed. No provider
request, live routing acceptance, or real-model benchmark was performed.

### Live override removal and transport policy migration

The models host plugin no longer rewrites a capped or unspecified worker to a hardcoded fallback. Native direct spawns require an exact configured identity; Quest run performs policy-based scheduling and reservation. The separate pick_model heuristic tool is no longer registered by the harness plugin. Historical pure ranking/fallback helpers remain for compatibility tests and require further cleanup where used by presentation; they are not the live spawn scheduler.

Transport access is now fail-closed data in models/access-policy.json (override OPENCODE_ACCESS_POLICY). The migration preserves the former allowed provider/model patterns, exact request origins/path prefixes and OAuth broker verification. Missing or invalid policy denies requests. An additional paid route can be explicitly authorized by adding its model and transport; billing class is not hardcoded into the generic guard. OAuth credentials and broker configuration were not changed. Fixtures compare allowed/denied requests against the old guard and test explicit paid-route policy without network requests.

Automatic approval review rejected an earlier permissive-default proposal because missing policy would broaden model/origin access. That command made no edits. The revised, approved implementation preserves existing access boundaries and fails closed. No outstanding approval is needed for this implementation.

Personal access policy is loaded from OPENCODE_ACCESS_POLICY or the configured personal config directory, not from a public plugin package. It is intentionally excluded from distributable assets. Missing policy still denies access, while local immutable code generations share the user's explicit policy. The package closure test caught and corrected the initial attempt to include personal policy as an asset.

### Concurrent cash and calibrated dispatch (2026-09-05)

An optional request.cashBudget declares ID, currency, limit, externally spent amount and authorized start/end times. Each participating route supplies cashReservation.currency/upperBound. The durable reservation lock subtracts active, unknown and settled in-window holds before selection. Cancellation releases a hold; settlement replaces it only when complete actual-charge observations exist. Unknown charges retain the reservation. These are admission bounds supplied by user policy, not a claim that a provider enforces a hard billing cap. No budget or route values were invented for the live account.

Optional calibration.maxAgeMilliseconds and tokensByRoute feed configured task-token forecasts through the same validated calibration layer as usage_status. A matching account/window/route/regime fit can raise the allowance reservation to its held-out upper bound; it cannot lower existing configured task consumption. Stale, drifted or mismatched fits add no forecast. Route keys are canonical across property order, with historical object-shaped keys still readable. Thirty focused reservation/calibration/lifecycle/package checks passed.

### Explicit admission fallback (2026-09-05)

The existing request policy accepts primaryRouteID and optional fallback: {when: "admission-unavailable", routeIDs: [...]}. The primary and every alternative must be in allowedRouteIDs. A healthy primary stays selected; an unavailable primary fails visibly without fallback policy. With policy, one admission decision evaluates only those alternatives against the unchanged quality, account, cash and reserve constraints, inside the existing reservation lock. An explicit per-run model bypasses this fallback and remains exact. Provider failures after dispatch do not start another model call. The substitution and original rejection reason persist in the reservation and Quest agent log after completion.

Forty-seven focused planner/reservation/API/boundary tests passed, including fixed paid/subscription/free policy, inventory changes, forbidden substitution, exact model preservation and atomic retry identity. Real terminal rendering of synthetic grouped failure/recovery and substitution records passed in .visual-e2e/redesign-terminal-recovery/manifest.json; the screenshot was inspected. This is presentation acceptance, not a live provider failover benchmark.

### Live candidate derivation (2026-09-10)

`dispatch-policy.json` no longer decides which models exist. At dispatch time `models/live-routes.ts` joins the live models.dev catalog, `models/access-policy.json`, the connected accounts in the usage snapshot, the policy's billing map and the `benchmark-routing` block in `models/benchmarks.md`; every one of those is a veto, so a wider catalog never widens what the user authorized. The file still contributes curated routes (a broker like `cliproxyapi` is not a models.dev provider and can only be curated), billing and thresholds, and a curated route keeps its identity over a derived twin. A route derived this way carries `admission: "benchmark-ranked"` and a `benchmark` prior; `request.minBenchmarkPassAt1` is its quality floor, and a route the user names explicitly is exempt from that floor because naming it is the authorization.

`fallback.routeIDs` is no longer written by hand: the alternatives are every allowed route except the primary, and they are ranked as a pool rather than attempted in list order. Priors never mix with measurement — any candidate carrying local `RouteEvidence` for the task wins the field outright and the benchmark-only candidates are excluded with that reason, so a published pass@1 is only ever compared against another published pass@1. Ties go to an independent measurement over a vendor's own number, then to the AA Intelligence Index. Preflight health still excludes a probed-unusable route, and now matches on provider/model as well as route id so one probe speaks for every candidate that would place the same call.

Observed on 2026-09-10 with the ChatGPT account's weekly window exhausted, the Claude account reporting HTTP 429, and `opencode-go` at 99% rolling: automatic selection fell back from `proxy-sol-xhigh` to `opencode-go/deepseek-v4.1-flash#max`, a model released that day and absent from `allowedRouteIDs`. Marking that model unusable in `route-health.json` moved the selection to `opencode-go/glm-5.3#max` (69.0%, independent), and naming the unusable model explicitly failed closed with no substitute.

### Existing logged-in setup connected (2026-09-05)

The user clarified that existing OpenCode2 logins and settings are the authority; a missing new policy file is not a reason to ask them to restate their setup. Live shared-account refresh succeeded for Claude Max, ChatGPT Pro and OpenCode Go. No inference or benchmark request was sent.

The personal dispatch policy is now populated from configured native workers and their connected account identities. Its default is proxy-sol/xhigh, matching the existing personal coding default in models/routing-table.md. Sol and Fable variants are preserved; Opus, Luna and Terra retain unknown reasoning where their actual provider settings do not specify it. Exact run variants remain exact. This personal data is not a generic model preference. No automatic fallback, paid route or new spending budget was added; reserveFraction remains zero until a reserve is configured. Bootstrap for this checkout uses its existing Bun lockfile. Other projects still own their bootstrap instructions.

Configured-choice admission lets an explicitly selected/default worker run without fabricated benchmark trials or quota-per-task values. Such choices do not compete in empirical ranking; recorded regressions, current account state, freshness, resets, configured reserves and cash limits still gate admission. Unknown-consumption work is serialized per account in the existing atomic ledger, including unknown outcomes. After terminal completion, a newer quota observation releases its concurrency hold. This is not calibrated attribution: delayed quota updates can still hide consumption, and admission thresholds cannot guarantee the remaining balance after an unmeasured task. Measured reservations retain their stronger accounting rules.

Live-account admission passed for the default, bare Sol, exact Sol max and exact Fable high, using a private reservation ledger; each test reservation was cancelled without launching a worker. Receipt: .visual-e2e/configured-admission-1788596178455/report.json. The real-worker harness now exercises the actual planner and ledger. Two host attempts failed (first incomplete fixture account metadata, then a real Git ignored-parent snapshot defect); host retries stopped under the repository rule. The Git defect was reproduced and fixed with a private-index glob exclusion. Thirteen focused runtime, admission and real-Git tests passed, including ignored .claude parents, preserving dirty files and the user index. This latest integrated host acceptance remains unverified; earlier successful native-worker captures used a stub admission seam.

Final deterministic verification for this slice: 678 passed, 1 skipped, 0 failed (95 files; run/redesign-tests-11.log). No model quota was consumed. The integrated host capture remains stopped after two failures; the identified Git defect is covered by a passing real-Git regression test.

### Measured outcomes connected to dispatch (2026-09-05)

Benchmark evaluation now lives in usage/benchmark-evaluation.ts; the old bench entry point forwards to the same calculation. The maintenance CLI and live dispatcher use it. A request is not considered complete merely because it has an end timestamp: running/invalid timing, requests outside the recorded trial interval and missing actual token categories remain visible measurement issues.

Optional dispatch-policy outcomesFile points to a recorded dataset (absolute path or relative to the policy file) containing trials, requests, task, currency and source. Trials retain the existing id/taskID/routeID/timing/sessionIDs/accepted/verification/phases schema. The dispatcher validates the exact account, provider/model, harness, reasoning and service tier for every included primary and worker request before appending measured RouteEvidence. Accepted and rejected trials both contribute time, cash and latency; unjudged or incomplete task data cannot silently inherit older favorable evidence for that task class. The CLI emits the same evidence when its input also includes routes. No benchmark is launched and no policy route, fallback or reserve is created by this calculation.

Actual charge availability is independent of token/timing coverage. Missing charges produce totalCash:null and visible diagnostics, never zero or API-equivalent charges. Capacity/latency decisions can use measured quality with unknown cash only when no cash-per-success constraint was configured. Cash ranking and explicit cash limits still require comparable known charges. Evidence preserves currency; unknown quota consumption has unavailable expiry pressure. The migration-created personal policy no longer imposes an invented zero cash-per-success limit; its route allowlist, account choices, cash reservations and fallback policy were preserved. No live dataset or measured savings was fabricated.

Focused replay, planner, reservation, configured-choice and package tests passed; the real dispatch entry point was tested reading a dataset before atomic reservation. Native host compaction admission remains unavailable in the installed plugin context and the stopped worker capture was not retried.

### Model-specific windows in dispatch (2026-09-05)

Live admission now uses the shared account API’s canonical model-window selector. Every route consumes the account’s shared windows and matching model windows; unrelated model windows do not gate that route. The planner and reservation writer use the same applicability mapping, preserving one account identity and shared concurrency holds. Exhausted, unknown or elapsed-reset model windows reject admission. Only applicable measured consumption and reset identities are reserved. Future-window capacity is no longer assumed to be 100; expiry forecasts omit replenishment that the provider has not reported. Deterministic tests exercise the real dispatch entry point and concurrent ledger without model inference.
