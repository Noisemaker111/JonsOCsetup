# Publishing on skills.sh

Verified against the official [skills CLI](https://github.com/vercel-labs/skills) and [directory FAQ](https://skills.sh/docs/faq). Recheck these sources when a command or indexing behavior fails; do not search the entire publishing ecosystem for every ordinary release.

## Installation is the publishing path

Keep a valid skill in a public GitHub repository, normally `skills/<name>/SKILL.md` on the default branch. The CLI also supports explicit GitHub tree URLs. Check the repository's default branch before choosing the source. A merged dev PR alone does not put the skill on a different default branch.

Discover a local candidate without modifying installed skills:

```text
npx --yes skills add <local-repository-path> --list
```

In an isolated test directory, verify a project-scoped installation:

```text
npx --yes skills add <local-repository-path> --skill <name> --agent <agent> --yes
```

After the requested publication is merged, use the public source for the real install:

```text
npx --yes skills add <owner>/<repo> --skill <name> --global --agent <agent> --yes
```

Common agent values are `codex`, `opencode` and `claude-code`. Choose the user's host; do not install to every host indiscriminately. Omit `--global` for project scope. Existing installations may use links, so verify their resolved contents. `--copy` is available where links are unsuitable. For multiple requested skills, pass their names after `--skill`.

The standard directory URL is:

```text
https://skills.sh/<owner>/<repo>/<name>
```

The directory derives discovery and ranking from anonymous CLI installation telemetry; the official FAQ documents no separate manual submission. Use a real installation, not synthetic events or repeated installs to inflate rank. Respect existing telemetry preferences (`DISABLE_TELEMETRY` and `DO_NOT_TRACK`); do not silently unset them. If indexing requires a change to those preferences, explain it and obtain authorization or leave indexing pending.

## Evidence and recovery

Confirm the public GitHub source contains the reviewed skill, the installer discovers the exact name, and the installed files match. Open the directory URL and confirm it shows the intended skill and repository. A guessed URL, HTTP 200 error shell or successful CLI exit does not prove a directory listing. Search can lag behind a working detail page; distinguish those states.

If the page is missing, recheck after a short interval and inspect the source branch, skill name, public visibility and installer result. A few checks across several minutes are enough to identify an external indexing delay. Record the URL, time and observed response; do not claim a listing or keep the turn open indefinitely for external indexing.

When publication is blocked by a repository gate, complete the reviewable PR and state the specific remaining gate. Do not bypass branch protection, change the default branch or merge unrelated runtime changes merely to make a catalog page appear.
