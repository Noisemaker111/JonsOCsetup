# JonsOCsetup

My personal OpenCode2 setup: a persistent Quest Giver, project-aware workers, user-controlled model selection, and usage reporting.

- **Quests:** plan work, follow progress, review results, and return to the same conversation across projects.
- **Models:** choose a model yourself or use automatic selection based on your accounts, task requirements, pricing, usage, and measured performance. Change the choice when you need to.
- **Usage:** inspect account limits and resets, request tokens, task costs, and speed. Estimates, actual charges, and missing measurements stay distinct.
- **Terminal tools:** navigate projects and sessions, inspect context and timing, and keep useful skills available across your agent tools.

## Use it

Once configured, open the setup with:

```powershell
oc
```

Use `/quests` for the Quest board, `/usage` for usage, `/sessions` for conversations, and `/quest-reviewer` to change the permission reviewer. Tell the giver which project and outcome you want to work on.

`oc` normally opens the latest merged `agents` code. `oc <branch>` opens a specific branch; `oc --here` uses the current directory. See [launch options](docs/plain-opencode-launch.md).

## Install

This is a personal Windows configuration, not a bundled OpenCode2 installer. Install the OpenCode2 host, Git, Bun, and Node separately. Clone the `agents` branch, run `bun install --frozen-lockfile` in the checkout, and review the personal instructions and provider settings before applying them to your machine.

Follow [setup](setup/README.md) to preview and install the tracked configuration. Authenticate your own accounts locally; credentials are not included.

## Portable skills

These skills can be installed without the runtime:

```sh
npx skills add https://github.com/Noisemaker111/JonsOCsetup/tree/agents --skill agents-and-main
npx skills add https://github.com/Noisemaker111/JonsOCsetup/tree/agents --skill skill-maker
```

- [Agents and Main](skills/agents-and-main/SKILL.md): a reusable development workflow with agent integration and human-controlled publication.
- [Skill Maker](skills/skill-maker/SKILL.md): create, validate, and publish reusable skills.

## Documentation

Start with the [documentation index](docs/README.md) for Quests, routing, usage, setup, and maintenance. Current work is on `agents`; `main` is the published baseline.

Repository source is [MIT licensed](LICENSE), except third-party material with its own license. Logs, credentials, session databases, and private recovery captures are not included.
