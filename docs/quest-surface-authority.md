# Quest surface authority: reader trace

Traced 2026-09-16 (UTC) on `agents` at `6f66244` in the assigned Quest worktree. Read-only: no Quest record, session or queue was changed. This is the inventory the unification step consumes; every reader below was found in source, and `scripts/verify-quest-surface-trace.ts` re-checks each named anchor against this revision and against the live ledger. The unification itself (the composed read in `quest/reachability.ts`, the surface wiring and the removed superseded readers) is recorded below and pinned by the same check.

## The four layers a "Quest state" can come from

Every surface answers a state question from one of these layers. Naming the layer is what keeps labels from contradicting each other.

| Layer | Stored where | Read by | What it proves |
| --- | --- | --- | --- |
| **Saved record** | `<questRoot>/.opencode/quests/*.md` snapshot + append-only journal `runtime/events/*.jsonl`; reducer `reduceQuest` | `QuestStore.read` (`quest/store.ts`) reads file + events; `QuestStore.apply` writes events | What was saved: lifecycle, steps, session rows, permission decisions, escapes. Never live execution. |
| **Read normalization** | Computed at read time, not stored | `normalizeState` (`quest/state-machine.ts`) applied inside `readAllQuests` (`quest/index.ts`) | Re-derives `state`, `reason`, `nextAction`, `missingRequirements` from steps/sessions; recomputes `executingCount` from the newest attempt per resume lineage. This is why two readers of "the record" can disagree: `readAllQuests` sees a derived state, `QuestStore.read` sees the persisted one. |
| **Live observation** | Host session store and event stream | `observeWorker` (`quest/worker-observation.mjs`) fed by `host.get`/`host.active`/`host.context`/`permission.list`; event registry `recordHostObservation`/`hostExecution` (`quest/host-observation.ts`); activity snapshot `readQuestActivity` (`quest/activity.ts`) | Whether the owning host currently holds an execution, a persisted outcome, a pending request, or nothing at that id. Absence is only terminal when the owning host answers. |
| **Decision and queue records** | Runtime directories under `<questRoot>/.opencode/.quest-runtime/` | `start-requests/*.json`, `continuations/*.json`, `worker-returns*/*.json`, `permission-reviewers/<giverID>.json` readers | Explicit authorizations, in-flight continuations, delivery notices and reviewer pins. These are routing/intent records, not Quest state. |

## Reader inventory

### A. Board and chrome (TUI, `quest/tui-active/`)

