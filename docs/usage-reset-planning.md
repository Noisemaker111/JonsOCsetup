# Usage pacing and reset planning

Use `usage_status` for detailed accounting and `usage_pacing` for the compact controller view. Accounts and quota pools keep their own scope, observation time, reset, and freshness. Never combine percentages from different windows or treat an elapsed reset as proof of restored capacity.

## Measures and targets

`requiredPointsPerMinute` is the configured spendable allowance divided by time until the target. `observedPointsPerMinute` is measured provider movement over a compatible interval. It includes other applications using the account. A flat rounded meter means no observed movement, not free requests. These rates do not establish a daily schedule or guarantee exhaustion at the deadline.

`usage_target` saves a target for a selected account/window. A one-off `deadlineAt` expires without extending itself. Recurring behavior requires explicit `followResets: true`, `questPacing`, and a deadline matching the observed reset. Renewal requires a fresh post-reset observation in the same account/plan/pool. Stale, disconnected, missing, or changed-plan observations do not renew it.

`reservePoints` is a user policy input. The controller's desired slots are not running workers or dispatch authorization. Work still needs a concrete Quest, eligible route, fresh quota, and valid ownership. Clearing the usage target stops pacing; cancel the continuation as well when the intent is to stop future work. Already launched workers keep their recorded ownership.

## Tokens, cost, and speed

Request summaries retain input, cache reads, cache writes, visible output, and reasoning separately. Combined output includes reasoning once. The context size is not newly consumed tokens. In-flight token counters can be unavailable until a provider returns them.

Measured request rates and token means have a stated interval and sample coverage. Whole-task duration and cost per accepted task require recorded task outcomes; they cannot be inferred from requests per second. Use [task reports](account-aware-routing.md) for these comparisons.

Published price or credit schedules are dated estimates. An unknown route, service tier, or rate stays unknown. API-equivalent value is not a subscription charge or a denominator for quota percentage. Workload comparisons must use the observed route and relevant token mix, not a named-model default from an old example.

## Allowance estimates and reconciliation

Quota estimates require a fresh, identifiable calibration for the exact account, plan, route, and window. Missing, expired, drifting, or ambiguous evidence stays unknown. Overlapping quota windows are not summed. An upper estimate is neither a guarantee nor an admission grant.

`accounting.sessionBurn` exposes account/plan/pool/reset scopes, observed session and route counters, pending requests, and recent wall-clock rates. Corroborating host records are not charged again. Unknown external activity, reporting lag, meter precision, and correlated token mixes can prevent attribution.

For a private offline report, run from this repository:

```powershell
bun scripts/session-burn-report.ts --out <private-report-directory>
```

`--ledger` and `--accounts` select diagnostic inputs. `--watch` enables collection and report refresh; it is not an offline read. Chronological reconciliation compares earlier-evidence predictions with later observed movement and shows coverage and residuals. It does not silently assign unexplained usage to the most recent session.

The `usage_experience` tool presents provider-meter observations, captured activity, and controller state together while retaining their separate provenance. It reads saved evidence; it does not dispatch work or refresh a target.

See the [account API](account-usage-api.md), [Quest outcomes](adaptive-quest-work.md), and [historical implementation record](history/usage-reset-implementation.md).
