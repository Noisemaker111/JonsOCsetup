# Adaptive parallel work and learned model suitability

Research snapshot: 2026-09-07 Eastern. This is an implementation brief, not a claim that adaptive splitting, session steering or model learning is deployed. The existing portfolio pacing PR is a separate change: https://github.com/Noisemaker111/opencode-config/pull/9.

## Findings in the current setup

- `quest/continuation.ts` waits while any run in the Quest is active, then selects the first dependency-ready step. Account concurrency does not remove this per-Quest serialization. Parallel work requires explicit independent assignments and integration ownership, not simply a larger ceiling.
- `usage/benchmark-evaluation.ts` already joins parent/child request measurements, includes failures and review/handoff/retry phases, and requires verification artifacts for accepted trials. Preserve this accounting.
- `models/measured-outcomes.ts` binds outcomes to the exact account, model, reasoning, harness and service route. `models/route-planner.ts` currently has only coding/review/planning/utility task classes. These are too broad to establish specialties such as race-condition debugging or game interaction design.
- The production-base `models/dispatch-policy.json` has nine routes, zero evidence entries and no outcomesFile. Its route list covers OpenAI and Claude, not Go, Cursor or Grok. Access-policy entries and curated model descriptions are separate from verified dispatch capability. These are source observations, not a global inventory of every running generation.
- Reference host source defines prompt delivery `steer` and `queue`. `packages/core/src/session/inbox.ts` describes steering at a step boundary and queued input at an idle boundary. Reference `packages/plugin/src/promise/session.ts` exposes prompt/synthetic/interrupt through SessionDomain. However, the locally installed `@opencode-ai/plugin` 1.18.23 declaration in `dist/v2/promise/context.d.ts` has a different surface and no session domain. Do not invent that API or infer installed support from upstream. An isolated installed-host adapter test is required.
- Existing project-router work owns project discovery and destination-bound session creation. Extend that work; do not create another global scheduler or a generic workflow tool.

## What a useful nudge does

A nudge changes a work decision. It cannot increase the provider's token generation rate by instruction alone.

| Observed state | Useful response | Evidence of success |
| --- | --- | --- |
| Worker is implementing; independent investigation is ready | Offer a bounded helper assignment with a separate workspace | Owner accepts the handoff; helper returns checked evidence that advances the task |
| Several independent dependency-ready changes exist | Admit a small worker cohort and reserve an integrator | Combined revision passes the relevant checks; integration time is counted |
| Worker is waiting on a test or build | Use deterministic process completion events; admit other ready work | Less idle delivery time without repeated model polling |
| Worker repeats unsuccessful approaches | At a checkpoint, provide specific new evidence or request an alternate bounded investigation | New evidence resolves the blocker; repeated output alone does not count |
| Queue is empty | Scout another authorized project's concrete issue or roadmap opportunity | Reproducible candidate with acceptance criteria and deduplication against existing work |
| Review or integration is accumulating | Spend the next slot on verification/integration | Ready work reaches a reviewed PR instead of growing the backlog |
| Quota, ownership or launch state is unknown | Hold that admission and reconcile | Confirmed state, never duplicate uncertain work |

Default to queued guidance. Use steering only for relevant changes to active work and only after proving host delivery semantics. Coalesce nudges, use stable admission IDs, scope them to the owned session, and distinguish offered, delivered, acknowledged and completed. A transport acknowledgement is not evidence that a worker acted. Silence does not release ownership. Do not interrupt a provider call merely to increase burn; it can waste context and discard progress.

For five workers, split along independent outcomes, not arbitrary chunks of the same edit. One owner establishes shared contracts; independent implementation or investigation proceeds; one owner integrates and checks the combined result. That integrator's time and tokens belong to the workflow. Useful examples include investigating separate JGengine subsystems, implementing unrelated repository fixes, or reproducing a bug while another worker inspects its likely cause. Review of an implementation waits for a stable revision even if review preparation can overlap.

## Learn specialties from actual work

Keep a compact capability card outside the giver prompt for each exact model + reasoning + harness/version + tools/configuration. Account-specific throughput and allowance remain separate dimensions. Proposed task tags: repository discovery, root-cause debugging, bounded implementation, cross-module design, tests/verification, visual interaction, performance investigation, documentation, and integration/review. Record language/framework, context-size band, task difficulty and acceptance contract so easy tasks do not make a route look universally better.

Measure independently verified acceptance, first-pass acceptance, rework, missed defects, unsupported findings, wall time to ready PR, review/integration time, token categories, allowance attribution coverage, and actual charges where observed. A passed command alone does not establish semantic correctness. An unjudged result is neither success nor failure. Keep failed attempts in the denominator; keep censored running work visible. Public benchmarks and vendor descriptions nominate experiments, not production-quality evidence.

Start with useful bounded assignments on explicitly permitted routes. Compare matched task categories and occasionally use the same fixed task in isolated evaluation checkouts, without publishing duplicate PRs. Separate author and evaluator where feasible. Log assignment decisions and conditions to expose selection bias. Use confidence intervals and sample counts; five successes do not demonstrate a 90% reliable specialist. Retain evidence across weeks and reset cycles, version it by model/harness/plan regime, and report drift before pooling old observations into current routing.

