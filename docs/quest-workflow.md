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

The same operation is callable from another harness:

```js
const board = await openBoard()
const admission = board.start(questID)
```

The CLI is `quest start <id>`. Repeating it returns the pending admission or active
work. A queued result is not a claim that a worker has started. OpenCode consumes
the durable request while it is running; requests made while it is closed wait
for it to open. A transport outcome that cannot be established stays visible for
inspection instead of launching duplicate work.

The board API defaults to the same managed ledger as `oc`. `OPENCODE_QUEST_ROOT`
or the API's `ledgerRoot` option selects an intentional alternate ledger, including
isolated verification. Historical standalone data is retained separately.

## Choices belong to the Quest

Use `create.workflow` or `update.workflow` in the native Quest tool, or
`board.configure(id, workflow)` from another harness. The object replaces the
saved settings, so omitting `model` restores automatic selection. It supports:

- `task`: coding, review, planning or utility, used by the existing router.
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
