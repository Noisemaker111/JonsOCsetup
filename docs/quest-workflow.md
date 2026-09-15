# Start a saved Quest

Subscription quota telemetry can fail independently of model access. The user-editable
`models/dispatch-policy.json` setting `request.missingSubscriptionUsage` chooses
`attempt` or `wait`. An attempt keeps capacity unknown and lets the provider enforce
its limits; known exhaustion, authentication, route access and spending checks still
apply. This policy never turns an unknown balance into an available-quota estimate.

Open the Quest board in `oc` and choose **Start Quest**. The start uses the work,
project and workflow already saved on that Quest. It does not ask for a model or
send a planning prompt to the giver. Pending steps continue through the existing
worker scheduler; dependency results are retained in their owned workspaces.

OpenCode discovers the `quests` MCP namespace through Code Mode. Its public
operations are list, get, create, update, start, run and wait. For example, after
discovering the exact signatures:

```js
return await tools.quests.start({id: questID})
```

The CLI is `quest start <id>`. Repeating it returns the pending admission or active
work. A queued result is not a claim that a worker has started. OpenCode must be
running to accept API calls; accepted requests survive a restart. A transport
outcome that cannot be established stays visible for
inspection instead of launching duplicate work.

`quest --help` lists the generated commands, and `quest <operation> --help` describes
their arguments. Results are JSON. `quest mcp` exposes the same operations over
standard MCP stdio for other clients. Both interfaces call the running service;
they never open the ledger or import runtime implementation files.
`QUEST_API_REGISTRY` selects an intentional alternate service registry. The default
registry belongs to the same managed board as `oc`.

## Choices belong to the Quest

Pass `workflow` to create or update, or use the CLI's `--workflow` JSON argument.
The object replaces the
saved settings, so omitting `model` restores automatic selection. It supports:

- `task`: coding, review, planning or utility, used by the existing router.
- `readOnly`: enforce research without shell commands or source edits.
- `model`: an optional exact user-selected route. No model means automatic routing.
- `maxConcurrent`: desired parallelism for independent ready steps.
- `delivery`: `project`, `quest-pr`, `step-pr` or `none`.

Automatic choices use configured allowed accounts and task evidence. Explicit
models remain explicit; an unavailable choice is reported rather than replaced.
Delivery follows project conventions unless changed. The board's **Choose
delivery** action saves one PR for the Quest, one per step, or result only.
Delivery choices do not grant publishing or merge authorization by themselves.

Workers save their assigned results and the existing return mechanism wakes the
giver. Completing all externally held steps also queues a review of their saved
results. The giver checks evidence and delivers the chosen outcome. Self-reported
completion never silently accepts or archives the Quest.

## Editing source

`~/Projects/JonsOCsetup` is the current source repository. The hub's `source/`
junction points there; `bun run setup:hub` establishes that link and refuses to
replace an unexpected target. Use an owned worktree of that source repository.
`~/.config/opencode` retains the runtime registry and historical checkout; plain
`oc` prepares committed `agents` code without switching that directory's branch.
The runtime resolves the configured hub source binding for both research and editing.
Workers remain attached to the hub Quest; research runs at the mapped source and
editing runs in an owned worktree. The giver stays in the hub.
