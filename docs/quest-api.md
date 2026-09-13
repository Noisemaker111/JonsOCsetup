# Quest API

Open `oc` at the hub. The persistent giver hosts the Quest API; workers use the same typed contract with their own session identity. The runtime prepares repositories and workspaces, selects an allowed account/model from the saved preferences and current evidence, and returns worker outcomes to the giver.

Install the command as a durable local package from the reviewed `agents` checkout: run `npm install --global --install-links --omit=dev .`. This copies the generated client into the global installation, so retiring an implementation worktree cannot break `quest`. Repeat after updating the reviewed source. `quest --help` lists generated operations; `quest create --help` describes nested fields and `quest create --help --json` prints the contract. Pipe a JSON object to `quest create --input-json` for multiline descriptions and steps.

Use `quest list --text "words" --view plan` for backlog review, `quest status <id>` for immediate progress, `quest plan <id>` for saved dependencies, and `quest get <id>` for results. Follow `nextOffset` for another page. `quest inspect <id> runs` reads historical evidence; the optional limit is a character target and never splits a record. Save workflow task, optional model, concurrency, readOnly and delivery using update. Omit model for automatic selection. `quest start <id>` starts that saved workflow and repeated start returns its existing admission.

Workers report only assigned steps using `report` with id, stepID, state and note. The giver attaches artifacts and accepts finished work with `archive`; `reopen` preserves its history. Completion is delivered automatically. Use `wait` when a caller needs to block on a saved change.

`quest mcp` exposes the same operations over stdio. OpenCode discovers them through its configured `quests` MCP connection. Agents use these commands or discovered operations, not internal runtime scripts or reservation tools.

The listener is shared by locations in one runtime process. Discovery validates process liveness and the endpoint identity, retaining stale receipts as evidence. Old hosts do not serve the current discovery format; reopen `oc` on current agents code after upgrading. Browser-origin requests are refused and local clients require the registry credential. A worker connection requires host-supplied session metadata and cannot acquire giver authority by changing arguments.
