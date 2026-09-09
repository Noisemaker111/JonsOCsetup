# Usage evidence experience — implementation and acceptance handoff

Date: 2026-09-09 UTC. Quest `57ec514763d0e1ecec35c8bc29`, assigned step
`usage-experience`. Implementation is saved in the prepared shared checkout;
parent integration, full gates and visual/model acceptance remain pending.

## Result and rationale

The experience answers three separate questions:

1. **What did the provider meter report?** Account/window-scoped percentage
   points, exact reset epoch and plan regime, source time, precision/delay or
   explicit unknowns. No account-wide change is attributed to this session.
2. **What requests were captured?** Separate capture sources, recorded account
   bindings, terminal versus running records, exclusive token categories,
   missing counters and a measured interval union. This is captured activity,
   not verified paid usage, future work or human active hours.
3. **What is the next safe action?** Current controller state and desired
   slots, explicit policy deadline/reserve/required elapsed pace, measured
   meter interval, unsupported allowance estimate, unknown launch ownership
   and a conservative action. `ready` plus zero means `wait-for-controller`;
   even positive desired slots never return a runnable grant.

This follows `docs/usage-pacing-audit.md`: a long observation gap, a quantized
flat meter and an elapsed-account slope cannot establish a recurring schedule.
There is no assumed three-hour day, schedule slider, fixed rate, decorative
bar comparison, token-to-percent conversion or exhaustion prediction.

### Owned implementation

- `usage/experience.ts`: shared pure `usageExperience(evidence, query)` and
  exported `UsageExperience`, `ExperienceEvidence`, `ExperienceQuery` types.
- `usage/experience-report.ts`: `renderUsageExperience(quota, activity)` returns
  reusable standalone HTML from real caller-supplied projections. No scripts,
  network resources, fixed datasets or runtime writes.
- `usage/server.ts`: concrete typed `usage_experience` tool and exported
  `getUsageExperience`. Reads the cached account snapshot, quota observations,
  passive ledger and native records, saved targets and saved controller.
  It never calls refresh, collection, target renewal, controller update or
  dispatch. Existing plugin setup still owns its existing passive services.
- `usage/burn-control.ts`: only the reproduced missing-history zero-slot
  recovery, described below.
- `test/usage-experience.test.ts`, `test/usage-burn-control.test.ts`: projection,
  renderer, read-only adapter and controller regression coverage.

No other source path was edited. `usage/reset-planner.ts` did not need a
change: this experience labels its existing numeric rates as points per minute
or points per hour, identifies the measured interval and policy target, and
does not display its linear forecast as a prediction. Parent owns tool grants,
registration integration, commits and runtime adoption.

## Data contract and boundaries

`ExperienceEvidence` takes a finite clock, account snapshots, `Observation[]`,
`LedgerRow[]`, saved targets/controllers and optional collector times/counter
gaps. The projection does not mutate its inputs. Harness provenance comes from
`row.route.harness`, never a top-level request field.

The query requires an exact cached `accountID`. `windowID` defaults to the
current portfolio focus/shared window. No connection or account is inferred
from an unbound request. `source` selects `opencode`, `codex` or
`opencode-host` (default `opencode`); sources may overlap and are not summed.
`sessionID` is an exact optional request filter and does not change the scope
of account-wide quota. `timeZone` is an explicit validated IANA timezone,
default `UTC`. All numeric timestamps are Unix milliseconds.

### Bounded inspection

- `view: "summary"` gives summary/coverage/decision plus paginated reset epochs.
- `view: "timeline"` gives chronological actual quota points for one exact
  reset/regime, with `breakBefore` on gaps, decreases, simultaneous conflicts
  and replenishment. It never interpolates observations.
- `view: "requests"` gives chronological request details, terminal/running
  status, source, recorded binding, route/harness and token counters.
- `offset` defaults to 0, `limit` to 40; limit must be 1–100. `nextOffset` is
  explicit or null. Summary epoch pages use the same offset/limit; detail views
  retain at most 12 epoch summaries. Request identifier/route strings are
  bounded. No prompts, credentials or file contents are returned.
- `from`/`to` narrow evidence by timestamps, not presumed work hours. Request
  intervals intersect the selection; terminal duration is clipped at its
  boundaries. Terminal token totals are whole captured request counters,
  not prorated charges for the clipped interval.
- `resetAt` and `regime`, copied from an epoch summary, select old quota
  evidence. The pure query also accepts null reset identity for unknown-reset
  histories; the exposed tool currently selects numeric historical resets.
  Current observed quota and the agent decision remain explicitly current,
  even when the timeline is historical.

Coverage counts are computed before paging and only for the selected account
and pool. Cache and passive copies of identical quota observations deduplicate
by content, not storage ID. Requests deduplicate within their source/ID;
a later running record cannot erase terminal evidence. Different capture
sources remain separate because cross-source identity is unproven.

