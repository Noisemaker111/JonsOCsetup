# Model selection and task measurements

Users can select and change models for chats, workers, and permission reviewers. An explicit route retains its provider, model, account, and reasoning choice. Automatic selection uses the configured user policy; it does not prescribe a model name or a universal fallback.

## Economical automatic selection

`models/dispatch-policy.json` owns automatic selection; exact user model choices still
win. `request.preference: "economy"` admits routes against the task's own quality
requirements, then compares the same `economy.comparisonTokens` workload across
eligible routes. Routine helpers use a quality floor; coding and planning retain
their configured tolerance from the best eligible score. Local outcomes and
published priors remain separate evidence scales. A prior-qualified route is not
excluded just because another route has local history.

`economy.accountPrices` accepts exact account/provider/model/service-tier prices,
keyed by `accountPriceKey` in `models/route-economics.ts`. Personal prices override
catalog quotes. `useCatalogPrices` explicitly permits exact-provider catalog prices
as API-equivalent estimates, never actual subscription charges. No broker price is
inferred by matching a model name. Missing or expired prices remain unknown.
The common workload is a comparison assumption, not a prediction of task tokens.

Within `request.economyPriceTolerance` of the cheapest qualified quote, measured
request speed orders candidates. Observations require exact account, wire reasoning
and service tier; request duration is not completed-task latency. Fresh quota,
reserves and account admission remain mandatory. Measured task consumption controls
expiry pressure when available; percentages are never converted from catalog prices.

`/quest-reviewer` selects economical, measured cash, speed, quota, or an exact model.
The helper remains pinned for its giver session until the user changes that setting.
`bun scripts/route-plan.ts dispatch --task utility` displays the same automatic
selection used by the reviewer and Quest workers, with price and quality provenance.
The installed verification gate also uses that planner rather than list order.

## Task and model measurements

Every observed request retains its token components, saved price schedule, timing,
account and exact model settings. `usage_status` reports all observed models over
its selected time range (28 days by default), including models whose account
identity is unavailable. No model names are enumerated in the measurement path.

Quest runs automatically receive their dispatch task class. `quest_outcome report`
and `bun scripts/workflow-report.ts --out <private-report.html>` join each run to
its own observed requests and show token totals, mean tokens and cost per task,
whole task duration, output tokens/second including reasoning, visible streaming
speed and sample coverage. Per-task details remain available after reopening the
HTML or JSON export. Pass/fail execution and evaluator acceptance are separate;
cost per accepted task remains unknown while any settled task is unjudged.

Estimates use the price recorded on each request; missing price/token capture does
not become zero. Actual charges require an actual-charge observation. Reports
include failed attempts, deduplicate repeated observations by request identity,
and retain unknown counters. Other harnesses require their own measured counters;
OpenCode request throughput is not a claim about unobserved external runs.

## Admission and evidence

`models/dispatch-planner.ts` joins configured and live routes with account observations, access rules, task demand, price evidence, and measured outcomes. `models/benchmarks.md` contains the machine-readable published priors read by `models/benchmark-table.ts`; these are dated research evidence, not local task success or a bill.

Fresh quota and an unambiguous account route are required. An unknown window, missing price, or missing outcome remains unknown. A provider reset time does not prove restored capacity. Reservations retain uncertain launches until their owning runtime can reconcile them. User-authorized subscription concurrency is policy, not a model-name exception.

Task totals include captured worker requests and permission reviews linked to that run. Unallocated giver, integration, and historical overhead is outside that measured total. Incomplete review coverage prevents claiming a complete task cost. Reports distinguish whole-task elapsed time, request throughput including reasoning, and visible streaming speed; none is interchangeable with another.

OpenCode2 is the current Quest execution target. Observations imported from other harnesses retain their own provenance and coverage; they do not establish complete external task attribution or automatic diff ownership.

## Inspect the current decision

From this repository:

```powershell
bun scripts/route-plan.ts dispatch --task utility
bun scripts/workflow-report.ts --out <private-report.html> --days 28
```

The first command reads current planner inputs without reserving or launching a worker. The second exports persisted task observations. Inside OpenCode, use the registered route, usage, and Quest tools instead of repository-relative shell commands.

See [accounts and usage](account-usage-api.md), [Quest outcomes](adaptive-quest-work.md), and [historical model notes](history/README.md).
