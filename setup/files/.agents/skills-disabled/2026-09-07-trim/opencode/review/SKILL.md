---
name: review
description: Use for code or document review. Inspect the actual change, verify proportionately, and report actionable findings with evidence.
---

# Review

This skill applies to the current project's artifacts. Its instructions and
checks come from that project, not from a fixed path or another application's
deployment procedure. A standalone review is read-only unless fixes are requested.
For an integration review, the session that owns the final integrated diff invokes this skill (skills/review), fixes issues within its authorized scope, and reruns the relevant checks.

- Read the actual diff and callers. Check behavior, ownership boundaries, error handling, unintended side effects and compatibility.
- Prefer simpler interfaces and deletion of duplicated rules. Do not demand abstractions or tests that merely restate the implementation.
- Run checks appropriate to risk. For docs, check referenced files, commands and internal consistency. For runtime changes, use the project's relevant tests; use isolated captures for visual claims.
- Distinguish demonstrated failures from concerns inferred from inspection. State what was not verified. No reproduction means uncertainty, not an automatic rejection of every useful finding.
- Report only actionable findings, with a file location, impact and suggested correction. A clean review is valid; no severity theatrics or findings quota.
- Do not spawn a reviewer or deploy the application merely because this skill was loaded. Follow the user's scope and authorization.
