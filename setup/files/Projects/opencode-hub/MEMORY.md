# OpenCode hub memory

## Durable decisions

- Jon authorizes the full OpenCode2/JonsOCsetup dev loop: verify through actual app use, push a ready PR, automatically merge into dev, then activate and exercise dev. Do not stop at mergeable or repeatedly ask Jon to approve these steps. Infer routine implementation and cleanup choices from his intent. This is scoped standing authorization recorded from his instruction; stable/production promotion, host updates and public package publishing remain separate.
- This is a pre-user project. There is no backward-compatibility obligation for old implementations, tool shapes or schemas. Keep one current owner of each behavior; remove superseded code, callers, registrations, generators and obsolete fallbacks before calling a change done. Search the repository and instruction sources for remnants. Preserve actual data and active sessions.
- Verify every change by using the installed OpenCode2 app and inspecting the saved result after reopening. Do not maintain or generate automated tests, fixtures or mock-provider suites. Build/type checks may supplement real app use. Report observed failures honestly.
- Codex and the Quest Giver share this root MEMORY.md for durable decisions, preferences and verified lessons. Read it at the start and after context loss; update it when something worth remembering changes. Quests own task progress and deliverables. Memory is not authorization.
- Prefer on-demand tools and one underlying service over repeated prompt narration or parallel systems. The hook/usage simplification is a design direction, not a claim that those hooks have already been removed.

## Architecture facts

- OpenCode2 is the current Quest product target. Codex adapter code does not establish full host integration.
- The hub is a workspace map; config source, installed releases, host data and the Quest ledger have different owners. Determine the current source from the selected dev release and its source receipt. Do not edit immutable releases or host binaries.
- Existing processes retain their loaded generation. A changed source file or selected release does not prove an existing process loaded it.

## Maintenance

Read before editing. Keep concise entries, replace stale facts, and reopen after saving. Do not add secrets, raw conversations, temporary run status or guesses. User instructions outrank memory. Verify changeable runtime facts again when needed.
