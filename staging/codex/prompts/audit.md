---
description: Read-only audit — top findings with exact file:line, no edits
---

Audit the scope below and return concrete findings. $ARGUMENTS

Do not edit files. Return at most 10 findings, ranked by impact, each with an exact `file:line` and a
one-sentence impact. Do not broad-scan: read what the scope names, follow references out of it, and
stop. Check whether a finding is already a known issue before reporting it as new.