The gap threshold is a disclosed **five-minute display heuristic**, not a
provider reporting guarantee. Counts, total gap duration, largest gap and up to
12 chronological gap details are exposed. Use `from`/`to` for further targeted
gap inspection. Exact reset changes, including small timestamp differences,
stay separate. Invalid records, conflicts/decreases, missing account bindings,
counter gaps and source diagnostics remain visible. A source's last record or
collector scan is not a heartbeat for every request, nor proof of continuous
capture. The files are read independently, not as a cross-source transaction.

### Synthetic and unbound telemetry

Parent reported 162 `bootstrap-fixture/model` and 15 `fixture/model` calls in
the global native store, generally unbound. The projection excludes unbound
records from account activity and exposes both source-specific excluded counts
and the broader all-source missing-binding count. These are different
denominators, not contradictory measurements.

Model names do not establish real/synthetic identity. A bound fixture-looking
record remains a **record**, not evidence of paid work: `estimateEligible` is
false and `routeReceiptAuthority` is unverified. No name filter, account
inference or historical-record rewrite was added. A meaningful test covers
unbound fixture and real-looking names alongside a bound fixture-looking call.

Expected activity is explicitly unsupported, including its evidence horizon,
observed day count and measured terminal duration. It lists what would be
needed before evaluating an estimate: representative work/non-work days with
verified collector continuity, account bindings and reconciled non-overlapping
captures, and chronological held-out validation with errors/gaps. Several days
alone are not a sufficient gate. Authoritative synthetic/route-receipt capture
and collection cleanup remain separate work.

## People-facing report

```ts
import { renderUsageExperience } from "./usage/experience-report"

// Parent supplies sanitized real UsageExperience projections from the same
// account and timezone: one timeline page and one request page. No sample data.
const html = renderUsageExperience(quotaProjection, requestProjection)
```

The two panels share an elapsed-time axis and readable date/hour/timezone
ticks, including timezone abbreviations to distinguish DST hours. Quota uses
0–100 used points; request output uses actual terminal tokens including
reasoning. Unknown and running counters are omitted from the token plot,
never drawn as zero. No line crosses an observation gap or reset; observations
are unconnected dots. Page counts and offsets disclose omitted history.
To compare a broad interval, fetch matching `from`/`to` selections and page
through the available evidence; this renderer does not silently downsample.

Focus or hover a dot for a value. Expand native `<details>` tables for all
returned values, statuses and source precision; the tables have captions and
row/column headers. Normal and narrow CSS layouts retain a horizontally
scrollable readable graph rather than squeezing axis text. Light/dark colors
are defined. All interpolated labels and identifiers are HTML-escaped;
no input is inserted into executable JavaScript or event-handler attributes.
Keyboard/data-table and hostile-string checks pass, but those do not substitute
for browser/screen-reader acceptance.

## Missing-history controller repair

Initial regression against unchanged controller source reproduced:
fresh funded account, valid scope, ready controller at zero, elapsed five-minute
dwell, no usable history → **zero**, when one bounded probe was expected.

Only the null-rate branch changed. After the existing clock, authorization,
scope, freshness, exhaustion, deadline and reserve checks, zero can request
one slot once the existing dwell expires. It records the adjustment time.
Subsequent missing-history evaluations remain capped at one. Before dwell,
zero stays zero with an explicit waiting reason. Stopped controls stay stopped.

This is feedback intent, not launch authority. The existing reservation test
now also denies a one-slot bounded probe when live/unknown reservations already
occupy capacity. Existing exclusive holds, configured ceiling, billing/access
and owner checks remain in ordinary admission. No controller or target state
was manually changed for this work.

## Commands and actual evidence

