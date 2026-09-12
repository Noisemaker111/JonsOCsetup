---
description: Read-only audit — concrete findings with file:line, no edits, no broad scan
agent: audit
---

Audit the code in scope and return concrete findings. $ARGUMENTS

Rules:

- Do not edit, write or patch anything. This is read-only.
- Return at most 10 findings unless asked otherwise, ranked by impact.
- Every finding cites an exact `file:line` and states the impact in one sentence.
- Do not broad-scan. Read what the scope names, follow references from it, and stop.
- If a finding is a duplicate of an existing issue, say so rather than filing it again.
