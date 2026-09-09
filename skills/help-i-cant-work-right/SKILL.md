---
name: "help!-i cant work right"
description: "Recover when tools required for authorized work are missing, dispatch or agent capabilities repeatedly fail, source and loaded generations differ, or authorized work fails to continue after a blocker clears."
---

# help!-i cant work right

1. Identify the execution failure before assigning implementation. Record observed role/instructions, tools, provider/model/reasoning, workspace, source and loaded configuration, launch state, and the specific blocker. Distinguish permission denial, missing tools, account hold, stale quota, and unknown launch; report unknown facts as unknown.
2. Preserve the existing Quest and steps, intent, decisions, authorization, exact model choice, dirty-work ownership, live/unknown workers, last operation/result, and next safe action. Use typed Quest updates when available; otherwise save or return a portable report. A normally ended session does not prove task completion.
3. Diagnose once with bounded reads and one targeted capability check. Repeat a launch only after evidence shows its blocking precondition changed. Use an authorized, supported tool-capable repair route when available; keep coordinator and worker roles distinct and recursive worker spawning restricted.
4. If repair is inaccessible, immediately emit a self-contained external-harness repair prompt using [handoff.md](handoff.md). Include evidence and acceptance checks, not a promise to fix it later. Do not wait for the user to request the prompt.
5. Verify through the actual host: observed role/model/workspace, task-owned write/read, harmless shell check, and recorded result. Reconcile live/unknown workers and ownership before resuming the original eligible authorized work. Preserve explicit model choice in every dispatch. Claim automatic continuation only with an observed running mechanism; a saved Quest is not a scheduler.

Keep recovery bounded: no endless retries, recursive repair agents, unrelated Quests from logs, unauthorized model fallback, purchases, weakened permissions, or unapproved process restarts. Preserve cancellation and stop on unknown launch state.