| Surface | Entry | Read path | Live check | Labels exposed |
| --- | --- | --- | --- | --- |
| `/quest` menu (board route) | `quests` plugin default (`quests.tsx`), route render `QuestBoard` (`quest-board.tsx`); slash `quests`/`quest`/`board` | `quests(root)` = `readAllQuests(root,{includeArchived:true})`, scoped by `projectQuests`/`boardProject`; fs refresh `watchQuests` | `useWorkerObservations` on each displayed owned run; permissions from the same hook; row label from `reachLabel` → `questReachability` (`quest/reachability.ts`) | Sections `New Quests` / `Current Quest` / `Completed Quests` from `sessions.length` and step states; row state from the one composed read (owned run's reachability, else saved lifecycle); detail badge uses the same `reachLabel` |
| Sidebar | `Sidebar` (`quests.tsx`), slot `sidebar.content` | `useQuests` = same `readAllQuests` + project scope; excludes `state === "Archived"`; top 12 by `updatedAt` | same `useWorkerObservations` as the footer, for the rows shown | `toneColor(questReachability(q, observation).tone)`; count `done/total` |
| Composer/home footer | `QuestStatus` (`quests.tsx`), slots `session.composer.top`, `home.footer` | same `useQuests`; `ownedRuns(q)` = `latestSessionAttempts` filtered to `planned/executing/waiting/blocked` | `useWorkerObservations` per owned run (session.active/get, message.list, permission.list, form.list; 4 s poll + host events) | `↳ Open worker · <reachability state> · <title>`; `Review permission` link from the same read's `pendingPermissions`; count dialog `filterQuests(..., observation)` |
| Session banner | `SessionRole` (`quests.tsx`), slot `session.composer.top` | all quests to map `sessionID → quest/session`; giver registry `userGiverID` polled 1 s | one `useWorkerObservations` per matched session, drawn through `runReachability` | `YOUR QUEST GIVER` / `QUEST WORKER` / `SESSION HISTORY`, plus the run's reachability state and `Activity unconfirmed` fallback |
| Permission reviewer choice | `choosePermissionReviewer` (`tui-active/reviewer-settings.ts`), slash `quest-reviewer` | `reviewerSettings()` runtime settings file | available models via host catalog when offered | Current reviewer setting; writes the setting only |
| Worker approvals | `reviewWorkerPermissions` (`tui-active/worker-permissions.ts`), slash `quest-approvals` | `readAllQuests(questRoot(),{includeArchived:false})`, active native runs only (`executing/waiting/blocked`) | `context.client.permission.list({sessionID})` per run, giver location only | Pending request action/resources; replies via `WorkerPermissions` (once/reject) or opens the worker |

### B. Tools and service (`quest/service.ts` and its callers)

| Surface | Entry | Read path | Live check | Labels exposed |
| --- | --- | --- | --- | --- |
| `quests` MCP namespace (Code Mode) | `installQuestTools` (`quest/server.ts`) → `serveQuestAPI` (`quest/api-server.ts`) → `createQuestService` | `questsAPI` (`quest/api.ts`); list items re-projected through `toolSummary`/`toolPlan` from `store.read`, then `withQuestActivity`; `get/status` through `toolDetail`/`toolStatus` | `reconcileWorkers` on `run`/`wait`/`inspect.runs`; `readQuestActivity` (host.active map) on every list/get/status; `inspect.runs` attaches `observeWorker` per active run | `state` may be rewritten `Working → Waiting/Needs attention` when no active execution is confirmed; `recordedState` and `recordedExecuting` carry the un-rewritten values; `activity {running,unconfirmed,assigned,checkedAt}`; `runs[].state` is the saved session state |
| `quests.wait` | same service, `input.action === 'wait'` | fingerprint `observedState` over `store.read`, reconciled while awaiting | `awaitQuestChange` calls `reconcileWorkers`; returns observations via `inspectWorker` | `waited.runs[].observation` and steering; worker self-wait is refused with `WORKER_SELF_WAIT` |
| `quest_work_supply` | `workSupplyTool` (`quest/adaptive-tools.ts`) | `readAllQuests` + `ownedRuns` | `readQuestActivity` once per call | `active`, `unknown`/`unconfirmed`, `assigned`, `checkedAt`, ready steps; states it is not authorization or capacity |
| `quest_guidance` | `guidanceTool` (`adaptive-tools.ts`) | `readAllQuests` to prove the caller is a worker; `QuestStore` for the run | `sessionGuidance` delivers queued/steer guidance to the worker session | Guidance state on the run; no board state |
| `quest_outcome` | `outcomeTool` (`adaptive-tools.ts`) | workflow outcome files (`quest/outcome-tracking.ts`) | none | Recorded workflow outcomes; giver judgement separate |
| CLI `quest …` | `quest/cli.mjs` → `client.mjs` → HTTP endpoint from `api-server.ts` | same `createQuestService` | same | Same projections as the MCP tools |
| `project_result` / `project_goal` / `project_verify` | `project-router/server.ts` → `routerQuestInventory` (`quest/router-public.ts`) and `createGoalFacade` (`quest/goal-public.ts`) | `readAllQuests(questRoot(),{includeArchived:true})` inventory; continuations queue for goal status | facade `verifyContext` (host.get + `verifyGiverBinding`) and goal reservations | Compact Quest inventory for the giver; goal rows `waiting/running/stopped/done` with `live`/`resumeRequired` |

### C. Reachability readers

| Reader | File | Inputs | Output |
| --- | --- | --- | --- |
| Canonical classifier | `quest/worker-observation.mjs` `observeWorker` | session row, `active`, last 3 messages, pending `permissions`, `forms`, expected run | `blocked` (pending permission/form), `interrupted` (confirmed idle + acknowledged reject), `completed/failed/interrupted` (persisted outcome idle ≥ last message), `blocked` (agent/model/reasoning mismatch while not confirmed idle), `running` (host-confirmed active), else `unknown`; `observationFailure` turns 404 into `missing`, other errors into `unreachable` |
| TUI live poll | `quest/tui-active/worker-observation.tsx` | `session.active`, `session.get`, `message.list`, `permission.list`, `form.list`; 4 s + host events | Same classifier per owned run; `Checking owning host…` until first answer |
| Tool inspection | `quest/worker-inspection.ts` `inspectWorker` | `host.get`, `host.active`, `host.context`, `hostPermissions` | Same classifier; used by service reads, `waits`, `reconcileWorkers` |
| Idle confirmation | `quest/worker-inspection.ts` `confirmWorkerIdle` | `host.active`, event registry, `host.wait` (await-idle only) | Boolean; never interrupts or resumes |
| Activity snapshot | `quest/activity.ts` `readQuestActivity` / `questActivity` | `host.active` map, or per-id `hostExecution` when the host has no `active()` | `{running, unconfirmed, assigned}`; `withQuestActivity` rewrites unconfirmed `Working` to `Waiting` or `Needs attention` |
| Event registry | `quest/host-observation.ts` `recordHostObservation`, `hostExecution` | host stream `session.execution.*` / `session.status` | Per-session `active` flag; `connectHostObservation`/`disconnectHostObservation` gate it; `hostPermissions`, `hostPermissionDomain`, `hostModelIdentities` |
| Reconciliation sweep | `quest/worker-inspection.ts` `reconcileWorkers` (5 s poll at the giver location) | `readAllQuests` + host reads + dispatch-intent receipts + workspace existence + external leases | Writes authoritative terminal rows: interrupted preflight → `failed`; bound empty idle → `failed`; workspace gone → `stale`; expired external lease → `stale`; owning host 404 → `missing`; persisted outcome → tracker terminal settle |
| Host event settle | `quest/tracker.ts` `onHostEvent` | `message.updated` (answering model), `session.updated/created`, `session.execution.succeeded/failed/interrupted` | Model identity on the run; terminal settle `completed/failed/cancelled`; shutdown interruption is retained, not settled |
| Goal worker events | `project-router/server.ts` (event loop) → `quest/goal-public.ts` `event` → `continuation.workerEvent` | `session.execution.*` for a live goal worker session | Advance one same-session turn; failure pauses the goal |

### D. Permission-state readers

| Reader | File | Inputs | Output |
| --- | --- | --- | --- |
| Request identity | `quest/worker-permissions.ts` `permissionKey`/`permissionSummary` | request id, sessionID, action, resources, save, source | Stable key and redacted summary; key mismatch means the request changed |
| Discovery (worker location) | `quest/worker-returns.ts` `tick(directory)` | Own permission domain; validates run worktree = directory and native session location = directory | Pending requests routed to `PermissionReviewer` |
| Discovery (giver location) | `tui-active/worker-observation.tsx`, `tui-active/worker-permissions.ts` | `context.client.permission.list({sessionID})` from the giver's client | Footer link and approval dialog; requests outside this location's domain do not appear |
| Reviewer input | `quest/permission-reviewer.ts` `review` | `WorkerPermissions.inspect` (tool input, redaction, `canApprove`), giver user instructions from `host.context`, `questStartAuthorization`, `reviewerSettings()` | Review record `reviewing/retrying/decided/escalated/unknown`; decision `once/reject/escalate` |
| Decision write | `quest/worker-permissions.ts` `reply` | pending request must match key and owned run; `permissionReplyInput` revalidates giver, worker identity, request identity | `permissionDecision` appended to the run with `state: sending/acknowledged/unknown`, `actor: user/reviewer`, `reply: once/reject`; reject then awaits `settlePermissionRejection` |
| Rejection settle | `quest/tracker.ts` `settlePermissionRejection` | acknowledged reject + `host.wait` (await-idle) | `cancelled` only after the host confirms idle; otherwise nothing |
| Reviewer settings | `quest/reviewer-settings.ts` | user settings file + per-giver pin `runtime/permission-reviewers/<giverID>.json` | Exact model/account pin; unavailable route escalates, never substitutes |

### E. Assignment, guard and auxiliary readers

These read the same ledger to gate or route work rather than to draw the board; they still resolve "what is this session/Quest" from saved records and must not be confused with live execution.

| Reader | File | Reads | Purpose |
| --- | --- | --- | --- |
| Worker membership per tool call | `quest/service.ts` (`memberships` from `readAllQuests`), `quest/adaptive-tools.ts` | All sessions matching the calling session id | Decides worker vs giver verbs and refuses worker delegation (`WORKER_DELEGATION_DENIED`) |
| Shared workspace guard | `quest/shared-guard.ts` | Calling session's run across all Quests | Enforces read-only research scope and shared-assignment writes; fail-closed when run state is unreadable |
| Research source binding | `quest/source-binding.ts` `editingSource`/`workerLedgerProject` | Assigned run for the session | Limits edits to the run's bound ledger/project |
| Worker capabilities and instructions | `quest/worker-capabilities.ts`, `quest/worker-instructions.ts` | Assigned run for the session | Scopes tools and injects instruction reads |
| Guidance ownership | `quest/session-guidance.ts` `SessionGuidance` | Quest sessions, runID, parent giver | Only the owning giver can guide a run that is active and owned by it |
| Cleanup status | `quest/cleanup.ts` `cleanupQuests`/`cleanupStatus` | All records incl. archived; workspace manager | Reports/removes run workspaces; reads records only |
| Legacy migration | `quest/legacy-ledger-migration.ts` | All records | Classifies/imports legacy records; migration decision records are separate from Quest state |
| Context compaction | `models/context-plugin.ts` | Pending worker rows from `readAllQuests` | Counts a session's pending workers; throws when any record is unreadable |
| Papercut intake | `papercut/papercut-ui.ts` `createPapercutFollowup` | Non-archived records with `extensions.papercutID` | Avoids duplicate follow-up Quests |
| Incident intake | `orchestration/incident-loop.ts` `intakeIncidents` | Existing records | Avoids duplicate incident Quests |
| Verification harnesses | `scripts/quest-ui-audit.ts`, `scripts/verify-single-giver-installed.ts`, `scripts/verify-project-router-ledger.ts`, `scripts/verify-quest-surface-trace.ts` | Real ledger through the same modules | Read-only evidence capture; the last one is this trace's own check |

### F. Wake and delivery readers (who notices what, and where)

| Wake | Driver | Reads | Delivers |
| --- | --- | --- | --- |
| Start admission | `service.ts` poll `start admission` → `consumeQuestStarts` (`start-request.ts`) | `start-requests/*.json`, `start-request` definition fingerprint, giver binding, `questWorkflow`, continuations | `continuation.run(...)` for queued starts; `Quest ready for review` prompt for review requests |
| Continuation | `service.ts` poll `continuation` → `continuation.tick` (`continuation.ts`); goal mode has its own 5 s timer (`goal-public.ts`) | `continuations/*.json`, Quest record, account usage, reservations | Launches the next pending dependent step when a continuation was explicitly authorized; stops with a saved reason otherwise ("Worker terminal outcome did not complete the assigned steps", "No eligible authorized steps", verification contract changed, ownership changed) |
| Return delivery | `service.ts` poll `return delivery` → `returns.tick()` (`worker-returns.ts`) | `worker-returns*/*.json`, Quest record, host giver session identity/model | One `host.prompt` `msg_questreturn<runID>` with `questCompletionReturn` payload for a terminal `completed/failed/cancelled` newest-attempt run; archived and superseded returns are settled without a wake |
| Permission review | giver location: `returns.tick()` + reviewer; worker location: `returns.tick(directory)` (`service.ts` gate) | Pending requests at the owning location, reviewer settings, user instructions, start authorization | Reviewer reply once/reject; `escalated/unknown` queues one `msg_questpermission<key><authKey>` prompt to the giver asking for the exact missing decision |
| Inspection | `service.ts` poll `inspection` → `reconcileWorkers` + `collectWorkflowOutcomes` | Records + host + receipts | Writes terminal rows so returns/continuations can proceed (see C) |
| Giver location | `service.ts` poll `giver location` → `refreshUserGiverLocation` (`user-giver.ts`) | `giver-registry.mjs` binding + `host.get` | Re-points the binding to the host-reported directory so the polls above run at all |
| Worker completion watchdog | `orchestration/orchestration.ts` `watchSubagentCompletions` + `orchestration-ledger.ts` | spawn/completion ledger, parent session existence | Independent completion re-injection when the parent never received it; suppressed once when the Quest return path already delivered it |
| Wait | `service.ts` `wait` action → `awaitQuestChange` (`quest/wait.ts`) | fingerprints over `store.read`, `reconcileWorkers` | Returns the observed change to the caller; never wakes the giver by prose |

The giver-location gate is explicit in `service.ts`: only the registered giver directory runs the full poll set; another location runs `returns.tick(directory)` (permission review for its own worktree) and nothing else. That is why a wake can exist on disk yet no surface shows it: the reader that would deliver it may not be running at that location.

## The distinctions the Quest requires, and where they live today

| Distinction | Stored/derived signal | Readers that already separate it | Readers that collapse it |
| --- | --- | --- | --- |
| **Archived record** vs saved workflow state | `state === "Archived"` and `archive` flag; archived files live in a separate directory | `questLane` archived lane; sidebar filter; tools default `includeArchived:false`; `worker-returns` skips delivery for archived; `start-request` refuses archived | Board sections treat Archived as `Completed Quests` only via `state`; `ownedRuns`/`uncertainRuns` do not consult `archive`, so a reopened record and an archived one can both carry active-looking session rows |
| **Saved workflow state** vs read normalization | persisted `state` (store) vs derived `state` (`normalizeState`) | `withQuestActivity` exposes `recordedState`; `toolDetail` shows step `state` and `blockedBy` | TUI reads only the normalized result; tools read `store.read` then overlay activity, so the same Quest can show normalized `Waiting` in the sidebar lane while `quests.get` reports `recordedState: Working` |
| **Stalled work** vs terminal | `planned` without session (launch unknown), `executing` with no host confirmation, `missing`/`stale`, expired external lease | `observeWorker` unknown vs completed; `reconcileWorkers` writes `missing`/`stale`/`failed`; runDetails labels `planned` "Launch outcome may be unknown" | Board `Row` prints saved session state only after observation answers; before that the row falls back to persisted labels; sidebar never asks |
| **Pending/rejected permission decision** | pending: live `permission.list` at the owning location; rejected: `permissionDecisions[]` `{reply:'reject',state:'acknowledged'}` on the run | `observeWorker` → `blocked`; `settlePermissionRejection`; `permissionReplyInput` is fail-closed on identity | Giver-location TUI can show no pending request for a worker blocked in another directory; the footer link depends on that same list, so silence is not "no permission needed" |
| **Session existence** | `openCodeSessionId`/`sessionID` present on the run; host `get` result | `inspectWorker` maps a 404 to `missing` and `reconcileWorkers` persists it as terminal; `openWorkerSession` explains pruned/external sessions instead of a dead click | `Sidebar`/`useQuests` cannot tell a pruned session from a live one; `claimed`/`workerLabel` print ids regardless |
| **Confirmed live execution** | `host.active` map, `session.execution.*`/`session.status` events, host `wait` await-idle | `observeWorker` `running`; `readQuestActivity` `running`; continuation `advance` returns while an active run exists | Sidebar colour and board detail `RUNNING` come from persisted `Working`; `filterQuests("active")` uses observation while `questLane` uses persisted state, so "Active" and the "Assigned" lane disagree for the same Quest |

## Superseded readers present in this revision (removed on this branch)

- `quest/quest-tui.tsx` (`questOverview`, `setupQuestTUI`) had no callers anywhere in the tree. It read `readAllQuests` directly and rendered `boardRows`/`formatQuestLine`. **Removed.**
- `quest/host-adapter.ts` (`installQuestHost`) was imported only by `quest/quest-tui.tsx`, and `quest/host.ts` (the only consumer of `renderFrame`) had no importer at all. The chain was dead, not an alternate authority. **Removed.**
- `quest/tui-model.ts` `renderFrame`/`detail`/`formatQuestLine`, `questIndicator` and `questLaneCounts` served only that dead chain, and the two live TUI files imported `questIndicator` without using it. **Removed**; `filterQuests` and the filter vocabulary remain, and `filterQuests` now asks the shared reachability read what "active" means. The chain's one remaining helper, `artifactChainSummary` in `quest/artifacts.ts`, had no caller left once `detail()` went and was removed with it.

## The composed read every surface draws (this branch)

`quest/reachability.ts` is the one authority. It composes the layers above and keeps them named:

- `runReachability(run, observation)` — one run: the observed state normalized to one vocabulary (`running`, `blocked`, `completed`, `failed`, `cancelled`, `missing`, `stale`, `interrupted`, `unreachable`, `unknown`, `external`, `queued`, `launching`), with `confirmed` (host-confirmed live execution), `terminal` (the saved row is over), `over`, the owner's reason, `pendingPermissions` and the recorded `decisions`. A settled run reports the outcome we recorded (`observedRun`), never a live inspection.
- `questLifecycle(q)` — the saved workflow state as a lane label with no live claim (`ATTENTION`, `REVIEW`, `VERIFYING`, `RECORDED`, `PLANNED`, `ARCHIVED`).
- `questReachability(q, observation)` — the newest saved owned attempt's run reachability, else the lifecycle. `tone` is the one colour input (`live`, `blocked`, `uncertain`, `failed`, `done`, `idle`), mapped to the palette once by `toneColor` in `quest-board.tsx`.
- `reachLabel(q, observation)` (TUI) — the row/badge label from that same read.

Board rows, board detail badge, sidebar glyphs, footer lines, session banner and the filter dialog all call these functions, so one Quest cannot read RUNNING on one surface and UNKNOWN on another. `scripts/verify-quest-surface-trace.ts` pins the call sites and the removed files.

## Concrete divergences found (same Quest, two answers)

These were the pre-change state at `6f66244`; 2, 3 and 4 are closed by the composed read above (row, badge and sidebar all draw `questReachability`, and `filterQuests("active")` means host-confirmed execution). 1 and 5 remain, deliberately: they are tool-vs-TUI projection and location-scoped permission discovery, not the board's reachability labels.

1. **Within one `quests.get`/`quests.status` response**: `state` is rewritten by `withQuestActivity` (`Working → Waiting/Needs attention` when no host-confirmed execution) while `runs[].state` and the TUI show saved session states. `recordedState`/`recordedExecuting` exist only on the activity path.
2. **Board vs tools**: the board's detail header prints `RUNNING` for `state === "Working"`; the same Quest's tool `state` prints `Waiting` when `activity.running === 0`.
3. **Board vs sidebar**: the footer/board row labels come from host observation (`running`, `blocked`, …); the sidebar colours from persisted `Working`/`Needs attention`/ready states. A stalled `executing` run is green in the sidebar and `unknown` (or `unreachable`) in the footer.
4. **Driver vs list**: board rows are ordered/sectioned by persisted step/session counts (`group`), while the footer count dialog filters by observation; a Quest can be "Active" in the dialog and sit in "Current Quest" with no live label.
5. **Permission visibility**: a pending request is only discoverable through the permission domain of the location that raised it. The giver-location readers (`worker-observation.tsx`, `worker-permissions.ts`) and the worker-location discoverer (`worker-returns.tick(directory)`) disagree until the reviewer at the owning location records the decision; the run then reads `blocked` even though the giver surface showed nothing.
6. **Archived vs reopened**: `archive` flag and `state === "Archived"` are checked separately by `start-request` (`quest.archive || state`), `worker-returns` (`state` only) and the sidebar (`state` only); a record whose flag and state disagree is handled differently per reader.
7. **Terminal membership**: `TERMINAL_RUN` includes `missing`/`stale`, but `worker-returns` delivers only `completed/failed/cancelled`; `toolStatus` lists only `planned/executing/waiting/blocked` runs, so a `stale`/`missing` run disappears from `status.runs` while still appearing in `inspect.section:runs`.
