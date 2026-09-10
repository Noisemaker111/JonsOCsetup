# JonsOCsetup

Jon's OpenCode 2 setup in one public repository: plugins, extensions, agents, skills, instructions and launch tooling.

| Component | Source |
|---|---|
| Quests, delegation and ownership recovery | `quest/`, `orchestration/` |
| Usage, pacing and context UI | `usage/` |
| Model routing and access policy | `models/` |
| Project routing and automatic result returns | `project-router/` |
| CLI adapters, including Codex | `harnesses/`, `quest/codex/` |
| Shell failure memory | `papercut/` |
| Agents and runtime configuration | `agent/`, `opencode.jsonc`, `AGENTS.md` |
| Skills, hub instructions and installation mappings | `skills/`, `.agents/skills/`, `setup/` |

Plugins have their own directories, not their own GitHub repositories. Individual plugin mirror publishing is retired.

## Dev and stable

`agents` is the integration branch; `master` is stable. Use isolated worktrees, coherent commits and PRs to agents, then verify the actual intended operation. Stable promotion is a separate action. Existing running sessions retain their loaded version.

After channel preparation, **`ocd`** starts dev and **`ocs`** starts stable in the native console. Neither command proxies terminal output. The source for these commands lives in `scripts/install-channel-shortcuts.mjs` and `scripts/start-direct-channel.ps1`.

## Development acceptance

This pre-user project uses the installed app to verify every change. It maintains
a small core invariant suite and no backward-compatibility layers. Search for and remove
superseded implementations and instructions before completion. Durable project
knowledge lives in root MEMORY.md; Quests hold task progress. See
[the development workflow](docs/development-workflow.md).

## Portable skills

These standalone MIT-licensed skills also work outside this personal OpenCode setup. Install one without installing the runtime:

```sh
npx skills add https://github.com/Noisemaker111/JonsOCsetup/tree/agents --skill agents-and-main
npx skills add Noisemaker111/JonsOCsetup --skill skill-maker
```

- **[Agents and Main](skills/agents-and-main/SKILL.md)**: verified agent auto-merges into agents, isolated development environments, and human-only stable merges initiated by the user. Ask: "Use agents-and-main to set up agents and stable for this project." [Source](skills/agents-and-main/SKILL.md).
- **[Skill Maker](https://skills.sh/noisemaker111/jonsocsetup/skill-maker)**: create, check, publish, install and confirm a skill's public listing in one continuous workflow. Ask: "Use skill-maker to make and publish this skill." [Source](skills/skill-maker/SKILL.md).

Installing a skill supplies agent instructions; the agent still needs the project's authorization and actual CI/deployment configuration to carry out changes.

## Setup

This is a personal Windows setup, not a generic bundled OpenCode distribution. Install the OpenCode2 host, Git, Bun and Node separately. Clone this repository to `~/.config/opencode`, restore dependencies with `bun install --frozen-lockfile`, and review the personal model/provider configuration before using it. Accounts and subscription brokers must be authenticated locally.

`bun run setup:plan` compares the tracked external files with the machine. `bun run setup:install` applies them with conflict checks and receipts; it never overwrites independent edits. See [setup documentation](setup/README.md). These instructions and skills are Jon's personal preferences; review them before installing on another person's machine.

The model catalog cache is generated from public model metadata when needed. Credentials and local service authentication are not supplied. `service.example.json` shows the local service shape; keep real values in ignored `service.json` or supported environment variables.

## Public source boundary

The public history starts with this consolidation. Prior private Git histories and repository metadata were backed up locally before migration. Logs, credentials, session databases, usage captures, runtime journals and unreviewed recovery snapshots are excluded. No live checkout or running session is rewritten by publishing this repository.

External skills retain their existing licenses and provenance. Packaged host plugins remain external dependencies recorded in the setup manifest. Repository source is licensed under [MIT](LICENSE), except third-party material carrying its own license.
