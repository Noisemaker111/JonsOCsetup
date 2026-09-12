---
name: agents-and-main
description: Run verified autonomous development on agents for authorized maintainers. Prepare main releases with CI and generated patch notes only when the human explicitly requests a release; only the human merges main.
license: MIT
---

# Agents and Main

Prefer `agents` for automated development integration and `main` for human-approved stable releases when establishing a new workflow. Preserve an existing project contract unless the user asks to change it.

Keep development moving while customers use a predictable stable release. All agents acting for authorized project maintainers own the agents loop; the designated human personally performs the stable merge. Determine maintainer eligibility from current repository permissions (write, maintain, or admin), including a bot only when its maintainer authorization is recorded. Do not hardcode one agent, model, machine, or PR author as the only eligible contributor. Adapt this workflow to the project's actual branches, host, checks and permissions.

## One shared branch command

Use `sb main` and `sb agents` in any project's checkout to switch to that branch
and fast-forward it from `origin`. Git saves the checked-out branch; there is no
separate selection file. `sb` means switch branch. Keep this command in this skill,
not in project-specific launchers or copied repository scripts.

For PowerShell, install once by running `scripts/install.ps1` from this skill.
It places `sb.ps1` in `~/.local/bin`, which must be on PATH. It needs only Git.
Re-run the installer after updating the helper. Projects adopt the same command
without registration. Run it inside the intended repository, not an ambiguous
parent folder. Other shells can use `git switch` and `git pull --ff-only` directly
under the same checks rather than adding another selector system.

The command refuses dirty checkouts, local commits outside the fetched branch,
and branches already checked out in another worktree. It never stashes, resets,
forces, pushes, or merges development into stable. Updating a local branch from
its own remote is not a release. Use it only in a checkout you own: Git cannot
detect an idle agent reading a clean directory. Agents continue development in
owned worktrees; never switch another session's checkout. Switching changes files
on disk and does not hot-reload or pin running processes.

## Establish the project contract

Read the project's instructions, current Git state, open PRs and deployment configuration. Identify the branch and revision actually serving customers, the development environment, required checks, and existing session owners. Preserve dirty work and active sessions; use an owned worktree when another session may share the checkout.

When adopting this workflow, you must create or minimally update the repository-root `AGENTS.md` so future agents discover it. Add a short workflow paragraph covering the shared `sb agents` / `sb main` command, owned worktrees, authorized agents integration after verification and CI, and human-only main merges initiated by the user. Link the project's detailed policy instead of copying this skill. Reconcile conflicting existing merge instructions; preserve unrelated rules and never infer authorization from the template. Use [references/project-policy.md](references/project-policy.md) for the compact root note and detailed policy. Record actual branch names, environment boundaries, check commands and authorization. Existing `main` or `master` can stay stable; branch renaming is unnecessary. Installing this skill does not itself authorize merges or deployments. Apply existing authorization without repeatedly asking for the same dev actions; clarify only a missing decision that blocks concrete work.

A branch alone does not isolate production. Trace the running frontend through its backend, database, storage, jobs, queues, auth and external integrations. Give dev independent mutable state and safe integration targets where needed. A dev UI pointing at the production backend still changes production. For local agent runtimes, separate state and pin loaded code to a revision; preserve existing sessions and prevent older workers from consuming newer-generation jobs.

Implement the project's authorized branch protections, CI and deployment mapping. Make production consume only reviewed revisions merged into the stable branch. If unattended integration is requested, configure and exercise an actual CI job or coordinator. Written instructions and a platform's auto-merge toggle do not prove that a job runs or that its checks protect the correct branch. Do not introduce privileged execution of untrusted PR code.

Before calling adoption complete, reopen the saved root `AGENTS.md` and follow its policy link to confirm the workflow is discoverable and consistent. Verify adoption with a small real dev change: checks pass, its PR merges into dev, the dev environment serves the result, and production retains its prior code identity and isolated data. Report any missing enforcement precisely.

## Own the agents loop

1. Start from current dev in an owned checkout. Reuse a PR already handling the same work. The parent prepares the runtime and declared dependencies before dispatching workers; unexpected setup failures return to the parent for repair.
2. Implement the requested change and run the project's required checks plus a real check of the affected user operation. Use test data and the configured dev host. Scale verification to the change; documentation edits do not require an unrelated application rebuild unless repository gates require it.
3. Commit only owned changes and create or update a ready PR targeting dev. Inspect the actual diff, current head, base, required checks and mergeability. Within the recorded authorization, merge when those conditions pass. Resolve failures instead of bypassing checks. If the head changes, validate the new revision before merging.
4. Verify the merged result through the configured dev build or runtime. Distinguish saved source, merged PR, deployed artifact and loaded process. For delegated work, confirm that the original coordinator receives the saved result automatically when automatic returns are part of the project workflow.
5. Report the result and any remaining limitation. Continue to completion within the authorized dev scope without asking the user to perform routine technical review.

Development integration does not authorize a stable release, production data changes, package publication or unrelated infrastructure changes. Keep those boundaries explicit in the project policy.

## Keep routine work on agents

Do not show release PR numbers, announce that a release is ready, propose a stable
promotion, or ask the user to merge during ordinary work. Report development
outcomes and continue the next justified improvement. Do not automatically open
release PRs after agents merges. The user initiates release work explicitly, for
example "release main". Only then prepare the frozen candidate, generated patch
notes and CI. Even in release conversation, use a descriptive link rather than a
release PR number. The human still personally performs the stable merge.

## Prepare a deliberate stable release only when requested

Prepare a concrete release candidate from a specific verified dev revision. Open a release PR against stable and freeze the candidate so later dev work cannot silently join an approved batch. Review the entire candidate's diff against stable, including changes from other contributors.

Automatically generate patch notes for the exact frozen release candidate from its merged PRs/changes, attach them to the release PR, and run release CI. Keep evidence and behavior claims grounded in the actual changes; mark unverified migrations or effects instead of inventing them. Preserve the candidate when later agents commits arrive; prepare a separate next batch. Provide a short demonstration or acceptance check, applicable migration steps, rollout checks and a rollback target. Check frontend and backend compatibility separately, including old clients during rollout. Prefer compatible migration stages; reverting application code does not undo a destructive data migration.

Only the designated human may merge agents-derived releases into main/stable. Agents must never perform that merge, enable auto-merge for it, or push directly to stable, even after receiving chat approval for the batch. When the user explicitly requests release work, prepare a ready, CI-green release PR for the human to merge themselves. Never prompt for a release during ordinary development. General development authorization and earlier release approval do not change this boundary.

After observing the human's completed merge, verify it and follow separately authorized deployment gates. Serve the reviewed revision merged into stable, verify actual frontend and backend release identities and the affected customer operation, and keep the prior artifact available according to the rollback plan. Do not leave a preview or open PR serving as production.

For an urgent hotfix, branch from the currently deployed stable revision, verify the fix, prepare its CI-green release PR for the human to merge, and bring the fix back into agents. Do not release the unrelated dev backlog with the hotfix.
