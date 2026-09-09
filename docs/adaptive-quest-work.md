# Adaptive Quest work

This implementation builds on the portfolio pacing change. Existing one-worker continuations keep their behavior. New independent work can use the existing Quest operation:

```js
await tools.quest({ action: 'run', id: quest.id, run: {
  continue: true,
  maxConcurrent: 4,
  model: 'openai/gpt-6-astra#medium',
  taskTags: { diagnose: ['debugging'], implement: ['implementation'], integrate: ['integration'] }
}})
```

Choose dependency edges when creating the Quest: independent steps may overlap; an integration step should depend on every result it needs. `stepModels` optionally maps particular step IDs to exact configured routes. These options authorize a ceiling, not a promise to launch that many workers. Shared-checkout mode rejects parallel continuations. The persisted intent is checked again at admission even if a later request changes global workspace settings.

Account pacing and reservations still decide actual capacity. A held account does not discard successful sibling work. Unknown launches retain their identity and occupy capacity until reconciled. Canceling a continuation stops new admissions and preserves already launched work. Repeated identical requests return the persisted intent; a conflicting request under the same identity fails. Independent worker snapshots flow through the existing workspace inheritance path into the dependent integrator. A completed step alone cannot bypass a still-active dependency run.

## Finding useful work and steering it

`quest_work_supply({allProjects: true})` gives a bounded inventory of existing pending steps, their project, active/uncertain runs and dependency readiness. It does not invent opportunities or treat saved work as dispatch authorization. Another project's work still requires a verified giver bound to that project, using the existing project-router work. Automatic discovery of new repository issues and additional host/account adapters remain separate integrations.

`quest_guidance` sends relevant guidance to a specific owned run, defaults to `queue`, and supports explicit `steer`. Queue is consumed at idle; steer is consumed at a work-step boundary. These are instructions, not a provider token-speed control. Stable message identities prevent duplicated nudges across retries and reloads. An ambiguous host response stays unknown. A worker can acknowledge only its own guidance; submission, acknowledgement and completed work remain separate facts. No process interruption is used.

## Learning model roles

New Quest launches automatically register workflow/run/step metadata outside the Quest content. Passive capture joins only their direct native request records, preserving input, cache reads, cache writes, output and reasoning. Host corroboration and child sessions are not added a second time. Invalid timestamps and mixed routes produce diagnostics. Unknown counters and model/harness versions remain unknown. Model/effort/account/harness/service/plan-regime identities remain separate.

`quest_outcome({action: 'report', days: 28, exportHTML: true})` returns project-scoped observations and the path to a standalone graph report. Seven-day and 28-day windows summarize recorded cohorts; they are not claims about a complete historical backfill or future accuracy. The report includes model/task acceptance intervals and sample counts, token coverage, workflow timelines, peak observed overlap, elapsed time and summed worker time. Review and integration effort stay unknown unless supplied. A source-dependent counter can arrive after a quality judgment without changing that judgment.

Only an owning giver acting as evaluator can call `quest_outcome` with `action: 'judge'`, the Quest/run, `accepted`, `firstPass` (or null), and actual `verification` records (`command`, `exitCode`, `artifact`). Accepted work must have completed its assigned steps and have successful verification evidence. Worker completion never auto-accepts work; workers cannot judge their own results. Rejected, unjudged, mixed-route and incomplete-capture results remain visible. Recorded evidence is the evaluator's attestation, not an independent re-execution of the supplied command.

The capability matrix supports choosing experiments and exact allowed routes. It does not silently change routing policy, assign brand-based model roles, equate missing quota with unlimited service, or enable paid fallbacks. Actual model superiority and marginal speedup require judged comparable work; no synthetic fixture score is production evidence. Existing Grok, Go and Cursor catalog/access entries do not establish verified dispatch and accounting adapters.

Export outside a host with:

```powershell
bun scripts/workflow-report.ts --out run/workflow-evidence.html --days 28
```

The export embeds no external scripts or network dependencies. Its numbers come from persisted observations. An empty report means no observed workflow runs, not zero usage. This does not replace the account-wide token ledger or provider reconciliation reports.

## Verification boundaries

Run the repository suite and smoke gate. `scripts/verify-session-guidance.ts` exercises installed native stable queue/steer receipt, ordering, deduplication and acknowledgement on an anonymous local provider. `scripts/verify-parallel-worker-host.ts` exercises independent worker outputs, dependency inheritance and a combined result on isolated synthetic accounts. `scripts/verify-model-worker-host.ts --paced` separately verifies real host admission through the account pacing controller. All these fixtures use isolated state; they do not establish production account throughput or model quality.

Merge and activation are separate release steps. Existing processes keep their loaded generation; this change does not restart sessions or extend an expired target.
