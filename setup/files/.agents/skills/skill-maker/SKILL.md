---
name: skill-maker
description: Create, validate, and publish agent skills (GitHub, skills.sh). Use when making, fixing, or shipping a skill.
license: MIT
---

# Skill Maker

Finish the whole job. Local requests end at a validated, discoverable skill; publish requests end at a verified public install. Ask only when truly blocked.

## Author
Write `skills/<name>/SKILL.md` (repo) or the host's user skill dir (local). Use a lowercase-hyphenated name that matches its directory. The `description` says what it does and when to use it. Extend existing skills rather than overlap them. Add references or scripts only when they earn their place. Never bake in local paths, credentials, or permissions.

## Validate
Run any format validator. Install to a temp dir with the real installer and compare to source. Confirm the intended request triggers it and a nearby unrelated one doesn't.

## Publish (only if asked)
Follow [references/publish-skills-sh.md](references/publish-skills-sh.md).
- Ship this skill only: no dev backlog, no unrelated code, no private repos going public. If installs come from a stable branch, land the skill there in its own PR, or use an explicit branch URL and say so.
- Scan the diff for secrets and local paths. Inherit the repo's license rather than inventing one. Add an install example to the README.
- PR and merge per repo policy, then install for real and verify against the published source. Don't clobber a same-name skill.
- Check the skills.sh page itself. If indexing is pending, say so and give the GitHub install command. Recheck once; don't re-run installs to nudge it.

End with the link, install command, invocation example, what was verified, and whether a fresh session is needed to load the skill.