Candidate experiments, not rankings:

| Candidate | First workflow roles to evaluate | What would justify continued use |
| --- | --- | --- |
| Grok 4.6 through Cursor | Long-running implementation, visual first passes, alternate debugging hypothesis | Accepted outcomes or elapsed-time improvement after verification and handoff |
| Grok subscription route | Bounded repository investigation and independent review | Additional verified findings per review minute; reliable tools and confirmed subscription attribution |
| Available Go models | Reproducible CI fixes, documentation checks, test implementation, bounded coding | Comparable acceptance with useful throughput and less consumption of another scarce pool |
| Existing Astra/Sol/Claude routes | Integration, difficult diagnosis, architecture; also comparison baselines | Measured performance on those roles, not automatic assignment by brand |

Do not permanently confine a model to low-value work based on its price. Permit controlled experiments on harder tasks when evidence supports them. Likewise, a second reviewer only helps when its incremental true findings exceed verification overhead; model diversity does not guarantee independent errors.

## Pacing over several horizons

Use fresh request/activity/allowance observations to control admissions now. Learn workload consumption and completion distributions over comparable sessions and reset cycles, retaining longer-term history. Show short-term observed pace alongside 7-day/28-day task-conditioned summaries when enough data exists; these horizons are proposed reporting windows, not claimed validated predictors. Do not smooth across changed quota regimes or hide recent outages behind a daily average.

Required allowance pace is remaining expendable allowance divided by time to the chosen deadline. It is demand, not a worker count. Use observed marginal throughput from concurrency changes to estimate the next cohort; account for provider queuing, local CPU/test contention, useful work supply and integrator capacity. Apply bounded changes and dwell time, record every intervention and its outcome, and reduce admissions when added workers stop improving accepted throughput. Never add separate account percentages or assume extra accounts independently increase throughput.

Illustration only: five independent 20-minute tasks take 100 minutes serially. Five ideal concurrent workers plus 10 minutes of integration take 30 minutes, a 3.33x wall-time speedup. They still perform 100 worker-minutes plus integration; that is not automatically five times the tokens. Shared setup, repeated context, retries, rate limits and conflicts change both figures. Measure the full dependency graph and combined result.

## Graphs that answer decisions

1. Per-account allowance: observed remaining, target trajectory, forecast interval, reset and controller actions. Mark provider-report lag and uncovered requests.
2. Workflow timeline: worker activity, dependency waits, tests, handoffs, review and integration; show the critical path and distinguish confirmed activity from queued work.
3. Model-by-task capability matrix: verified acceptance and uncertainty, sample count, first-pass rate, defect yield, time to accepted result and evidence age. Unknown cells stay unknown.
4. Concurrency experiment: concurrency against accepted results/hour, completion latency, integration backlog and allowance/minute under comparable task conditions.

The giver sees only a recommendation, its evidence/confidence, ready-work count and current limiting factor. Detailed history and charts stay in usage/evaluation views. Do not copy the model catalog or portfolio into every prompt.

## Provider facts checked for this brief

Cursor documents Grok 4.6 as aimed at harder, longer-running work, with low/medium/high/xhigh effort; it is available through CLI and other Cursor surfaces and consumes the Cursor Models pool. These are vendor capability claims and product facts, not a local comparative trial: https://prod.cursor.com/help/models-and-usage/grok-4-6.

Grok's FAQ describes a shared weekly subscription allowance and a Usage view with product breakdown and reset time. Therefore an unverified claim of unlimited Grok should not become infinite scheduler capacity: https://docs.x.ai/grok/faq#usage--limits. The actual account's entitlement remains to be checked through its supported route.

OpenCode Go documents usage limits and optional fallback to a Zen balance. A Go subscription is not permission to enable paid fallback: https://opencode.ai/docs/go/. Inspect the account's actual configuration before admission.

## Small implementation sequence

1. Extend existing outcome capture with task tags and workflow/cohort identity; attach verification judgments and integration overhead automatically where observable. Keep raw evidence and missing data visible.
2. Verify account/model identity, supported tools, quota capture and an actual bounded outcome for each candidate host route. Grok, Go and Cursor being present in a catalog is insufficient. Do not change the current routing allowlist as part of research.
3. Add dependency-aware independent admissions to the existing continuation/runtime with isolated workspaces and one integration owner. Preserve unknown-launch reconciliation and existing router ownership.
4. Verify queue/steer delivery through an isolated installed host, including busy tools, duplicate retries, cancellation, restart and acknowledgement. Expose a concrete session guidance operation only after that boundary works.
5. Connect measured portfolio demand to eligible cohorts and integrator capacity; evaluate sequential versus parallel delivery and model-task outcomes before promoting an automatic policy.

Acceptance is an actual useful multi-worker result, persisted and reloadable measurements, a verified combined revision and a ready PR. Research completion does not mark these implementation steps complete. PR #9 remains pending its separate merge/activation approval; this brief changes no running session or provider configuration.
