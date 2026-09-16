---
name: memory
description: Decide whether something belongs in persistent memory, write it, announce it, retire it. Use when Jk corrects you or states a preference, before writing to ~/.claude/projects/*/memory/, and before saying "Memory updated".
---

# Memory

Memory is what a future session has to already know to work with Jk without being told again. It is
not a notebook for what this session found out.

## Write it

Three questions. All three pass, or it is not a memory.

1. **Did Jk say it, or is it structural?** A correction, a preference, a decision he made, or a fact
   about how this setup is wired that no file on disk states. A finding from the task in hand goes in
   the deliverable — the repo doc, the PR body, the reply.
2. **Would a future session get it wrong without this?** If `grep`, `--help`, `git log` or a hub
   `AGENTS.md` answers it in one call, that call beats a note that has since gone stale.
3. **Is it still true in a month?** A number you measured, a value you just set, a version's current
   behaviour — these expire quietly and the next session believes them anyway. The rule such a reading
   supports can be a memory; the reading is not.

Write it in the same turn as the correction. Jk should not have to ask.

## Don't write it

- What the answer you are about to hand back already carries.
- What a repo records: code structure, past fixes, git history, `AGENTS.md`, `CLAUDE.md`.
- A sharper version of a fact that never earned a memory. Amending the same paragraph twice means it
  is a document: move it into the repo and leave a pointer.

## Announce it

```
🧠 **Memory updated:** <the fact now in force, one line, in Jk's terms>
```

Never the edit that produced it — no "the note now says", no "replacing the older", no file name. If
the line only parses for someone who read the previous version, it is a changelog entry. Rewrite it.

- Bad: `🧠 Memory updated: the permission-profile note now says network is typed while
  file_system.entries is silently ignored, replacing the older "can't be verified, don't write one blind".`
- Good: `🧠 Memory updated: start Codex in a project directory — from the home directory every
  sandboxed command dies before the sandbox token is built.`

## Where it goes

| Destination | For |
| --- | --- |
| `~/.claude/projects/<cwd-slug>/memory/` | Claude Code only; Codex and the Quest Giver never see it |
| `Projects/JonsOCsetup/MEMORY.md` | anything another harness needs |
| the repo it belongs to | anything a person would go looking for in docs |

## The file

One fact per file. Kebab-case filename matching `name:`; `description:` is what recall matches on, so
write it as the fact, not as a topic. `type: user | feedback | project | reference`. `feedback` and
`project` carry **Why:** and **How to apply:** lines — the why is what stops a later session arguing
with the rule. Link related memories with `[[name]]`, including ones not written yet.

Add one line to `MEMORY.md`: `- [Title](file.md) — hook`. Content never goes in `MEMORY.md`.

## Retire it

A memory that turned out wrong gets deleted, with its pointer, and Jk gets told. A superseded one gets
rewritten in place — never appended to, or it becomes the changelog above.