Capabilities were checked before implementation: authorized patch was exposed,
`Get-Location` succeeded in the assigned checkout, and actual
`usage_status({format:"json"})` recorded this
[worker](opencode://session/ses_f7c6c69eaffen8FjiG2Z4zb6ba) as provider `openai`,
model `gpt-6-astra`, reasoning/variant `medium`, harness `native` (not fast).
That existing status API refreshes account/controller evidence normally; the
new experience endpoint is read-only.

All Bun test runs used a unique `usage-experience-check-*` temporary directory
under the approved OpenCode temp root, passed as `TEMP`, `TMP`, `TMPDIR` to the
child runner. This isolates scratch-sweep preload behavior from shared workers.

| Check | Actual result |
| --- | --- |
| Initial `bun test ./test/usage-burn-control.test.ts` after adding regression, before fix | 3 pass, 1 fail, 27 assertions; expected recovered slot 1, received 0; exit 1 |
| Four-file projection/controller/planner/portfolio run | 22 pass, 0 fail, 2,435 assertions; exit 0 |
| Added provenance and read-only adapter run | 24 pass, 0 fail, 2,453 assertions; exit 0 |
| Final integration command below | **46 pass, 0 fail, 2,539 assertions**, Bun 1.3.14; exit 0 |
| In-memory `Bun.build` for server and renderer, `target:"bun", packages:"external", write:false` | Both success, one artifact each, no logs; exit 0 |
| `bun x --no-install tsc --noEmit --skipLibCheck --module preserve --moduleResolution bundler --target esnext --types bun usage/experience.ts usage/experience-report.ts usage/server.ts` | Could not run type validation: **TS2688 Cannot find type definition file for 'bun'**, exit 1. No dependency installation under partial ownership |

Final integration command (executed in the isolated-temp child described above):

```powershell
bun test ./test/usage-experience.test.ts ./test/usage-burn-control.test.ts ./test/usage-reset-planner.test.ts ./test/portfolio-pacing.test.ts ./test/account-usage-api.test.ts
```

Tests cover gaps/resets/deduplication/conflicts/decreases, missing bindings,
independent token units, overlapping duration, incomplete activity evidence,
stale/zero/unknown decision states, read-only cached adapter with forbidden
network and byte-identical fixture stores, strict JSON/no undefined or
nonfinite output, 21,000 cross-account rows bounded to correct pool counts,
paging/size limits, and HTML injection safety. Existing foreign-project server
tool tests also pass. Two guessed read paths (`usage/account-observations.ts`
and `test/usage-server.test.ts`) did not exist; their actual owners were located
and inspected. No missing-path command was counted as a passing check.

### Actual exposed-tool observation

The current catalog exposed `usage_experience`; a real call with the known
OpenAI account, `shared:primary`, summary and limit 3 succeeded at
`2026-09-09T00:39:36.030Z`. It returned:

- 27 used / 73 remaining points, observed 5,270 ms earlier; precision/delay
  unknown. Current reset `2026-09-15T01:24:10Z`.
- 2,838 unique **selected-pool** records across five epochs, 671 current-epoch
  records. Cache/passive duplicate copies were excluded. This is not the
  parent's 20,343 cross-pool count used as current-pool evidence.
- 1,123 terminal / four running bound native records; 974 terminal requests
  lacked input counters. Four observed days did not yield a schedule prediction.
- Missing bindings were split by source: 178 native, 5,004 Codex and 3,130 host.
  The broad all-source count was 8,312; these were not inferred into OpenAI.
- Controller `ready`, zero desired slots, `wait-for-controller`,
  `runnable:false`, live/unknown launches null.

These are one-time actual observations, not constants embedded in the code.
This tool call proves bounded model-facing behavior in this conversation;
it does not prove generation identity or isolated browser/worker admission.

## Parent acceptance and rollout

1. Review and integrate only the reserved source/doc/test paths. Add the
   concrete tool to the appropriate parent-owned grants/registration contracts.
   Preserve unrelated staged/dirty work. Parent owns focused commits under
   exclusive whole-checkout ownership; this partial-scope worker made none.
2. Run full `bun test` and `pwsh -NoProfile -File ./smoke-test.ps1`, plus a
   usable repository typecheck once Bun types are available. No full-gate pass
   is claimed here.
3. From an isolated actual host, discover `usage_experience` and call summary,
   timeline and request detail with real cached IDs; verify strict JSON,
   pagination/invalid arguments, no secrets and unchanged target/controller
   contents. Verify fresh/old/reset/unknown-account cases. Preserve ordinary
   permissions and exact `openai/gpt-6-astra#medium` route.
4. Supply sanitized **real** timeline/request projections to the renderer.
   Capture actual normal/narrow layouts in light and dark. Inspect readable
   timezone ticks, long gaps and historical epochs, focus/hover values,
   horizontal scroll, tables, no clipping and no synthetic data. Browser
   captures and screen-reader behavior remain unverified here.
5. Exercise the one-slot recovery through isolated actual admission with
   unknown/live reservations and account/owner holds; prove no duplicate or
   unauthorized worker launch. Unit tests are not launch receipts.
6. Only after integration gates, coordinate authorized nonpublishing promotion
   and verify selected and loaded generation receipts. Do not restart existing
   terminals to satisfy this handoff.

### Source versus selected/loaded

The edited source is this assigned checkout. Its `plugin-activation.json`
still selects `gen-1788601017854`; the live `../../plugin-activation.json`
selects `gen-1788841880125` with source receipt
`b246a7a0311f16844272debdbee4b01779a9fb75`. These older selection files were
read, not changed. The exposed tool's actual behavior was checked, but no
loaded-generation/module-hash receipt was inspected. Source/selected/loaded
equality is therefore **not established**. No promotion, live policy write,
publication, commit or process restart was performed.

Reward/result: a shared evidence contract for people and agents, a reusable
honest accessible renderer, a narrowly reproduced and tested controller fix,
and concrete integration/acceptance instructions rather than another ledger.

The Quest API rejected a combined step-note/global-artifact update because a
worker may update only its assigned step state and bounded evidence note.
The handoff was then reported through the assigned step alone. Parent should
attach this document as the global artifact/reward; no role bypass was used.
