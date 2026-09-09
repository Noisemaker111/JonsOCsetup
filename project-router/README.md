# project-router

An on-demand conversational project front door for OpenCode2. Runtime code is
owned here; Quest identity, assignment, verification, continuation and admission
remain behind declared Quest-owned facades. `plugin-set.json` and `plugin.json`
register this package. Default-deny agents also need explicit router tool grants in
the owning configuration; plugin registration alone does not make tools available.
Verify discovery from the actual hub/destination giver after coordinated promotion.

## Hub workflow

1. `project_discover({source:"projects", search:"atlas", limit:10})` or
   `{source:"sessions", search:"failing check", limit:10}`.
2. `project_resolve({selectors:["atlas"]})` resolves explicit names, paths,
   canonical remotes or approved aliases. Recency never authorizes work. Ambiguous
   names produce one clarification and no launch. `discussion:true` creates no work.
3. `project_select({action:"select", selectors:["C:/Projects/atlas"]})` reads
   destination instructions and returns a revision. `pin`, `correct`, `alias`
   and `forget` use the same tool. Aliases survive a fresh hub conversation.
4. `project_route({revision:1, requestKey:"fix-check-1", text:"Fix the failing check"})`
   creates/verifies a real destination giver with the hub's actual agent and exact
   model/variant, then admits the original request. Follow-up request keys reuse the
   verified destination session. Multiple selected targets remain independent.
5. `project_result({})` reads bounded destination excerpts back into the hub.
   Excerpts are not completion proof. Quest operations run in the destination
   conversation, never by impersonating a hub caller's session context.

Use the same request key for delivery retries. A changed request/selection requires
a new explicitly authorized key after inspecting prior work. Correction invalidates
old revisions; it does not cancel already-delivered work. Unknown creation/delivery
is retained and never blindly retried.

## Repo onboarding

`project_clone({url:"https://example.org/team/repo", authorized:true,
requestKey:"clone-repo-1"})` requires explicit user clone/work authorization.
`projectParent` is a plugin option, defaulting to `C:/Users/Jk101/Projects`.

The router probes a bounded set of known clones and a matching basename, reserves
the destination exclusively, and clones into `<parent>/<name>/repo`. The outer
directory retains an attempt receipt. An empty template and process-local Git
settings disable hooks, checkout filters and fsmonitor execution. No installs,
submodules or repository scripts run. A verified result has a materialized HEAD.
Collisions and partial/auth/cancelled/unknown attempts are preserved. `retry:true`
reconciles an existing attempt; it never overwrites partial bytes or automatically
repeats authentication. A fresh attempt can use an explicitly configured different
parent after inspection.

## Goals and verification

`project_goal` and `/goal` expose `start`, `status`, `pause`, `cancel`, `resume`.
Giver start names one Quest and explicit authorized step IDs. It reuses canonical
Quest continuation/admission and the explicitly selected route. Worker start is
restricted to its current assigned steps and canonical route/account reservation.
Successful execution events can admit a bounded same-session follow-up; a worker
never creates Quests or dispatches another worker.

The giver binds an existing configured verification command with
`project_verify({action:"bind", questID, stepID, commandID})`. The assigned worker
uses `action:"run"`; the tool runs that contract in its verified actual workspace
and records actual passing/failed proof. A claimed `done` state alone is insufficient.
Workers report only current assigned step states and bounded evidence/result notes;
the giver owns global artifacts, reward and definition changes.

Worker pause and recoverable stops retain workspace/account ownership for verified
same-session resume and admit no more turns. `status` makes this retention explicit.
`cancel` finalizes an observed terminal outcome. Resume refreshes the exact account,
checks route/definitions/ownership/binding and grants a new bounded three-turn epoch.
Unknown admission remains non-retryable. A restarted plugin has no live goal
authorization until explicit resume; it never pursues the historical backlog.

## Tool recovery

- `PROJECT_MISMATCH`: discover/select the owning root and route to its real giver.
- `project_route_status` distinguishes unavailable authorized routes, missing
  reasoning, ambiguous account/service routes, stale quota and account hold.
  Candidate `route:<id>` selectors are executable in `quest.run.model`; no route,
  provider or reasoning substitute is invented.
- Quest list/get/update defaults are compact. For complete evidence use
  `quest({action:"get", id, inspect:{section:"runs", offset:0, limit:8000}})`.
  Sections include description, reward, steps, runs, artifacts, changes and
  continuation; continue with the returned character offset.
- Usage tool defaults omit bulk telemetry history; explicit pagination requests
  expose bounded history.
- Orchestration unknown/live locks are preserved. Accepted contended lineage is
  durably pending rather than dropped; startup replay yields before registration
  and reports lock state instead of freezing the host.

## Discovery and runtime limits

Discovery uses supported, argv-only `opencode2 api --standalone GET` calls on demand.
No database, credentials or private service leases are scraped. Projects use the
installed root-array response; recent sessions/messages use bounded cursor pages.
User messages may contain `text`, while assistant messages contain `content` parts.
Host IDs remain separate from canonical Quest project identity and chosen worktree.

See `docs/project-router-implementation.md` for actual check receipts and pending
acceptance. Source is not proof that an existing session loaded this plugin.
Parent promotion and a fresh verified session are separate rollout steps.
