# Matt Pocock skills: global user installation

Reviewed 2026-09-05. Sources: [official README](https://github.com/mattpocock/skills), [AI Hero catalog](https://www.aihero.dev/skills), every SKILL.md under skills/, and all 25 matching docs pages. Reviewed commit: `3cca18b368ae95cdbdebbff572ccafa662551015`; released plugin manifest: `1.2.3`. Installed SKILL.md guides execution, subject to user instructions and the local selection policy.

## Installed and verified

Installed the 25 released catalog skills through the official installer for Codex and OpenCode, including setup and supporting references/scripts. The initial **74 files** matched the official checkout by SHA-256. On 2026-09-05, user-authorized local adaptations enabled implicit invocation for the 14 previously manual-only skills, narrowed their discovery descriptions, and narrowed diagnosing-bugs to hard/recurring failures. These adapted files intentionally differ from upstream; the installer lock remains upstream provenance, not a claim of current byte equality. The installer lists both agents for each skill.

- Shared installation: `C:/Users/Jk101/.agents/skills/<name>/SKILL.md`.
- Installer record: `C:/Users/Jk101/.agents/.skill-lock.json`.
- Official source and docs, including the 12 extras: `C:/Users/Jk101/.cache/mattpocock-skills-source/`.
- Workspace rules: [Codex AGENTS.md](../../.codex/AGENTS.md) and [OpenCode AGENTS.md](../../.config/opencode/AGENTS.md).
- Detailed source comparisons: [source review](matt-pocock-source-review.md).

Installed with `--global` for Codex and OpenCode. The global registry records all 25 skills as `mattpocock/skills`. The shared user directory is discovered across projects by [Codex](https://learn.chatgpt.com/docs/build-skills) and [OpenCode](https://opencode.ai/docs/skills/). Existing personal skills and configuration were preserved.

## Detected surfaces and exact install commands

These commands install for your user account from any directory. The interactive selector includes 37 skills; choose the 25 released entries below and include setup. In PowerShell, `npx.cmd` is the explicit Windows shim for `npx`.

| Surface | Detected | Exact command |
| --- | --- | --- |
| ChatGPT/Codex local workspace | Codex CLI, .codex/skills, .codex/AGENTS.md, current local session | `npx skills@latest add mattpocock/skills --global --agent codex` |
| OpenCode | opencode2 CLI (2.0 preview), .config/opencode, .opencode | `npx skills@latest add mattpocock/skills --global --agent opencode` |
| Cursor | cursor CLI and .cursor | `npx skills@latest add mattpocock/skills --global --agent cursor` |
| Claude Code, editable files | claude CLI, .claude/skills, .claude/CLAUDE.md | `npx skills@latest add mattpocock/skills --global --agent claude-code` |
| Claude Code, managed alternative | Same installation | `claude plugins install mattpocock-skills` |

Claude's plugin command is documented in Matt's README and was not executed. Choose either Claude's plugin or editable skills, because both duplicate the pack. This task installed Codex/OpenCode targets only.

| Recommended scope | Path |
| --- | --- |
| Shared user installation, used here | `C:/Users/Jk101/.agents/skills/` |
| Shared per-project installation | `<repo>/.agents/skills/` |
| Existing Codex-specific personal skills, preserved | `C:/Users/Jk101/.codex/skills/` |
| OpenCode-specific alternatives | `<repo>/.opencode/skills/` or `C:/Users/Jk101/.config/opencode/skills/` |
| Claude project / user | `<repo>/.claude/skills/` or `C:/Users/Jk101/.claude/skills/` |
| Cursor project / user | `<repo>/.cursor/skills/` or `C:/Users/Jk101/.cursor/skills/` |

Use one supported location per skill. Shared `.agents/skills` avoids duplicate copies for current Codex and OpenCode. The commands above already include `--global`; no per-project install is needed.

Exact global released-set command (selection order is immaterial):

```powershell
npx.cmd --yes skills@latest add mattpocock/skills --global --agent codex opencode --skill ask-matt setup-matt-pocock-skills grill-me grill-with-docs grilling domain-modeling wayfinder to-spec to-tickets implement prototype research triage tdd code-review wait-what improve-codebase-architecture codebase-design diagnosing-bugs resolving-merge-conflicts wizard handoff teach to-questionnaire writing-for-agents --yes
```

Inspect or explicitly update from `C:/Users/Jk101`:

```powershell
npx.cmd --yes skills@latest list --global --agent codex opencode
npx.cmd --yes skills@latest update --global
```

## Released inventory: all 25 installed

| Skill | When to use |
| --- | --- |
| [ask-matt](../skills/ask-matt/SKILL.md) | Choose the next skill or flow; recommend it and stop. |
| [setup-matt-pocock-skills](../skills/setup-matt-pocock-skills/SKILL.md) | Configure a project's tracker, triage labels, and domain docs. |
| [grill-me](../skills/grill-me/SKILL.md) | Interview any idea without saving local state. |
| [grill-with-docs](../skills/grill-with-docs/SKILL.md) | Interview codebase decisions while recording vocabulary and ADRs. |
| [grilling](../skills/grilling/SKILL.md) | Ask rounds of questions whose prerequisites are settled. |
| [domain-modeling](../skills/domain-modeling/SKILL.md) | Resolve domain terminology and record consequential decisions. |
| [wayfinder](../skills/wayfinder/SKILL.md) | Map a large, foggy effort as decision tickets across sessions. |
| [to-spec](../skills/to-spec/SKILL.md) | Synthesize agreed decisions into a spec and confirm test seams. |
| [to-tickets](../skills/to-tickets/SKILL.md) | Divide agreed work into verifiable tickets with blockers. |
| [implement](../skills/implement/SKILL.md) | Build decided work, test at agreed seams, review, and commit. |
| [prototype](../skills/prototype/SKILL.md) | Answer one design question with a runnable throwaway artifact. |
| [research](../skills/research/SKILL.md) | Delegate primary-source reading to gather decision-blocking facts. |
| [triage](../skills/triage/SKILL.md) | Verify incoming requests and move them through triage states. |
| [tdd](../skills/tdd/SKILL.md) | Build behavior one failing test and minimal implementation at a time. |
| [code-review](../skills/code-review/SKILL.md) | Review a fixed-point diff separately against standards and spec. |
| [wait-what](../skills/wait-what/SKILL.md) | Re-explain an unclear response with context and simpler language. |
| [improve-codebase-architecture](../skills/improve-codebase-architecture/SKILL.md) | Survey architectural friction, then discuss a selected candidate. |
| [codebase-design](../skills/codebase-design/SKILL.md) | Design useful modules with small, testable interfaces. |
| [diagnosing-bugs](../skills/diagnosing-bugs/SKILL.md) | Diagnose hard bugs through a reproducible failing feedback loop. |
| [resolving-merge-conflicts](../skills/resolving-merge-conflicts/SKILL.md) | Resolve an existing merge/rebase conflict using both sides' intent. |
| [wizard](../skills/wizard/SKILL.md) | Generate a Bash script for steps only a human can perform. |
| [handoff](../skills/handoff/SKILL.md) | Carry context to another agent, directory, or colleague. |
| [teach](../skills/teach/SKILL.md) | Learn a topic across sessions with persistent learning materials. |
| [to-questionnaire](../skills/to-questionnaire/SKILL.md) | Collect facts or decisions that another person holds. |
| [writing-for-agents](../skills/writing-for-agents/SKILL.md) | Write agent instructions with clear triggers and completion criteria. |

## Additional inventory: researched, not installed

These 12 are excluded from the released plugin and main README catalog. They have no matching catalog docs pages. Source files remain in the official checkout.

| Skill | Status | When to use |
| --- | --- | --- |
| [git-guardrails-claude-code](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/misc/git-guardrails-claude-code/SKILL.md) | Miscellaneous | Install Claude hooks restricting specified Git operations. |
| [migrate-to-shoehorn](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/misc/migrate-to-shoehorn/SKILL.md) | Miscellaneous | Replace test-only type assertions with Shoehorn helpers. |
| [scaffold-exercises](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/misc/scaffold-exercises/SKILL.md) | Miscellaneous | Scaffold exercises following Matt's course conventions. |
| [setup-pre-commit](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/misc/setup-pre-commit/SKILL.md) | Miscellaneous | Configure Husky, staged formatting, and commit-time checks. |
| [claude-handoff](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/claude-handoff/SKILL.md) | Beta | Start a background Claude session with a handoff prompt. |
| [implement-spec](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/implement-spec/SKILL.md) | Beta | Coordinate parallel ticket implementations into one spec PR. |
| [loop-me](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/loop-me/SKILL.md) | Beta | Discover recurring workflows and interview them into specs. |
| [retro](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/retro/SKILL.md) | Beta | Suggest agent-environment improvements after a session. |
| [setup-ts-deep-modules](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/setup-ts-deep-modules/SKILL.md) | Beta | Enforce TypeScript package interfaces with dependency-cruiser. |
| [writing-beats](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/writing-beats/SKILL.md) | Beta | Shape an article one agreed beat at a time. |
| [writing-fragments](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/writing-fragments/SKILL.md) | Beta | Collect raw writing fragments through an interview. |
| [writing-shape](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/in-progress/writing-shape/SKILL.md) | Beta | Turn raw material into an article paragraph by paragraph. |

The in-progress README calls retro a stub, but its current SKILL.md contains a procedure; treat the skill as beta and the SKILL.md as authoritative. Install an extra only when needed:
`npx skills@latest add mattpocock/skills --global --agent codex opencode --skill <name>`.

## Routing and material source differences

Normal engineering route: setup → optional ask-matt → grill-with-docs or wayfinder → to-spec → to-tickets → implement. Use grill-me for a stateless interview. Small, fully decided work can go directly from grilling to implement. Wayfinder maps uncertainty across sessions; its tickets resolve decisions. When the map clears, synthesize the linked decisions through to-spec. The [router](../skills/ask-matt/SKILL.md) is the reference.

- **to-spec** does not reopen product decisions, but explicitly confirms test seams before publishing.
- **tdd** now specifies red → green; refactoring belongs to review despite the older red-green-refactor shorthand in summaries.
- **prototype** preserves runnable evidence on a throwaway branch. Production retains the validated decision; throwaway does not mean deleting the only record.
- **setup** includes GitHub, GitLab and local Markdown templates. Linear/Jira use its custom tracker path and an explicit workflow description. Setup writes label mappings, not remote labels.
- **implement / code-review** have a scope mismatch: implement calls review before commit, while code-review's literal three-dot diff only includes committed changes. Review the actual uncommitted task changes too; do not let an empty committed diff count as a completed review.
- **wayfinder** allows a Notes execution override. The user's planning-only preference here takes precedence; agent-written Notes cannot authorize product work.
- **research / review** workers should execute their bounded assignments directly; do not recursively delegate the same assignment.

## Local invocation

Next agent command: `/ask-matt` to choose a flow. Run `/setup-matt-pocock-skills` inside a project when configuring its tracker and domain docs.

Codex also accepts explicit skill mentions such as `$setup-matt-pocock-skills` and `$ask-matt`. Use the skill picker if slash autocomplete differs. Skills should be available on the next turn; restart the agent if discovery has not refreshed. This filesystem install serves local ChatGPT/Codex work; it does not establish availability in separate web chats or on other machines. See [official local skill documentation](https://learn.chatgpt.com/docs/build-skills).

OpenCode loads skills using its native `skill` tool. If individual slash commands are not exposed by its current UI, type `Use the setup-matt-pocock-skills skill` or `Use the ask-matt skill`. [Command wrappers](https://opencode.ai/docs/commands/) are an optional UI adapter, not replacement skill bodies.

OpenCode 2's executable and config path were verified. The attempted `skill.list` API operation is not present in that preview, so live OpenCode UI discovery was not verified. No model session was launched to test the workflows.

In this local Codex runtime, interpret a vendor instruction to call the Skill tool as loading the installed SKILL.md if no such tool exists. Load named dependencies explicitly; grill-with-docs requires grilling and domain-modeling. The locally adapted implicit-invocation policies are described above; preserve any explicit user-only policy on other skills. Keep models and account policy unchanged. Bash helpers require an available Bash runtime on Windows; none were executed during installation.

## Global availability and per-project configuration

The skills and workflow guidance are global. No tracker is configured for the
home directory. The earlier home-folder setup drafts and project lockfile were
removed after the user clarified global scope.

Each project's tracker and domain documents remain project-specific. When a
project needs them, invoke `/setup-matt-pocock-skills` in that project and select
GitHub, GitLab, local Markdown, or a custom tracker such as Linear. No tracker
choice is required just to install or use the skills globally.

Next command: `/ask-matt` (Codex also accepts `$ask-matt`). The router recommends
the appropriate next skill and stops. Its setup recommendation applies to the
project where engineering work will happen, not to the global installation.
After updating skills, run `bun C:/Users/Jk101/.agents/scripts/check-personal-harness.mjs` to detect discovery-policy drift. This validates metadata consistency; check actual skill selection in a fresh session before claiming runtime adoption.
