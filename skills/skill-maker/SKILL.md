---
name: skill-maker
description: Create, improve, package, validate, install and publish agent skills end to end, including GitHub releases and skills.sh discovery when requested. Use for making or shipping a skill, or repairing a skill-making workflow; keep local-only requests local.
license: MIT
---

# Skill Maker

Own the requested skill outcome in one continuous workflow. A request to make and publish a skill includes authoring, validation, repository publication, a real installation and checking the public link. Do not stop at a scaffold or hand the remaining release chores back to the user.

One request should be enough. Batch independent inspection, write the coherent package together, then perform dependent validation and publication in order. Reuse established repository and installer facts rather than rediscovering them every time. This is a workflow, not a promise that Git, installation and indexing can happen in one tool call.

## Resolve only what matters

Infer the purpose, representative request, destination repository, audience and publication scope from the conversation and existing skills. Ask only for missing information that materially blocks the requested result; continue independent work while waiting. Choose a clear lowercase hyphenated name when the user delegates naming.

Inspect the target repository instructions and existing work before changing it. Preserve session ownership, dirty files, existing skills, authentication and remotes. Use an owned worktree for shared repositories. Prefer updating the existing skill over adding overlapping skills with competing triggers. For managed or bundled skills, keep the maintained extension in user-owned source and use a small explicit routing hook if the user requests integration; report that managed updates may replace the hook.

Local creation is not permission to publish. A request to publish authorizes that requested destination and package, subject to the project's release gates. Reuse approval already given; do not infer authority to release unrelated code, make a private repository public or expose its history.

## Author the useful package

Create `skills/<name>/SKILL.md` for a repository collection, or the host's discoverable user skill directory for a local-only skill. Use YAML frontmatter with `name` and `description`. Make the description explain the actual capability and when to select it. Use a license field only when the package has that license.

Write the decisions another capable agent needs: intended outcome, operating steps, concrete permission boundaries, completion evidence and recovery from likely failures. Preserve the user's scope and project-specific conventions. Do not turn one machine's paths, credentials, preferred model or standing permissions into portable defaults.

Keep the entrypoint concise. Add a reference only for substantial conditional material, link it where needed, and keep one source of truth. Add executable helpers only when repeated deterministic work warrants them; execute changed helpers. Avoid placeholder directories, copied manuals and generic checklists. Include host UI metadata when useful and supported, without requiring it for other agents.

For a shipping request, add a brief installation and invocation example to the repository's existing public documentation. Inspect the publication diff for local paths, logs, credentials, private examples and unlicensed copied material. Choose or inherit a license deliberately.

## Validate before release

Use the available skill-format validator when one exists. Also use the intended installer to discover the named skill and install it into an isolated test directory. Check the installed SKILL.md and referenced resources against the authored package. Preserve existing installed versions until the candidate is validated.

Review realistic behavior: the intended request selects this skill; a nearby unrelated request does not; the instructions carry authorized work through the stated boundary without inventing permissions. For a workflow governing consequential actions, test a representative ambiguous or failure case with an isolated evaluation when available. Keep tests proportional; do not add suites that merely match headings or repeat the instructions. Run repository-required gates, but do not bootstrap unrelated tooling for an optional check.

## Publish, install and verify

For GitHub and skills.sh, read [references/publish-skills-sh.md](references/publish-skills-sh.md). It contains the supported commands and indexing boundary; do not invent a submission API or create credentials to use one.

Commit the owned package, create or update the appropriate PR and follow the repository's authorized merge policy. Inspect the exact PR base, head, diff and checks. Publishing a skill from a repository with dev and stable branches must not release the unrelated dev backlog. Put only the reviewed skill publication on the public installation branch through a scoped PR when authorized, or use an explicit branch URL and report that choice.

Install the published skill into the requested agent's real discoverable location. Verify the installed content and supporting files match the public source. Do not assume that writing a file updates an already running agent's catalog; state when a fresh session is needed. Do not overwrite an independent skill with the same name without resolving ownership.

Check the actual public directory page before saying it is listed. If the installer succeeds but skills.sh indexing is pending, report those as separate observed states and provide the working GitHub source and installation command. After a bounded recheck, leave precise follow-up evidence instead of inventing success or repeatedly generating installations.

End with the usable link, install command, invocation example and concise verification status. For local-only requests, the saved discoverable skill and its validation are the completion boundary; skip public release work.
