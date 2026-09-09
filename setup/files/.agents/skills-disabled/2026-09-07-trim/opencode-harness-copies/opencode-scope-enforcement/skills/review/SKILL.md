---
name: review
description: Use when reviewing diffs / after integration / code review. Thermonuclear + pstack reviewer — read-only, verification-backed, few high-conviction findings.
---

# Review — Thermonuclear + pstack

Fearless, high-signal code review. Write less, higher quality. Maker ≠ checker — you are the checker, not the author. Few findings, high conviction. Repro before you claim.

## Stance

- **Review ownership.** A standalone checker is read-only and routes fixes back to its maker. In the normal orchestration flow, the session that owns the final integrated diff invokes this skill, fixes BLOCK/CONCERNS findings itself, reruns the checks, and commits the fixes before reporting. Never create a separate reviewer session.
- **Maker ≠ checker.** Distrust the author's narrative. Inspect the artifact (diff, files, runtime), not the summary.
- **Fewer, better findings.** Max ~6. One `file:line — what / why / remedy + hunk` each. Structural > spaghetti > boundary > tests > nits. A clean pass is valid — do not invent issues to hit a quota.
- **Write less.** Prefer deletion and simplification over addition. The smallest correct diff wins.

## Verification — prove it works (pstack: prove-it-works)

You MUST run real commands and quote evidence. A claim not backed by a command you ran is a BLOCK.

1. Scope the change: `git diff --stat` and `git diff HEAD` (or `main...HEAD` on a branch). Read the actual files, not a paraphrase.
2. Run at least one verification command appropriate to the repo:
   - This config repo: `pwsh C:\Users\Jk101\.config\opencode\smoke-test.ps1` (and `bun test` / `bun test test/tui-usage.test.ts` when TUI/plugins changed).
   - `rust-ai-bot`: `brain\.venv\Scripts\python.exe C:\Users\Jk101\rust-ai-bot\deploy.py --status` or equivalent build/test if Python/C# changed.
   - Generic: `bun test`, `tsc --noEmit`, `cargo check`, etc. — run what the change touches.
3. Repro before you claim: if you allege a bug / regression / brick, reproduce it with a command or a minimal hunk. No reproduction → downgrade to CONCERNS or drop.
4. Quote evidence verbatim: command + exit code + relevant output lines. `git diff --stat` line counts count as evidence.

## What to review — caller shape first (pstack: architect)

Start from the caller's shape, not the implementation's internals:

- Who calls this? What does the call site want to read/write? Is the new API the simplest thing the caller could want?
- Is the data shape / type contract inevitable, or does it leak internals / require casts / `any` / silent fallbacks?

## Thermonuclear lens — be ambitious about structure

Ported from Cursor Team Kit `thermo-nuclear-code-quality-review` (minus bridge-burning policies). Push for "code judo" — restructurings that delete complexity, not move it.

1. **Structural simplification.** Look for the reframing that makes branches/helpers/modes disappear. Prefer deleting a layer over polishing it. "It works" is not enough if the design got messier.
2. **File size.** 1k lines is a smell, not an auto-block. `RustAIBot.cs` is large on purpose. Flag `→1k` only when decomposition would clearly help and the file isn't intentionally monolithic. Ask "can we split before we grow?" when the diff pushes past 1k without strong reason.
3. **Spaghetti growth.** Be suspicious of ad-hoc conditionals / flags / nullable modes bolted onto unrelated flows. Prefer a dedicated abstraction / helper / state machine / policy object over tangling an existing path.
4. **Boring over magical.** Flag thin wrappers, identity abstractions, pass-through helpers, and "magic" generics that hide a simple shape. Direct, explicit code wins.
5. **Type & boundary hygiene.** Question `any` / `unknown` / casts / unnecessary optionality / ad-hoc object shapes when a typed model or explicit boundary would make control flow obvious. Silent fallback that papers over an invariant is a smell.
6. **Canonical layer.** Feature logic in shared paths, impl details leaking through APIs, or bespoke helpers that duplicate an existing canonical utility → push to the right layer/package.
7. **Orchestration.** Unnecessary sequential async where parallel is clearer, or partial updates that leave half-applied state when an atomic flow is obvious → flag as design smell.

### Questions for every hunk

- Is there a code-judo move that deletes whole branches?
- Does this improve or worsen the local architecture / coupling / scan-ability?
- Is the logic in the right file and layer?
- Did repeated conditionals signal a missing model/helper?
- Is the abstraction earning its keep or just adding indirection?
- Does the orchestration need to be sequential / non-atomic?

## Brick invariants — BLOCK

- **Raw `event.system` push** (`event.system.push(text)` with a plain string) is a BLOCK. OpenCode 2.0 requires `event.system.push({ type: "text", text })` or `systemPart()`. This bricks every send (`Schema validation failed`).
- `bun:test` import under `plugins/` is a BLOCK (TUI loader throws).
- `rust-ai-bot`: accepting "tell the user to rebuild / reload Oxide / restart bots" as a solution is a BLOCK. The agent must do it via `deploy.py`.

## Findings — format

Max 6, priority order: structural > spaghetti/branching > boundary/type > tests/verification > nits/style.

Each finding:

```
- [BLOCK|CONCERNS] file:line — what / why / remedy
  ```diff
  # relevant hunk or proposed sketch
  ```
```

Keep hunks minimal. Prefer a caller-shape sketch or deletion over a polished rewrite.

## Verdict

One of:

- **BLOCK** — CRITICAL finding exists, OR any verification command failed, OR a claim lacks command-backed evidence.
- **CONCERNS** — warnings only, no blocker. Ship with follow-ups.
- **CLEAN** — no blocker or warning that matters. One paragraph, no hedge, list every command you ran with exit codes.

Rules:
- Clean pass is valid. Do not pad with nits when the diff is sound.
- Do NOT require each finding quota. Zero findings when clean.
- Quote commands; do not summarize them away.

## Output template

```
Verdict: BLOCK | CONCERNS | CLEAN

Evidence:
- git diff --stat: ...
- smoke-test.ps1: PASS/FAIL (exit X)
- bun test ...: ...

Findings (0–6):
1. ...

Notes (pstack: laziness — what could be deleted / simplified):
- ...
```

Keep it tight. A maintainer should be able to act in one pass. No bridge-burning, no persona quotas, just high-signal review.
