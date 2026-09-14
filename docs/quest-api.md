# Quest API

Open `oc` in the maintained JonsOCsetup source. The persistent giver hosts the Quest API; workers use the same typed contract with their own session identity. The runtime prepares repositories and workspaces, selects an allowed account/model from the saved preferences and current evidence, and returns worker outcomes to the giver.

Install the command as a durable local package from the reviewed `agents` checkout: run `npm install --global --install-links --omit=dev .`. This copies the generated client into the global installation, so retiring an implementation worktree cannot break `quest`. Repeat after updating the reviewed source. `quest --help` lists generated operations; `quest create --help` describes nested fields and `quest create --help --json` prints the contract. Pipe a JSON object to `quest create --input-json` for multiline descriptions and steps.

Use `quest list --text "words" --view plan` for backlog review, `quest status <id>` for immediate progress, `quest plan <id>` for saved dependencies, and `quest get <id>` for results. Follow `nextOffset` for another page. `quest inspect <id> runs` reads historical evidence; the optional limit is a character target and never splits a record. Save workflow task, optional model, concurrency, readOnly and delivery using update. Omit model for automatic selection. `quest start <id>` starts that saved workflow and repeated start returns its existing admission.

Workers report only assigned steps using `report` with id, stepID, state and note. The giver attaches artifacts and accepts finished work with `archive`; `reopen` preserves its history. Completion is delivered automatically. Use `wait` when a caller needs to block on a saved change.

`quest mcp` exposes the same operations over stdio. OpenCode discovers them through its configured `quests` MCP connection. Agents use these commands or discovered operations, not internal runtime scripts or reservation tools.

The listener is shared by locations in one runtime process. Discovery validates process liveness and the endpoint identity, retaining stale receipts as evidence. Old hosts do not serve the current discovery format; reopen `oc` on current agents code after upgrading. Browser-origin requests are refused and local clients require the registry credential. A worker connection requires host-supplied session metadata and cannot acquire giver authority by changing arguments.

The Codex Quest plugin exposes the same contract through its `quest` MCP namespace.
For example, `quest plan <id>` in a shell and `quest.plan({id})` in MCP read the
same saved plan; callers use one interface. The adapter retains the trusted
Codex hook/session context gate, then calls the connected product API. Its local
hook journal is not a separate Quest board. An explicit API registry or Quest
root keeps intentional isolated verification separate.

Codex checkout recovery preserves the logical hub directory and prepares an
owned worktree for supported shell and patch operations. Changing the hub's
source mapping leaves earlier receipts and their worktrees untouched: a session
reuses a valid workspace it already owns, and prepares the newly mapped checkout
only when it has none. Literal file reads,
directory inspection and supported rg searches do not need dependencies or create
recovery command tickets. Preparation selects the current locked platform and
exact cached versions, including Bun's hashed prerelease names, and copies them
with bounded memory. It retains failed preflight evidence; only failures known
to precede installer execution can prepare a fresh private cache automatically.
Unknown command completion is never replayed. Git trust is command-local and
limited to the validated workspace; global Git settings remain untouched.

A running Codex conversation can retain an older MCP server or tool inventory
after plugin installation. A hook trust prompt, an inactive session-context error,
and a stale tool inventory are different conditions. Trust only the reviewed
hooks when Codex requests it; repeated approval cannot update a loaded server.
Use the installed CLI while reconnecting an outdated MCP session. Arbitrary
persistent-tool filesystem rebinding remains outside this adapter's verified
host support.
