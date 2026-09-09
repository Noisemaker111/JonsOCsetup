---
name: ship-fast
description: Set up or operate a two-branch release workflow with verified agent auto-merges into dev and human-approved batches into stable (main or master). Use when separating experimentation from customer releases, adopting stable/dev environments, or preparing a deliberate stable promotion.
license: MIT
---

# Ship Fast

Keep development moving while customers use a predictable stable release. Agents own the authorized dev loop; a human chooses the stable release batch. Adapt this workflow to the project's actual branches, host, checks and permissions.

## Establish the project contract

Read the project's instructions, current Git state, open PRs and deployment configuration. Identify the branch and revision actually serving customers, the development environment, required checks, and existing session owners. Preserve dirty work and active sessions; use an owned worktree when another session may share the checkout.

When adopting this workflow, write a small project policy using [references/project-policy.md](references/project-policy.md). Record actual branch names, environment boundaries, check commands and authorization. Existing `main` or `master` can stay stable; branch renaming is unnecessary. Installing this skill does not itself authorize merges or deployments. Apply existing authorization without repeatedly asking for the same dev actions; clarify only a missing decision that blocks concrete work.

A branch alone does not isolate production. Trace the running frontend through its backend, database, storage, jobs, queues, auth and external integrations. Give dev independent mutable state and safe integration targets where needed. A dev UI pointing at the production backend still changes production. For local agent runtimes, separate state and pin loaded code to a revision; preserve existing sessions and prevent older workers from consuming newer-generation jobs.

Implement the project's authorized branch protections, CI and deployment mapping. Make production consume only reviewed revisions merged into the stable branch. If unattended integration is requested, configure and exercise an actual CI job or coordinator. Written instructions and a platform's auto-merge toggle do not prove that a job runs or that its checks protect the correct branch. Do not introduce privileged execution of untrusted PR code.

Verify adoption with a small real dev change: checks pass, its PR merges into dev, the dev environment serves the result, and production retains its prior code identity and isolated data. Report any missing enforcement precisely.

## Own the dev loop

1. Start from current dev in an owned checkout. Reuse a PR already handling the same work. The parent prepares the runtime and declared dependencies before dispatching workers; unexpected setup failures return to the parent for repair.
2. Implement the requested change and run the project's required checks plus a real check of the affected user operation. Use test data and the configured dev host. Scale verification to the change; documentation edits do not require an unrelated application rebuild unless repository gates require it.
3. Commit only owned changes and create or update a ready PR targeting dev. Inspect the actual diff, current head, base, required checks and mergeability. Within the recorded authorization, merge when those conditions pass. Resolve failures instead of bypassing checks. If the head changes, validate the new revision before merging.
4. Verify the merged result through the configured dev build or runtime. Distinguish saved source, merged PR, deployed artifact and loaded process. For delegated work, confirm that the original coordinator receives the saved result automatically when automatic returns are part of the project workflow.
5. Report the result and any remaining limitation. Continue to completion within the authorized dev scope without asking the user to perform routine technical review.

Development integration does not authorize a stable release, production data changes, package publication or unrelated infrastructure changes. Keep those boundaries explicit in the project policy.

## Prepare a deliberate stable release

Prepare a concrete release candidate from a specific verified dev revision. Open a release PR against stable and freeze the candidate so later dev work cannot silently join an approved batch. Review the entire candidate's diff against stable, including changes from other contributors.

Provide customer-facing release notes, a short demonstration or acceptance check, applicable migration steps, rollout checks and a rollback target. Check frontend and backend compatibility separately, including old clients during rollout. Prefer compatible migration stages; reverting application code does not undo a destructive data migration.

Obtain the designated human's explicit approval for that concrete batch before merging or serving it as stable. Reuse approval already given for the same candidate and actions; a material candidate change needs renewed review. Finish all independent preparation before asking. General dev authorization, installing this skill and approval of an earlier release do not approve the next batch.

After approval, follow the project's stable merge and deployment gates. Serve the reviewed revision merged into stable, verify actual frontend and backend release identities and the affected customer operation, and keep the prior artifact available according to the rollback plan. Do not leave a preview or open PR serving as production.

For an urgent hotfix, branch from the currently deployed stable revision, verify the fix, obtain the applicable stable-release approval, and bring the fix back into dev. Do not release the unrelated dev backlog with the hotfix.
